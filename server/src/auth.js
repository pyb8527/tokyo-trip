/* ============================================================================
   인증 — scrypt 비밀번호 해시 + 서버 저장 세션
   ----------------------------------------------------------------------------
   · 비밀번호는 평문으로 어디에도 남기지 않는다. 로그에도 찍지 않는다.
   · 세션 토큰은 원본을 저장하지 않고 sha256 만 저장한다.
     DB 가 통째로 새어도 그것만으로는 로그인할 수 없다.
   ========================================================================== */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { db, newId, now, audit } from "./db.js";

/* N=2^15 이면 이 서버에서 한 번에 약 90ms. 온라인 무차별 대입을 충분히 억제한다. */
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltB64, hashB64] = stored.split("$");
    if (alg !== "scrypt") return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = scryptSync(password, salt, expected.length,
      { N: +N, r: +r, p: +p, maxmem: 96 * 1024 * 1024 });
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export const PASSWORD_RULE = "8자 이상이어야 합니다.";
export const validPassword = pw => typeof pw === "string" && pw.length >= 8 && pw.length <= 200;

/* ---------------------------------------------------------------- 세션 */
const SESSION_DAYS = 30;
const sha = s => createHash("sha256").update(s).digest("hex");

export function createSession(userId, userAgent) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare("INSERT INTO sessions(id,user_id,created_at,expires_at,user_agent) VALUES(?,?,?,?,?)")
    .run(sha(token), userId, now(), expires, (userAgent || "").slice(0, 200));
  return { token, expires };
}

export function userFromToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ?`).get(sha(token), now());
  if (!row || row.disabled) return null;
  return row;
}

export const destroySession = token =>
  token ? db.prepare("DELETE FROM sessions WHERE id=?").run(sha(token)).changes : 0;

export const destroyAllSessions = userId =>
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId).changes;

/* ---------------------------------------------------- 로그인 시도 제한 */
const attempts = new Map();                 // key -> { n, until }
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRIES = 10;

export function throttleCheck(key) {
  const rec = attempts.get(key);
  if (!rec) return { ok: true };
  if (Date.now() > rec.until) { attempts.delete(key); return { ok: true }; }
  if (rec.n >= MAX_TRIES) return { ok: false, retryAfter: Math.ceil((rec.until - Date.now()) / 1000) };
  return { ok: true };
}
export function throttleFail(key) {
  const rec = attempts.get(key);
  if (!rec || Date.now() > rec.until) attempts.set(key, { n: 1, until: Date.now() + WINDOW_MS });
  else rec.n++;
}
export const throttleReset = key => attempts.delete(key);

/* ---------------------------------------------------------------- 사용자 */
export function createUser({ email, name, password, role = "member" }) {
  const id = newId();
  db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)")
    .run(id, String(email).trim(), String(name).trim(), hashPassword(password), role, now());
  return db.prepare("SELECT * FROM users WHERE id=?").get(id);
}

export const publicUser = u => u && ({
  id: u.id, email: u.email, name: u.name, role: u.role,
  disabled: !!u.disabled, createdAt: u.created_at, lastLoginAt: u.last_login_at
});

export const userCount = () => db.prepare("SELECT COUNT(*) n FROM users").get().n;

export { audit };
