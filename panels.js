/* ============================================================================
   설정 · 동행자 패널 — Shell 메뉴에서 열립니다
   ----------------------------------------------------------------------------
   shell.js 는 처리기가 등록된 항목만 메뉴에 띄우므로, 이 파일을 로드하는
   페이지에서만 "설정"과 "동행자"가 보입니다.
   ========================================================================== */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const yen = n => "¥" + Math.round(n).toLocaleString("ko-KR");

  function panel(html) {
    let el = $("#shellModal");
    if (!el) {
      el = document.createElement("div");
      el.id = "shellModal"; el.className = "modal";
      document.body.appendChild(el);
    }
    el.innerHTML = html;
    el.hidden = false;
    const close = () => { el.hidden = true; el.innerHTML = ""; };
    el.onclick = e => { if (e.target === el) close(); };
    el.querySelector("[data-x]").onclick = close;
    el.querySelectorAll("[data-cancel]").forEach(b => b.onclick = close);
    return close;
  }

  const head = t => `<div class="modal-head"><h3>${esc(t)}</h3>
    <button class="modal-x" data-x aria-label="닫기">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>`;

  const sub = t => `<div style="margin-top:22px;font-size:13px;font-weight:700;color:var(--text-3);margin-bottom:12px">${esc(t)}</div>`;

  /* ---------------------------------------------------------------- 설정 */
  async function openSettings() {
    const online = API.isOnline() && !!API.state.user;
    let rate = 930;
    try { rate = Number(localStorage.getItem("tokyoTrip.rate")) || 930; } catch {}
    if (online) { try { rate = (await API.get(Trips.q("/api/settings"))).rate ?? rate; } catch {} }

    const close = panel(`<div class="modal-card">${head("설정")}
      <div class="f-grid">
        <div class="f full"><label for="stRate">환율 · 100엔 =</label>
          <input id="stRate" type="number" min="1" step="1" value="${rate}">
          <span class="hint">가계부의 원화 환산에 씁니다. 오프라인에서도 쓰도록 직접 입력합니다.</span></div>
      </div>

      ${online ? `${sub("비밀번호 변경")}
      <form id="pwForm"><div class="f-grid">
        <div class="f full"><label for="pwCur">현재 비밀번호</label>
          <input id="pwCur" type="password" autocomplete="current-password" required></div>
        <div class="f full"><label for="pwNew">새 비밀번호</label>
          <input id="pwNew" type="password" autocomplete="new-password" minlength="8" required>
          <span class="hint">8자 이상. 바꾸면 다른 기기는 모두 로그아웃됩니다.</span></div>
      </div>
      <div id="pwErr"></div>
      <button type="submit" class="btn btn-primary" style="width:100%;margin-top:12px">비밀번호 변경</button>
      </form>` : ""}

      ${sub("앱")}
      <div style="display:flex;gap:7px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="stTheme" style="flex:0 0 auto;padding:11px 15px;font-size:13px">테마 전환</button>
        <button class="btn btn-ghost" id="stCache" style="flex:0 0 auto;padding:11px 15px;font-size:13px">캐시 비우기</button>
        <button class="btn btn-ghost" id="stKey" style="flex:0 0 auto;padding:11px 15px;font-size:13px">지도 키 삭제</button>
      </div>
      <div class="hint" style="margin-top:10px">캐시를 비우면 저장해 둔 오프라인 일정도 지워집니다. 온라인일 때만 하세요.</div>

      <div class="modal-actions"><button class="btn btn-ghost" data-cancel>닫기</button></div>
    </div>`);

    $("#stRate").addEventListener("change", async e => {
      const v = Number(e.target.value);
      if (!(v > 0)) return;
      try { localStorage.setItem("tokyoTrip.rate", String(v)); } catch {}
      if (online) { try { await API.patch("/api/settings", { tripId: Trips.getActive(), rate: v }); } catch {} }
    });

    $("#stTheme").onclick = () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("tokyoTrip.theme", next); } catch {}
    };

    $("#stCache").onclick = async () => {
      if (!confirm("저장해 둔 오프라인 일정과 캐시를 지웁니다.")) return;
      try { localStorage.removeItem("tokyoTrip.serverTrip"); } catch {}
      try { await Promise.all((await caches.keys()).map(k => caches.delete(k))); } catch {}
      location.reload();
    };

    $("#stKey").onclick = () => {
      if (!confirm("이 브라우저에 저장된 구글 지도 키를 지웁니다.")) return;
      try { localStorage.removeItem("tokyoTrip.gmapsKey"); } catch {}
      location.reload();
    };

    $("#pwForm")?.addEventListener("submit", async e => {
      e.preventDefault();
      $("#pwErr").innerHTML = "";
      try {
        await API.changePassword($("#pwCur").value, $("#pwNew").value);
        close();
        alert("비밀번호를 바꿨습니다. 다른 기기는 로그아웃되었습니다.");
      } catch (err) {
        $("#pwErr").innerHTML = `<div class="form-err">${esc(err.message)}</div>`;
      }
    });
  }

  /* -------------------------------------------------------------- 동행자 */
  async function openMembers() {
    panel(`<div class="modal-card">${head("동행자")}
      <div id="mmBody"><div style="padding:26px 0;text-align:center;color:var(--text-3)">불러오는 중…</div></div>
      <div class="modal-actions"><button class="btn btn-ghost" data-cancel>닫기</button></div>
    </div>`);

    try {
      const [mm, st] = await Promise.all([
        API.get(Trips.q("/api/members")),
        API.get(Trips.q("/api/expenses/settlement"))
      ]);

      const row = m => {
        const v = st.net?.[m.id] ?? 0;
        const tag = v > 0 ? `<b style="color:var(--good)">+${yen(v)}</b><div style="font-size:11px;color:var(--text-4)">받을 돈</div>`
                  : v < 0 ? `<b style="color:var(--crit)">${yen(v)}</b><div style="font-size:11px;color:var(--text-4)">낼 돈</div>`
                  : `<span style="color:var(--text-4);font-size:12px">정산 없음</span>`;
        return `<div style="display:flex;align-items:center;gap:11px;padding:13px 14px;border-radius:10px;background:var(--surface-2);margin-bottom:8px">
          <div style="width:34px;height:34px;flex:0 0 auto;border-radius:99px;display:grid;place-items:center;background:var(--accent-bg);color:var(--accent);font-weight:700">${esc((m.name || "?").trim().slice(0, 1))}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700">${esc(m.name)}</div>
            <div style="font-size:11.5px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.email)} · ${m.role === "viewer" ? "보기 전용" : "편집 가능"}</div>
          </div>
          <div style="text-align:right;font-variant-numeric:tabular-nums">${tag}</div>
        </div>`;
      };

      const arrow = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15M14 7l5 5-5 5"/></svg>`;

      $("#mmBody").innerHTML =
        mm.members.map(row).join("") +
        (st.transfers?.length
          ? sub("이렇게 주고받으면 끝납니다") +
            st.transfers.map(t => `<div style="display:flex;align-items:center;gap:9px;padding:13px 15px;border-radius:10px;background:var(--accent-bg);color:var(--accent);font-weight:700;font-size:13.5px;margin-bottom:7px">
                <span>${esc(t.fromName)}</span>${arrow}<span>${esc(t.toName)}</span>
                <span style="margin-left:auto;font-variant-numeric:tabular-nums">${yen(t.amount)}</span>
              </div>`).join("")
          : `<div style="margin-top:14px;padding:14px;border-radius:10px;background:var(--surface-2);color:var(--text-3);font-size:12.5px">아직 정산할 지출이 없습니다.</div>`) +
        `<div class="hint" style="margin-top:14px">동행자 추가·삭제는 관리자 화면에서 합니다.</div>`;
    } catch (e) {
      $("#mmBody").innerHTML = `<div class="form-err">${esc(e.message)}</div>`;
    }
  }

  Shell.on("settings", openSettings);
  Shell.on("members", openMembers);
})();
