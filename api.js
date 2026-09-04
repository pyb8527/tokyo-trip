/* ============================================================================
   API 클라이언트
   ----------------------------------------------------------------------------
   서버가 없어도 앱이 죽지 않는 게 이 파일의 핵심 규칙입니다.
   /api 에 닿지 못하면 standalone 모드로 떨어져서, 지금처럼 index.html 에
   박혀 있는 일정을 그대로 보여줍니다. 여행 중 서버가 죽어도 일정은 봅니다.
   ========================================================================== */
const API = (() => {
  const state = {
    mode: "unknown",      // unknown | online | standalone
    user: null,
    tripRole: null,
    setupNeeded: false
  };

  async function call(method, path, body) {
    const headers = { "X-Requested-With": "tokyo-trip" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = new Error(data?.error || `요청 실패 (${res.status})`);
      err.status = res.status;
      err.code = data?.code;
      throw err;
    }
    return data;
  }

  const get    = p       => call("GET", p);
  const post   = (p, b)  => call("POST", p, b ?? {});
  const patch  = (p, b)  => call("PATCH", p, b ?? {});
  const put    = (p, b)  => call("PUT", p, b ?? {});
  const del    = p       => call("DELETE", p);

  /* 서버가 있는지, 로그인돼 있는지 확인한다. 실패해도 예외를 던지지 않는다. */
  async function probe() {
    try {
      const me = await get("/api/auth/me");
      state.mode = "online";
      state.user = me.user;
      state.tripRole = me.tripRole ?? null;
      state.setupNeeded = !!me.setupNeeded;
    } catch (e) {
      /* 404 면 서버가 아직 붙지 않은 것, 네트워크 오류면 오프라인.
         둘 다 "서버 없이 동작" 으로 처리한다. */
      state.mode = "standalone";
      state.user = null;
      state.tripRole = null;      /* 앞선 성공 결과가 남아 편집 가능으로 보이면 안 된다 */
    }
    return state;
  }

  const canEdit = () =>
    state.mode === "online" && !!state.user &&
    (state.user.role === "admin" || state.tripRole === "editor");

  return {
    state, probe, get, post, patch, put, del, canEdit,
    isOnline: () => state.mode === "online",
    login:  (email, password) => post("/api/auth/login", { email, password }),
    logout: () => post("/api/auth/logout"),
    setup:  b => post("/api/auth/setup", b),
    changePassword: (current, next) => post("/api/auth/password", { current, next })
  };
})();
