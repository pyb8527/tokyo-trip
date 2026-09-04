/* ============================================================================
   장소 편집 — 추가 · 수정 · 삭제 · 지도에서 좌표 찍기
   ----------------------------------------------------------------------------
   index.html 이 아래 훅을 넘겨 줍니다:
     Edit.attach({ getDays, reload, mapPick, focusPlace })
   ========================================================================== */
const Edit = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let hooks = null;
  let editMode = false;

  /* ---------------------------------------------------------------- 토스트 */
  let toastEl, toastTimer;
  function toast(msg, isErr) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.toggle("err", !!isErr);
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
  }

  /* -------------------------------------------------- 구글 지도 링크 파싱 */
  /* 폰에서 장소를 검색해 "공유"로 복사한 링크를 그대로 붙여넣는 흐름을 지원한다.
     https://www.google.com/maps/place/…/@35.6595,139.7005,17z/…
     https://maps.google.com/?q=35.6595,139.7005
     https://www.google.com/maps/…!3d35.6595!4d139.7005 */
  function parseLatLng(text) {
    if (!text) return null;
    const s = String(text).trim();

    const direct = s.match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (direct) return check(+direct[1], +direct[2]);

    const at = s.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
    if (at) return check(+at[1], +at[2]);

    const bang = s.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
    if (bang) return check(+bang[1], +bang[2]);

    try {
      const u = new URL(s);
      const q = u.searchParams.get("q") || u.searchParams.get("query") || u.searchParams.get("ll");
      if (q) {
        const m = q.match(/(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/);
        if (m) return check(+m[1], +m[2]);
      }
    } catch {}
    return null;

    function check(lat, lng) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
      return { lat, lng };
    }
  }

  /* ---------------------------------------------------------------- 모달 */
  const CATS = ["도착", "출국", "체크인", "체크아웃", "숙소", "환승",
                "아침", "점심", "저녁", "야식", "간식", "카페", "2차",
                "굿즈", "쇼핑", "시장", "전망", "일몰", "야경",
                "신사", "사찰", "공원", "산책", "거리", "랜드마크", "구경", "예약필수"];
  const MODES = [["walk", "도보"], ["train", "전철"], ["bus", "버스"], ["car", "차량"]];

  function formHTML(place, days, dayId) {
    const v = place || {};
    const mv = v.move || {};
    const opt = (list, cur) => list.map(x => {
      const [val, label] = Array.isArray(x) ? x : [x, x];
      return `<option value="${esc(val)}"${cur === val ? " selected" : ""}>${esc(label)}</option>`;
    }).join("");

    return `
    <div class="modal-card">
      <div class="modal-head">
        <h3>${place ? "장소 수정" : "장소 추가"}</h3>
        <button class="modal-x" id="mClose" aria-label="닫기">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>
      <form id="placeForm">
        <div class="f-grid">
          <div class="f full"><label for="fName">이름</label>
            <input id="fName" type="text" required maxlength="80" value="${esc(v.name)}" placeholder="예: 시부야 스카이"></div>

          <div class="f"><label for="fDay">날짜</label>
            <select id="fDay">${days.map(d =>
              `<option value="${d.id}"${(dayId ?? v.dayId) === d.id ? " selected" : ""}>${esc(d.label)} · ${esc(d.date ?? "")}</option>`).join("")}</select></div>

          <div class="f"><label for="fTime">시간</label>
            <input id="fTime" type="time" value="${esc(v.time)}">
            <span class="hint">시간을 넣으면 자동으로 순서가 맞춰집니다</span></div>

          <div class="f"><label for="fCat">분류</label>
            <select id="fCat"><option value="">(없음)</option>${opt(CATS, v.cat)}</select>
            <span class="hint">지도 핀 아이콘이 분류를 따라갑니다</span></div>

          <div class="f"><label for="fCost">금액</label>
            <input id="fCost" type="text" maxlength="40" value="${esc(v.cost)}" placeholder="무료 / ¥1,200"></div>

          <div class="f full">
            <div class="coord">
              <div class="f"><label for="fLat">위도</label>
                <input id="fLat" type="text" inputmode="decimal" required value="${v.lat ?? ""}"></div>
              <div class="f"><label for="fLng">경도</label>
                <input id="fLng" type="text" inputmode="decimal" required value="${v.lng ?? ""}"></div>
              <button type="button" class="coord-pick" id="mPick">지도에서 찍기</button>
            </div>
          </div>

          <div class="f full"><label for="fPaste">구글 지도 링크 붙여넣기</label>
            <input id="fPaste" type="text" placeholder="https://maps.app.goo.gl/... 또는 35.6595,139.7005">
            <span class="hint">폰에서 검색 → 공유 → 링크 복사 후 여기에 붙여넣으면 좌표가 채워집니다</span></div>

          <div class="f"><label for="fJa">일본어 표기</label>
            <input id="fJa" type="text" maxlength="80" value="${esc(v.ja)}" placeholder="渋谷スカイ">
            <span class="hint">택시·길 묻기에 씁니다</span></div>

          <div class="f"><label for="fEn">영문 표기</label>
            <input id="fEn" type="text" maxlength="80" value="${esc(v.en)}" placeholder="SHIBUYA SKY"></div>

          <div class="f full"><label for="fUrl">예약 · 공식 링크</label>
            <input id="fUrl" type="url" maxlength="300" value="${esc(v.url)}" placeholder="https://..."></div>

          <div class="f full"><label for="fNote">메모</label>
            <textarea id="fNote" maxlength="1200" placeholder="&lt;b&gt;강조&lt;/b&gt; 와 &lt;br&gt; 줄바꿈을 쓸 수 있습니다">${esc(v.note)}</textarea></div>

          <div class="f full"><label>다음 장소까지 이동</label>
            <div class="coord">
              <div class="f"><select id="fMode"><option value="">(없음)</option>${opt(MODES, mv.mode)}</select></div>
              <div class="f"><input id="fMin" type="number" min="0" max="600" value="${mv.min ?? ""}" placeholder="분"></div>
              <div class="f" style="flex:2"><input id="fVia" type="text" maxlength="60" value="${esc(mv.via)}" placeholder="긴자선 시부야 → 칸다"></div>
            </div>
            <span class="hint">이 장소에서 <b>다음</b> 장소로 갈 때의 정보입니다</span></div>

          <div class="f full"><label for="fMoveCost">이동 금액</label>
            <input id="fMoveCost" type="text" maxlength="40" value="${esc(mv.cost)}" placeholder="IC ¥210"></div>
        </div>

        <div id="formErr"></div>
        <div class="modal-actions">
          ${place ? `<button type="button" class="btn btn-danger" id="mDelete">삭제</button>` : ""}
          <button type="button" class="btn btn-ghost" id="mCancel">취소</button>
          <button type="submit" class="btn btn-primary" id="mSave">${place ? "저장" : "추가"}</button>
        </div>
      </form>
    </div>`;
  }

  function openForm(place, dayId) {
    const days = hooks.getDays();
    let el = $("#placeModal");
    if (!el) {
      el = document.createElement("div");
      el.id = "placeModal";
      el.className = "modal";
      document.body.appendChild(el);
    }
    el.innerHTML = formHTML(place, days, dayId);
    el.hidden = false;

    const close = () => { el.hidden = true; el.innerHTML = ""; };
    $("#mClose").onclick = close;
    $("#mCancel").onclick = close;
    el.onclick = e => { if (e.target === el) close(); };

    /* 구글 지도 링크 → 좌표 */
    $("#fPaste").addEventListener("input", e => {
      const hit = parseLatLng(e.target.value);
      if (hit) {
        $("#fLat").value = hit.lat;
        $("#fLng").value = hit.lng;
        e.target.value = "";
        toast(`좌표를 넣었습니다 · ${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)}`);
      }
    });

    /* 지도에서 찍기 — 모달을 잠시 감추고 지도 클릭을 기다린다 */
    $("#mPick").onclick = async () => {
      el.hidden = true;
      const pos = await hooks.mapPick();
      el.hidden = false;
      if (pos) {
        $("#fLat").value = pos.lat.toFixed(6);
        $("#fLng").value = pos.lng.toFixed(6);
        toast("좌표를 찍었습니다");
      }
    };

    if (place) $("#mDelete").onclick = async () => {
      if (!confirm(`"${place.name}" 을(를) 지웁니다. 되돌릴 수 없습니다.`)) return;
      try {
        await API.del("/api/places/" + place.id);
        close();
        await hooks.reload();
        toast("삭제했습니다");
      } catch (e) { fail(e.message); }
    };

    const fail = m => { $("#formErr").innerHTML = `<div class="form-err">${esc(m)}</div>`; };

    $("#placeForm").addEventListener("submit", async e => {
      e.preventDefault();
      $("#formErr").innerHTML = "";
      const save = $("#mSave");
      save.disabled = true; save.textContent = "저장 중…";

      const mode = $("#fMode").value;
      const body = {
        dayId: $("#fDay").value,
        name: $("#fName").value.trim(),
        lat: Number($("#fLat").value),
        lng: Number($("#fLng").value),
        time: $("#fTime").value || null,
        cat: $("#fCat").value || null,
        cost: $("#fCost").value.trim() || null,
        ja: $("#fJa").value.trim() || null,
        en: $("#fEn").value.trim() || null,
        url: $("#fUrl").value.trim() || null,
        note: $("#fNote").value.trim() || null,
        move: mode ? {
          mode,
          min: Number($("#fMin").value) || 0,
          via: $("#fVia").value.trim() || undefined,
          cost: $("#fMoveCost").value.trim() || undefined
        } : null
      };

      try {
        if (place) await API.patch("/api/places/" + place.id, body);
        else       await API.post("/api/places", body);
        close();
        await hooks.reload();
        toast(place ? "저장했습니다" : "추가했습니다");
      } catch (err) {
        fail(err.message);
        save.disabled = false; save.textContent = place ? "저장" : "추가";
      }
    });
  }

  /* ---------------------------------------------------------------- 편집 모드 */
  function setEditMode(on) {
    editMode = on;
    document.body.classList.toggle("edit-mode", on);
    hooks.reload();
    if (on) toast("편집 모드입니다. 카드의 연필을 누르면 고칠 수 있습니다");
  }

  /* 목록이 다시 그려질 때 index.html 이 불러 준다 */
  function decorate(block, day) {
    if (!editMode) return;

    const bar = document.createElement("div");
    bar.className = "edit-bar";
    bar.innerHTML = `<span class="grow">${esc(day.label)} 편집 중</span>
                     <button class="ghost" data-done>완료</button>`;
    block.insertBefore(bar, block.children[1] || null);
    bar.querySelector("[data-done]").onclick = () => setEditMode(false);

    block.querySelectorAll(".card-wrap").forEach(wrap => {
      const id = wrap.querySelector(".card")?.dataset.id;
      const place = day.places.find(p => p.id === id);
      if (!place) return;
      wrap.querySelector(".visit")?.remove();
      const box = document.createElement("div");
      box.className = "place-edit";
      box.innerHTML = `
        <button data-e title="수정" aria-label="${esc(place.name)} 수정">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10-4-4L4 16Z"/><path d="m14.5 5.5 4 4"/></svg>
        </button>
        <button class="del" data-d title="삭제" aria-label="${esc(place.name)} 삭제">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>`;
      box.querySelector("[data-e]").onclick = e => { e.stopPropagation(); openForm(place); };
      box.querySelector("[data-d]").onclick = async e => {
        e.stopPropagation();
        if (!confirm(`"${place.name}" 을(를) 지웁니다.`)) return;
        try { await API.del("/api/places/" + place.id); await hooks.reload(); toast("삭제했습니다"); }
        catch (err) { toast(err.message, true); }
      };
      wrap.appendChild(box);
    });

    const add = document.createElement("button");
    add.className = "day-add";
    add.textContent = "+ 이 날짜에 장소 추가";
    add.onclick = () => openForm(null, day.id);
    block.appendChild(add);
  }

  const attach = h => { hooks = h; };
  const isOn = () => editMode;

  return { attach, setEditMode, decorate, openForm, isOn, toast, parseLatLng };
})();
