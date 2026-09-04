/* ============================================================================
   아주 작은 HTTP 도우미 — 프레임워크 없이 라우팅·본문 파싱·쿠키만 처리한다
   ========================================================================== */
export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
export const bad      = (m, c) => { throw new HttpError(400, m, c); };
export const unauth   = (m = "로그인이 필요합니다.") => { throw new HttpError(401, m); };
export const forbid   = (m = "권한이 없습니다.") => { throw new HttpError(403, m); };
export const notFound = (m = "찾을 수 없습니다.") => { throw new HttpError(404, m); };

const MAX_BODY = 512 * 1024;

export async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, "본문이 너무 큽니다.");
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "JSON 형식이 아닙니다."); }
}

export function send(res, status, data, headers = {}) {
  const body = data === undefined ? "" : JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  res.end(body);
}

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const SESSION_COOKIE = "tt_session";

export function cookieHeader(token, expires, secure) {
  const bits = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expires).toUTCString()}`
  ];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

export function clearCookieHeader(secure) {
  const bits = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

/* ---------------------------------------------------------------- 라우터 */
export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp("^" + pattern.replace(/:([A-Za-z_]\w*)/g, (_, k) => {
      keys.push(k); return "([^/]+)";
    }) + "$");
    this.routes.push({ method, re, keys, handler });
    return this;
  }
  get(p, h)    { return this.add("GET", p, h); }
  post(p, h)   { return this.add("POST", p, h); }
  patch(p, h)  { return this.add("PATCH", p, h); }
  put(p, h)    { return this.add("PUT", p, h); }
  delete(p, h) { return this.add("DELETE", p, h); }

  match(method, path) {
    let pathExists = false;
    for (const r of this.routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      pathExists = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { handler: r.handler, params };
    }
    return pathExists ? { methodMismatch: true } : null;
  }
}
