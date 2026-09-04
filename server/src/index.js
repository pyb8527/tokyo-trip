/* ============================================================================
   HTTP 서버 진입점
   ========================================================================== */
import { createServer } from "node:http";
import { router } from "./routes.js";
import { db, purgeSessions } from "./db.js";
import { userFromToken, createSession, destroySession } from "./auth.js";
import {
  HttpError, send, parseCookies, SESSION_COOKIE, cookieHeader, clearCookieHeader
} from "./http.js";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
/* 리버스 프록시(nginx/Cloudflare) 뒤에서 HTTPS 로 서비스되면 1 로 둔다 */
const SECURE_COOKIE = process.env.SECURE_COOKIE !== "0";

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  /* 응답 헤더 기본값 */
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");

  if (!path.startsWith("/api/")) return send(res, 404, { error: "not found" });

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];

  const ctx = {
    req, res, url, params: {},
    ip: (req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")
        .toString().split(",")[0].trim(),
    user: userFromToken(token),
    _setCookie: null,
    login(user) {
      if (token) destroySession(token);
      const s = createSession(user.id, req.headers["user-agent"]);
      this.user = user;
      this._setCookie = cookieHeader(s.token, s.expires, SECURE_COOKIE);
    },
    logout() {
      destroySession(token);
      this.user = null;
      this._setCookie = clearCookieHeader(SECURE_COOKIE);
    }
  };

  try {
    /* CSRF — 브라우저 폼은 이 헤더를 붙일 수 없다. SameSite=Lax 와 이중으로 막는다. */
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (req.headers["x-requested-with"] !== "tokyo-trip")
        throw new HttpError(403, "잘못된 요청입니다.");
    }

    const hit = router.match(req.method, path);
    if (!hit) throw new HttpError(404, "없는 주소입니다.");
    if (hit.methodMismatch) throw new HttpError(405, "허용되지 않은 메서드입니다.");

    ctx.params = hit.params;
    const out = await hit.handler(ctx);
    send(res, 200, out ?? { ok: true }, ctx._setCookie ? { "Set-Cookie": ctx._setCookie } : {});
  } catch (e) {
    if (e instanceof HttpError) {
      send(res, e.status, { error: e.message, code: e.code },
           ctx._setCookie ? { "Set-Cookie": ctx._setCookie } : {});
    } else {
      console.error("[500]", req.method, path, e);
      send(res, 500, { error: "서버 오류가 발생했습니다." });
    }
  }
});

server.listen(PORT, HOST, () => {
  const n = db.prepare("SELECT COUNT(*) n FROM users").get().n;
  console.log(`[api] http://${HOST}:${PORT}  사용자 ${n}명`);
  if (n === 0) {
    console.log("[api] 아직 계정이 없습니다. /api/auth/setup 으로 첫 관리자를 만드세요.");
    console.log("[api] SETUP_TOKEN 이 " + (process.env.SETUP_TOKEN ? "설정되어 있습니다." : "설정되어 있지 않습니다 — .env 에 넣어주세요."));
  }
});

/* 만료 세션 정리 */
setInterval(() => {
  const n = purgeSessions();
  if (n) console.log(`[api] 만료 세션 ${n}건 정리`);
}, 6 * 60 * 60 * 1000).unref();

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { console.log(`[api] ${sig} 종료`); server.close(() => process.exit(0)); });
}
