/* ============================================================================
   공통 셸 — 로그인 게이트 · 좌측 드로어 · 하단 바로가기
   ----------------------------------------------------------------------------
   페이지에서 이렇게 씁니다:
     Shell.init({ page: "trip" })     // 또는 "expenses"
   서버가 없으면(standalone) 로그인 화면을 띄우지 않고 그냥 통과시킵니다.
   ========================================================================== */
const Shell = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const ICON = {
    menu:   '<path d="M4 7h16M4 12h16M4 17h16"/>',
    trip:   '<path d="M9 4.5h10M9 12h10M9 19.5h10"/><circle cx="4.5" cy="4.5" r="1.5"/><circle cx="4.5" cy="12" r="1.5"/><circle cx="4.5" cy="19.5" r="1.5"/>',
    map:    '<path d="m9 4.5-5.5 2.4v13L9 17.5l6 2 5.5-2.4v-13L15 6.5z"/><path d="M9 4.5v13M15 6.5v13"/>',
    money:  '<path d="M4 7.5h16v11H4Z"/><circle cx="12" cy="13" r="2.6"/><path d="M4 4.5h16"/>',
    edit:   '<path d="M4 20h4l10-10-4-4L4 16Z"/><path d="m14.5 5.5 4 4"/>',
    people: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16 6.5a3 3 0 0 1 0 6M17.5 19.5c0-2-.6-3.6-1.7-4.7"/>',
    shield: '<path d="M12 3.5 20 6v6c0 4.5-3.4 7.7-8 8.5-4.6-.8-8-4-8-8.5V6Z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
    gear:   '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/>',
    out:    '<path d="M14 4.5H6.5v15H14"/><path d="M18.5 12H10M15.5 8.5 19 12l-3.5 3.5"/>',
    more:   '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'
  };
  const svg = (d, size = 20) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  let opts = { page: "trip", title: "도쿄 3박 4일" };
  const listeners = {};
  const on = (evt, fn) => ((listeners[evt] ||= []).push(fn));
  const emit = (evt, arg) => (listeners[evt] || []).forEach(f => f(arg));
  /* 아직 만들지 않은 화면이 메뉴에 죽은 항목으로 뜨지 않도록,
     처리기가 등록된 기능만 보여준다. */
  const has = evt => !!listeners[evt]?.length;

  /* ---------------------------------------------------------------- 로그인 */
  function authScreenHTML(setupNeeded) {
    return setupNeeded ? `
      <div class="auth-card">
        <h2>첫 관리자 만들기</h2>
        <p class="sub">아직 계정이 없습니다. 서버의 <b>SETUP_TOKEN</b> 을 넣어 관리자 계정을 만드세요.
          계정이 하나라도 생기면 이 화면은 다시 나오지 않습니다.</p>
        <form id="setupForm">
          <div class="auth-field"><label for="suToken">설치 토큰</label>
            <input id="suToken" type="password" autocomplete="off" required></div>
          <div class="auth-field"><label for="suEmail">이메일</label>
            <input id="suEmail" type="email" autocomplete="username" required></div>
          <div class="auth-field"><label for="suName">이름</label>
            <input id="suName" type="text" autocomplete="name" required></div>
          <div class="auth-field"><label for="suPw">비밀번호</label>
            <input id="suPw" type="password" autocomplete="new-password" minlength="8" required>
          </div>
          <button class="auth-btn" type="submit">관리자 만들기</button>
          <div id="authErr"></div>
        </form>
        <p class="auth-note">비밀번호는 8자 이상이어야 합니다. 이 주소는 인터넷에 공개되어 있으니
          추측하기 쉬운 값은 쓰지 마세요.</p>
      </div>` : `
      <div class="auth-card">
        <h2>로그인</h2>
        <p class="sub">${esc(opts.title)}</p>
        <form id="loginForm">
          <div class="auth-field"><label for="liEmail">이메일</label>
            <input id="liEmail" type="email" autocomplete="username" required autofocus></div>
          <div class="auth-field"><label for="liPw">비밀번호</label>
            <input id="liPw" type="password" autocomplete="current-password" required></div>
          <button class="auth-btn" type="submit">로그인</button>
          <div id="authErr"></div>
        </form>
        <p class="auth-note">계정은 관리자가 만들어 줍니다. 가입 기능은 없습니다.</p>
      </div>`;
  }

  function showAuth(setupNeeded) {
    let el = $("#authScreen");
    if (!el) {
      el = document.createElement("div");
      el.id = "authScreen";
      el.className = "auth-screen";
      document.body.appendChild(el);
    }
    el.innerHTML = authScreenHTML(setupNeeded);
    el.hidden = false;

    const fail = msg => { $("#authErr").innerHTML = `<div class="auth-err">${esc(msg)}</div>`; };
    const busy = (form, yes) => {
      const b = form.querySelector("button[type=submit]");
      b.disabled = yes;
      b.textContent = yes ? "잠시만요…" : (form.id === "setupForm" ? "관리자 만들기" : "로그인");
    };

    $("#loginForm")?.addEventListener("submit", async e => {
      e.preventDefault(); busy(e.target, true); $("#authErr").innerHTML = "";
      try {
        await API.login($("#liEmail").value.trim(), $("#liPw").value);
        location.reload();
      } catch (err) { fail(err.message); busy(e.target, false); }
    });

    $("#setupForm")?.addEventListener("submit", async e => {
      e.preventDefault(); busy(e.target, true); $("#authErr").innerHTML = "";
      try {
        await API.setup({
          token: $("#suToken").value, email: $("#suEmail").value.trim(),
          name: $("#suName").value.trim(), password: $("#suPw").value
        });
        location.reload();
      } catch (err) { fail(err.message); busy(e.target, false); }
    });
  }

  /* ---------------------------------------------------------------- 드로어 */
  function menuHTML() {
    const u = API.state.user;
    const isAdmin = u?.role === "admin";
    const item = (href, icon, label, key, extra = "") =>
      `<a class="drawer-item${opts.page === key ? " current" : ""}" href="${href}" data-nav="${key}">
         ${svg(icon)}<span>${label}</span>${extra}</a>`;

    return `
      <div class="drawer-head">
        ${u ? `<div class="drawer-name">${esc(u.name)}</div>
               <div class="drawer-mail">${esc(u.email)}</div>
               <span class="drawer-badge${isAdmin ? "" : " off"}">${isAdmin ? "관리자" : "동행자"}</span>`
            : `<div class="drawer-name">${esc(opts.title)}</div>
               <div class="drawer-mail">서버 없이 보는 중</div>
               <span class="drawer-badge off">읽기 전용</span>`}
      </div>
      <nav class="drawer-nav">
        ${item("index.html#all", ICON.trip, "일정", "trip")}
        ${item("expenses.html", ICON.money, "가계부", "expenses")}
        ${API.isOnline() && API.state.user && has("members") ? `<button class="drawer-item" data-act="members">${svg(ICON.people)}<span>동행자</span></button>` : ""}
        ${isAdmin ? `<a class="drawer-item" href="admin.html" data-nav="admin">${svg(ICON.shield)}<span>관리자</span></a>` : ""}
        <div class="drawer-sep"></div>
        ${has("settings") ? `<button class="drawer-item" data-act="settings">${svg(ICON.gear)}<span>설정</span></button>` : ""}
        ${u ? `<button class="drawer-item" data-act="logout">${svg(ICON.out)}<span>로그아웃</span></button>` : ""}
      </nav>
      <div class="drawer-foot">
        ${API.isOnline() ? "서버 연결됨" : "서버에 연결되지 않아 저장된 일정만 표시합니다"}
      </div>`;
  }

  function buildShell() {
    /* 스크림 + 드로어 */
    const scrim = document.createElement("div");
    scrim.className = "scrim"; scrim.id = "scrim";
    const drawer = document.createElement("nav");
    drawer.className = "drawer"; drawer.id = "drawer";
    drawer.setAttribute("aria-label", "메뉴");
    drawer.innerHTML = menuHTML();
    document.body.append(scrim, drawer);

    const close = () => { drawer.classList.remove("open"); scrim.classList.remove("open"); };
    const open  = () => { drawer.innerHTML = menuHTML(); wireDrawer(); drawer.classList.add("open"); scrim.classList.add("open"); };
    scrim.addEventListener("click", close);
    addEventListener("keydown", e => { if (e.key === "Escape") close(); });

    function wireDrawer() {
      drawer.querySelectorAll("[data-act]").forEach(b => b.onclick = async () => {
        const act = b.dataset.act;
        close();
        if (act === "logout") {
          try { await API.logout(); } catch {}
          location.reload();
        } else {
          emit(act);
        }
      });
      drawer.querySelectorAll("[data-nav]").forEach(a => a.addEventListener("click", close));
    }
    wireDrawer();

    /* 하단 바로가기 */
    const tabbar = document.createElement("nav");
    tabbar.className = "tabbar";
    tabbar.innerHTML = `
      <div class="tabbar-in">
        <a href="index.html#all" class="${opts.page === "trip" ? "on" : ""}">${svg(ICON.trip, 21)}일정</a>
        <button id="tabMap" class="${opts.page === "map" ? "on" : ""}">${svg(ICON.map, 21)}지도</button>
        <a href="expenses.html" class="${opts.page === "expenses" ? "on" : ""}">${svg(ICON.money, 21)}가계부</a>
        <button id="tabMore">${svg(ICON.more, 21)}더보기</button>
      </div>`;
    document.body.appendChild(tabbar);
    document.body.classList.add("has-tabbar");
    $("#tabMore").onclick = open;
    $("#tabMap").onclick = () => {
      if (opts.page === "trip") emit("map");
      else location.href = "index.html#all";
    };

    return { open, close };
  }

  /* ---------------------------------------------------------------- 진입 */
  async function init(options = {}) {
    opts = { ...opts, ...options };
    await API.probe();

    /* 서버가 붙어 있는데 로그인 안 된 상태에서만 막는다.
       서버가 없으면(standalone) 지금까지처럼 그냥 보여준다. */
    if (API.isOnline() && !API.state.user) {
      showAuth(API.state.setupNeeded);
      return { blocked: true };
    }

    const ctl = buildShell();

    /* 페이지가 심어 둔 햄버거 버튼들을 연결 */
    document.querySelectorAll("[data-shell-menu]").forEach(b => b.onclick = ctl.open);

    return { blocked: false, ...ctl };
  }

  return { init, on, emit, has, svg, ICON, esc };
})();
