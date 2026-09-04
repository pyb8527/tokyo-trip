/* ============================================================================
   여행 관리 — 목록 · 만들기 · 이름/날짜 수정 · 삭제 · 전환
   ----------------------------------------------------------------------------
   드로어의 "여행" 메뉴에서 열립니다. 고른 여행은 브라우저에 기억해 두고
   다음에 열 때 그대로 이어서 봅니다.
   ========================================================================== */
const Trips = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const ACTIVE = "tokyoTrip.activeTrip";
  const getActive = () => { try { return localStorage.getItem(ACTIVE); } catch { return null; } };
  const setActive = id => { try { id ? localStorage.setItem(ACTIVE, id) : localStorage.removeItem(ACTIVE); } catch {} };

  /* 서버 호출에 붙일 ?trip=... */
  const q = (path) => {
    const id = getActive();
    if (!id) return path;
    return path + (path.includes("?") ? "&" : "?") + "trip=" + encodeURIComponent(id);
  };

  const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
  const fmt = iso => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
    const d = new Date(iso + "T00:00:00Z");
    return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")} (${WEEK[d.getUTCDay()]})`;
  };
  const nightsOf = (a, b) => {
    if (!a || !b) return null;
    const d = (new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000;
    return Number.isFinite(d) ? Math.round(d) : null;
  };

  /* 고른 여행으로 넘어간다.
     같은 페이지에서 location.href 에 같은 주소를 넣으면 해시만 바뀌고 리로드가
     일어나지 않는다. 그래서 같은 페이지인지 먼저 보고 reload 를 직접 부른다. */
  function goToTrip() {
    const target = new URL("index.html", location.href);
    if (target.pathname === location.pathname) {
      if (location.hash !== "#all") location.hash = "all";
      location.reload();
    } else {
      location.href = target.pathname + "#all";
    }
  }

  /* 열려 있는 패널을 아무 데서나 닫을 수 있도록 밖에 둔다. */
  const closePanel = () => {
    const el = $("#tripsModal");
    if (el) { el.hidden = true; el.innerHTML = ""; }
  };

  function panel(html) {
    let el = $("#tripsModal");
    if (!el) {
      el = document.createElement("div");
      el.id = "tripsModal"; el.className = "modal";
      document.body.appendChild(el);
    }
    el.innerHTML = html;
    el.hidden = false;
    const close = closePanel;
    el.onclick = e => { if (e.target === el) close(); };
    el.querySelector("[data-x]")?.addEventListener("click", close);
    el.querySelectorAll("[data-cancel]").forEach(b => b.onclick = close);
    return close;
  }
  const head = t => `<div class="modal-head"><h3>${esc(t)}</h3>
    <button class="modal-x" data-x aria-label="닫기">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>`;

  /* ---------------------------------------------------------------- 목록 */
  async function open() {
    const close = panel(`<div class="modal-card">${head("여행")}
      <div id="tpBody"><div style="padding:26px 0;text-align:center;color:var(--text-3)">불러오는 중…</div></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-cancel>닫기</button>
        <button class="btn btn-primary" id="tpNew">+ 새 여행</button>
      </div>
    </div>`);
    $("#tpNew").onclick = () => openCreate(close);
    await renderList();
  }

  async function renderList() {
    const body = $("#tpBody");
    if (!body) return;
    try {
      const { trips } = await API.get("/api/trips");
      const active = getActive() || trips[0]?.id;
      const me = API.state.user;

      body.innerHTML = trips.map(t => {
        const n = nightsOf(t.startIso, t.endIso);
        const period = t.startIso
          ? `${fmt(t.startIso)}${t.endIso && t.endIso !== t.startIso ? " – " + fmt(t.endIso) : ""}`
          : "날짜 없음";
        const canDelete = me && (me.role === "admin" || t.ownerId === me.id) && trips.length > 1;
        return `<div class="trip-row${t.id === active ? " on" : ""}" data-id="${t.id}">
          <button class="trip-pick" data-pick>
            <div class="trip-title">${esc(t.title)}${t.id === active ? '<span class="trip-now">보는 중</span>' : ""}</div>
            <div class="trip-meta">${esc(period)}</div>
            <div class="trip-sub">${n !== null ? `${n}박 ${n + 1}일 · ` : ""}장소 ${t.placeCount}곳</div>
          </button>
          <div class="trip-acts">
            <button data-edit title="이름·날짜 수정" aria-label="${esc(t.title)} 수정">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10-4-4L4 16Z"/><path d="m14.5 5.5 4 4"/></svg>
            </button>
            ${canDelete ? `<button class="danger" data-del title="삭제" aria-label="${esc(t.title)} 삭제">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                   stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>` : ""}
          </div>
        </div>`;
      }).join("") || `<div style="padding:26px 0;text-align:center;color:var(--text-3)">여행이 없습니다</div>`;

      body.querySelectorAll(".trip-row").forEach(row => {
        const id = row.dataset.id;
        const t = trips.find(x => x.id === id);
        row.querySelector("[data-pick]").onclick = () => {
          if (id === active) return closePanel();   /* 이미 보고 있는 여행이면 닫기만 */
          setActive(id);
          goToTrip();
        };
        row.querySelector("[data-edit]").onclick = () => openEdit(t);
        row.querySelector("[data-del]")?.addEventListener("click", async () => {
          if (!confirm(`"${t.title}" 을(를) 지웁니다.\n장소·가계부·정산 기록이 모두 함께 사라지며 되돌릴 수 없습니다.`)) return;
          try {
            await API.del("/api/trips/" + id);
            if (getActive() === id) setActive(null);
            await renderList();
            Edit.toast("여행을 지웠습니다");
          } catch (e) { Edit.toast(e.message, true); }
        });
      });
    } catch (e) {
      body.innerHTML = `<div class="form-err">${esc(e.message)}</div>`;
    }
  }

  /* ---------------------------------------------------------------- 만들기 */
  function openCreate(closeList) {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const close = panel(`<div class="modal-card">${head("새 여행")}
      <form id="tcForm"><div class="f-grid">
        <div class="f full"><label for="tcTitle">여행 이름</label>
          <input id="tcTitle" required maxlength="60" placeholder="예: 오사카 2박 3일"></div>
        <div class="f"><label for="tcStart">시작일</label>
          <input id="tcStart" type="date" required value="${iso}"></div>
        <div class="f"><label for="tcNights">몇 박</label>
          <input id="tcNights" type="number" min="0" max="30" value="3">
          <span class="hint">0 이면 당일치기</span></div>
      </div>
      <div id="tcErr"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-cancel>취소</button>
        <button type="submit" class="btn btn-primary">만들기</button>
      </div></form>
    </div>`);

    $("#tcForm").addEventListener("submit", async e => {
      e.preventDefault();
      try {
        const res = await API.post("/api/trips", {
          title: $("#tcTitle").value.trim(),
          startIso: $("#tcStart").value,
          nights: Number($("#tcNights").value) || 0
        });
        setActive(res.trip.id);
        goToTrip();
      } catch (err) {
        $("#tcErr").innerHTML = `<div class="form-err">${esc(err.message)}</div>`;
      }
    });
  }

  /* ---------------------------------------------------------------- 수정 */
  function openEdit(t) {
    const close = panel(`<div class="modal-card">${head("여행 수정")}
      <form id="teForm"><div class="f-grid">
        <div class="f full"><label for="teTitle">여행 이름</label>
          <input id="teTitle" required maxlength="60" value="${esc(t.title)}"></div>
        <div class="f full"><label for="teStart">시작일</label>
          <input id="teStart" type="date" value="${esc(t.startIso ?? "")}">
          <span class="hint">시작일을 옮기면 나머지 날짜도 같은 간격으로 따라 움직입니다</span></div>
      </div>
      <div id="teErr"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-cancel>취소</button>
        <button type="submit" class="btn btn-primary">저장</button>
      </div></form>
    </div>`);

    $("#teForm").addEventListener("submit", async e => {
      e.preventDefault();
      const body = { title: $("#teTitle").value.trim() };
      const start = $("#teStart").value;
      if (start && start !== t.startIso) body.startIso = start;
      try {
        await API.patch("/api/trips/" + t.id, body);
        close();
        await open();                      /* 목록으로 되돌아간다 */
        Edit.toast("저장했습니다");
        if (getActive() === t.id) setTimeout(() => location.reload(), 700);
      } catch (err) {
        $("#teErr").innerHTML = `<div class="form-err">${esc(err.message)}</div>`;
      }
    });
  }

  Shell.on("trips", open);

  return { open, getActive, setActive, q, fmt, nightsOf };
})();
