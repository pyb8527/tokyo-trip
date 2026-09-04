/* ============================================================================
   API 라우트
   ========================================================================== */
import { db, newId, now, audit, getSetting, setSetting } from "./db.js";
import {
  createSession, destroySession, destroyAllSessions, verifyPassword, hashPassword,
  createUser, publicUser, userCount, validPassword, PASSWORD_RULE,
  throttleCheck, throttleFail, throttleReset
} from "./auth.js";
import { Router, readJson, bad, unauth, forbid, notFound, HttpError } from "./http.js";

export const router = new Router();

/* ---------------------------------------------------------------- 도우미 */
const requireUser = ctx => ctx.user || unauth();
const requireAdmin = ctx => {
  const u = requireUser(ctx);
  if (u.role !== "admin") forbid("관리자만 할 수 있습니다.");
  return u;
};

/* 여행 id 를 주면 그 여행, 없으면 가장 먼저 만든 여행 */
const theTrip = (id) => {
  const t = id
    ? db.prepare("SELECT * FROM trips WHERE id=?").get(id)
    : db.prepare("SELECT * FROM trips ORDER BY created_at LIMIT 1").get();
  if (!t) notFound("여행을 찾을 수 없습니다.");
  return t;
};

/* 요청에서 여행 id 를 뽑는다 (?trip=... 또는 본문의 tripId) */
const tripIdOf = (ctx, body) => body?.tripId || ctx.url.searchParams.get("trip") || null;

/* 날짜 문자열 도우미 — iso(2026-10-08) 로부터 "10.08 (목)" 을 만든다 */
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
/* 날짜 계산은 반드시 UTC 로 한다.
   "2027-03-05T00:00:00" 은 로컬 자정으로 파싱되는데 toISOString() 은 UTC 로
   되돌리므로, UTC+9 서버에서는 하루가 밀려 2027-03-04 가 되어 버린다. */
function labelFromIso(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return null;
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")} (${WEEK[d.getUTCDay()]})`;
}
const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const DAY_COLORS = ["#f04452", "#e07800", "#7c5cff", "#00a98f", "#3182f6", "#e8590c", "#12b886", "#845ef7"];

/* 여행 멤버이거나 관리자여야 편집할 수 있다 */
function requireEditor(ctx, tripId) {
  const u = requireUser(ctx);
  if (u.role === "admin") return u;
  const trip = theTrip(tripId);
  const m = db.prepare("SELECT * FROM trip_members WHERE trip_id=? AND user_id=?").get(trip.id, u.id);
  if (!m) forbid("이 여행의 동행자가 아닙니다.");
  if (m.role === "viewer") forbid("보기 전용 권한입니다.");
  return u;
}
function requireMember(ctx, tripId) {
  const u = requireUser(ctx);
  if (u.role === "admin") return u;
  const trip = theTrip(tripId);
  const m = db.prepare("SELECT * FROM trip_members WHERE trip_id=? AND user_id=?").get(trip.id, u.id);
  if (!m) forbid("이 여행의 동행자가 아닙니다.");
  return u;
}

const J = v => (v == null ? null : JSON.parse(v));
const S = v => (v == null ? null : JSON.stringify(v));

const placeOut = p => ({
  id: p.id, dayId: p.day_id, sort: p.sort,
  name: p.name, ja: p.ja, en: p.en, lat: p.lat, lng: p.lng,
  cat: p.cat, time: p.time, cost: p.cost, note: p.note, url: p.url,
  radius: p.radius, fit: !!p.fit, move: J(p.move),
  updatedAt: p.updated_at, updatedBy: p.updated_by
});

/* ============================================================ 인증 */
router.get("/api/auth/me", ctx => {
  if (!ctx.user) return { user: null, setupNeeded: userCount() === 0 };
  const trip = db.prepare("SELECT * FROM trips ORDER BY created_at LIMIT 1").get();
  const membership = trip
    ? db.prepare("SELECT role FROM trip_members WHERE trip_id=? AND user_id=?").get(trip.id, ctx.user.id)
    : null;
  return {
    user: publicUser(ctx.user),
    tripRole: ctx.user.role === "admin" ? "editor" : (membership?.role ?? null)
  };
});

/* 최초 1회: 사용자가 하나도 없을 때만 관리자 계정을 만든다.
   SETUP_TOKEN 환경변수를 맞춰야 하므로 외부에서 임의로 만들 수 없다. */
router.post("/api/auth/setup", async ctx => {
  if (userCount() > 0) bad("이미 설정이 끝났습니다.");
  const body = await readJson(ctx.req);
  const expected = process.env.SETUP_TOKEN;
  if (!expected) bad("서버에 SETUP_TOKEN 이 설정되어 있지 않습니다.");
  if (body.token !== expected) forbid("설치 토큰이 올바르지 않습니다.");
  if (!body.email || !body.name) bad("이메일과 이름이 필요합니다.");
  if (!validPassword(body.password)) bad("비밀번호는 " + PASSWORD_RULE);

  const user = createUser({ email: body.email, name: body.name, password: body.password, role: "admin" });
  const tripId = newId();
  db.prepare("INSERT INTO trips(id,title,owner_id,created_at) VALUES(?,?,?,?)")
    .run(tripId, "도쿄 3박 4일", user.id, now());
  db.prepare("INSERT INTO trip_members(trip_id,user_id,role) VALUES(?,?,?)").run(tripId, user.id, "editor");
  audit(user.id, "setup", user.id, { email: user.email });
  ctx.login(user);
  return { user: publicUser(user) };
});

router.post("/api/auth/login", async ctx => {
  const body = await readJson(ctx.req);
  const email = String(body.email || "").trim().toLowerCase();
  const key = `${ctx.ip}|${email}`;
  const t = throttleCheck(key);
  if (!t.ok) throw new HttpError(429, `시도가 너무 많습니다. ${t.retryAfter}초 뒤에 다시 해주세요.`);

  const user = db.prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE").get(email);
  /* 계정 존재 여부가 응답으로 새지 않도록 메시지를 하나로 통일한다 */
  const fail = () => { throttleFail(key); throw new HttpError(401, "이메일 또는 비밀번호가 올바르지 않습니다."); };
  if (!user || user.disabled) fail();
  if (!verifyPassword(String(body.password || ""), user.password_hash)) fail();

  throttleReset(key);
  db.prepare("UPDATE users SET last_login_at=? WHERE id=?").run(now(), user.id);
  audit(user.id, "login", user.id);
  ctx.login(user);
  return { user: publicUser(user) };
});

router.post("/api/auth/logout", ctx => { ctx.logout(); return { ok: true }; });

router.post("/api/auth/password", async ctx => {
  const u = requireUser(ctx);
  const body = await readJson(ctx.req);
  if (!verifyPassword(String(body.current || ""), u.password_hash)) bad("현재 비밀번호가 올바르지 않습니다.");
  if (!validPassword(body.next)) bad("새 비밀번호는 " + PASSWORD_RULE);
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hashPassword(body.next), u.id);
  destroyAllSessions(u.id);          // 다른 기기 로그아웃
  audit(u.id, "password.change", u.id);
  ctx.login(db.prepare("SELECT * FROM users WHERE id=?").get(u.id));
  return { ok: true };
});

/* ============================================================ 관리자 */
router.get("/api/admin/users", ctx => {
  requireAdmin(ctx);
  return { users: db.prepare("SELECT * FROM users ORDER BY created_at").all().map(publicUser) };
});

router.post("/api/admin/users", async ctx => {
  const me = requireAdmin(ctx);
  const b = await readJson(ctx.req);
  if (!b.email || !b.name) bad("이메일과 이름이 필요합니다.");
  if (!validPassword(b.password)) bad("비밀번호는 " + PASSWORD_RULE);
  if (db.prepare("SELECT 1 FROM users WHERE email=? COLLATE NOCASE").get(String(b.email).trim()))
    bad("이미 있는 이메일입니다.");
  const role = b.role === "admin" ? "admin" : "member";
  const user = createUser({ email: b.email, name: b.name, password: b.password, role });

  /* 만들자마자 이번 여행의 동행자로 넣어 준다 */
  const trip = db.prepare("SELECT * FROM trips ORDER BY created_at LIMIT 1").get();
  if (trip) db.prepare("INSERT OR IGNORE INTO trip_members(trip_id,user_id,role) VALUES(?,?,?)")
    .run(trip.id, user.id, b.tripRole === "viewer" ? "viewer" : "editor");

  audit(me.id, "user.create", user.id, { email: user.email, role });
  return { user: publicUser(user) };
});

router.patch("/api/admin/users/:id", async ctx => {
  const me = requireAdmin(ctx);
  const target = db.prepare("SELECT * FROM users WHERE id=?").get(ctx.params.id) || notFound();
  const b = await readJson(ctx.req);
  const name = b.name?.trim() || target.name;
  const role = b.role === "admin" ? "admin" : b.role === "member" ? "member" : target.role;
  const disabled = b.disabled === undefined ? target.disabled : (b.disabled ? 1 : 0);

  /* 관리자가 한 명도 남지 않으면 아무도 관리할 수 없게 된다.
     판단 기준은 "대상을 뺀 나머지 활성 관리자" 다. 대상이 이미 비활성이면
     지금도 관리 인원에서 빠져 있으므로 막을 이유가 없다. */
  const otherAdmins = db.prepare(
    "SELECT COUNT(*) n FROM users WHERE role='admin' AND disabled=0 AND id != ?").get(target.id).n;
  const targetWasActiveAdmin = target.role === "admin" && !target.disabled;
  const staysActiveAdmin = role === "admin" && !disabled;
  if (targetWasActiveAdmin && !staysActiveAdmin && otherAdmins === 0)
    bad("마지막 관리자입니다. 다른 관리자를 먼저 지정해 주세요.");

  db.prepare("UPDATE users SET name=?, role=?, disabled=? WHERE id=?").run(name, role, disabled, target.id);
  if (disabled) destroyAllSessions(target.id);
  audit(me.id, "user.update", target.id, { name, role, disabled });
  return { user: publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(target.id)) };
});

router.post("/api/admin/users/:id/password", async ctx => {
  const me = requireAdmin(ctx);
  const target = db.prepare("SELECT * FROM users WHERE id=?").get(ctx.params.id) || notFound();
  const b = await readJson(ctx.req);
  if (!validPassword(b.password)) bad("비밀번호는 " + PASSWORD_RULE);
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hashPassword(b.password), target.id);
  destroyAllSessions(target.id);
  audit(me.id, "user.password", target.id);
  return { ok: true };
});

router.delete("/api/admin/users/:id", ctx => {
  const me = requireAdmin(ctx);
  const target = db.prepare("SELECT * FROM users WHERE id=?").get(ctx.params.id) || notFound();
  if (target.id === me.id) bad("자기 계정은 지울 수 없습니다.");
  const otherAdmins = db.prepare(
    "SELECT COUNT(*) n FROM users WHERE role='admin' AND disabled=0 AND id != ?").get(target.id).n;
  if (target.role === "admin" && !target.disabled && otherAdmins === 0)
    bad("마지막 관리자는 지울 수 없습니다.");
  db.prepare("DELETE FROM users WHERE id=?").run(target.id);
  audit(me.id, "user.delete", target.id, { email: target.email });
  return { ok: true };
});

router.get("/api/admin/audit", ctx => {
  requireAdmin(ctx);
  const rows = db.prepare(`
    SELECT a.*, u.name AS user_name FROM audit a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC LIMIT 200`).all();
  return { audit: rows.map(r => ({ ...r, detail: J(r.detail) })) };
});

/* ============================================================ 여행 */

/* 내가 볼 수 있는 여행 목록 (관리자는 전부) */
router.get("/api/trips", ctx => {
  const u = requireUser(ctx);
  const rows = u.role === "admin"
    ? db.prepare("SELECT * FROM trips ORDER BY created_at").all()
    : db.prepare(`SELECT t.* FROM trips t JOIN trip_members m ON m.trip_id = t.id
                  WHERE m.user_id = ? ORDER BY t.created_at`).all(u.id);
  return {
    trips: rows.map(t => {
      const days = db.prepare("SELECT iso FROM days WHERE trip_id=? ORDER BY sort").all(t.id);
      const n = db.prepare(`SELECT COUNT(*) n FROM places p JOIN days d ON d.id=p.day_id
                            WHERE d.trip_id=?`).get(t.id).n;
      return {
        id: t.id, title: t.title, ownerId: t.owner_id, createdAt: t.created_at,
        dayCount: days.length, placeCount: n,
        startIso: days[0]?.iso ?? null, endIso: days[days.length - 1]?.iso ?? null
      };
    })
  };
});

/* 새 여행 — 시작일과 일수를 주면 날짜를 자동으로 깔아 준다 */
router.post("/api/trips", async ctx => {
  const u = requireUser(ctx);
  const b = await readJson(ctx.req);
  const title = String(b.title || "").trim();
  if (!title) bad("여행 이름이 필요합니다.");
  const startIso = String(b.startIso || "");
  if (!labelFromIso(startIso)) bad("시작일이 올바르지 않습니다. (YYYY-MM-DD)");
  const nights = Math.max(0, Math.min(30, Number(b.nights ?? 0)));
  const dayCount = nights + 1;

  const id = newId();
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO trips(id,title,owner_id,created_at) VALUES(?,?,?,?)").run(id, title, u.id, now());
    db.prepare("INSERT INTO trip_members(trip_id,user_id,role) VALUES(?,?,?)").run(id, u.id, "editor");
    const ins = db.prepare(`INSERT INTO days(id,trip_id,sort,label,short,date,iso,theme,color,budget,flight)
                            VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    for (let i = 0; i < dayCount; i++) {
      const iso = addDays(startIso, i);
      ins.run(newId(), id, i, `Day ${i + 1}`, null, labelFromIso(iso), iso, null,
              DAY_COLORS[i % DAY_COLORS.length], null, null);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }

  audit(u.id, "trip.create", id, { title, startIso, nights });
  return { trip: { id, title } };
});

router.patch("/api/trips/:id", async ctx => {
  const u = requireEditor(ctx, ctx.params.id);
  const trip = theTrip(ctx.params.id);
  const b = await readJson(ctx.req);
  if (b.title !== undefined) {
    const title = String(b.title).trim();
    if (!title) bad("여행 이름이 비어 있습니다.");
    db.prepare("UPDATE trips SET title=? WHERE id=?").run(title, trip.id);
  }
  /* 시작일을 옮기면 모든 날짜가 같은 간격으로 따라 움직인다 */
  if (b.startIso) {
    if (!labelFromIso(b.startIso)) bad("시작일이 올바르지 않습니다.");
    const days = db.prepare("SELECT * FROM days WHERE trip_id=? ORDER BY sort").all(trip.id);
    const up = db.prepare("UPDATE days SET iso=?, date=? WHERE id=?");
    db.exec("BEGIN");
    try {
      days.forEach((d, i) => {
        const iso = addDays(b.startIso, i);
        up.run(iso, labelFromIso(iso), d.id);
      });
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  }
  audit(u.id, "trip.update", trip.id, { title: b.title, startIso: b.startIso });
  return { ok: true };
});

router.delete("/api/trips/:id", ctx => {
  const u = requireUser(ctx);
  const trip = theTrip(ctx.params.id);
  if (u.role !== "admin" && trip.owner_id !== u.id)
    forbid("여행을 만든 사람이나 관리자만 지울 수 있습니다.");
  const total = db.prepare("SELECT COUNT(*) n FROM trips").get().n;
  if (total <= 1) bad("마지막 여행은 지울 수 없습니다.");
  db.prepare("DELETE FROM trips WHERE id=?").run(trip.id);   // days·places·expenses 는 CASCADE
  audit(u.id, "trip.delete", trip.id, { title: trip.title });
  return { ok: true };
});

/* ---------------------------------------------------------------- 날짜 */
router.post("/api/days", async ctx => {
  const b = await readJson(ctx.req);
  const trip = theTrip(tripIdOf(ctx, b));
  const u = requireEditor(ctx, trip.id);
  const days = db.prepare("SELECT * FROM days WHERE trip_id=? ORDER BY sort").all(trip.id);
  const last = days[days.length - 1];
  const iso = b.iso || (last?.iso ? addDays(last.iso, 1) : null);
  if (iso && !labelFromIso(iso)) bad("날짜가 올바르지 않습니다.");
  const id = newId();
  db.prepare(`INSERT INTO days(id,trip_id,sort,label,short,date,iso,theme,color,budget,flight)
              VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, trip.id, days.length, b.label || `Day ${days.length + 1}`, b.short ?? null,
         iso ? labelFromIso(iso) : null, iso, b.theme ?? null,
         b.color || DAY_COLORS[days.length % DAY_COLORS.length], b.budget ?? null, null);
  audit(u.id, "day.create", id);
  return { dayId: id };
});

router.delete("/api/days/:id", ctx => {
  const day = db.prepare("SELECT * FROM days WHERE id=?").get(ctx.params.id) || notFound();
  const u = requireEditor(ctx, day.trip_id);
  const n = db.prepare("SELECT COUNT(*) n FROM days WHERE trip_id=?").get(day.trip_id).n;
  if (n <= 1) bad("마지막 날짜는 지울 수 없습니다.");
  db.prepare("DELETE FROM days WHERE id=?").run(day.id);      // places 는 CASCADE
  /* 순번을 다시 매긴다 */
  const rest = db.prepare("SELECT id FROM days WHERE trip_id=? ORDER BY sort").all(day.trip_id);
  const up = db.prepare("UPDATE days SET sort=? WHERE id=?");
  rest.forEach((d, i) => up.run(i, d.id));
  audit(u.id, "day.delete", day.id, { label: day.label });
  return { ok: true };
});

router.get("/api/trip", ctx => {
  const tripId = ctx.url.searchParams.get("trip");
  const u = requireMember(ctx, tripId);
  const trip = theTrip(tripId);
  const days = db.prepare("SELECT * FROM days WHERE trip_id=? ORDER BY sort").all(trip.id);
  const places = db.prepare(`
    SELECT p.* FROM places p JOIN days d ON d.id = p.day_id
    WHERE d.trip_id=? ORDER BY d.sort, p.sort`).all(trip.id);
  const visited = db.prepare("SELECT place_id FROM visits WHERE user_id=?").all(u.id).map(r => r.place_id);
  const members = db.prepare(`
    SELECT u.id, u.name, u.email, m.role FROM trip_members m JOIN users u ON u.id = m.user_id
    WHERE m.trip_id=?`).all(trip.id);

  return {
    trip: {
      id: trip.id, title: trip.title, ownerId: trip.owner_id,
      startIso: days[0]?.iso ?? null, endIso: days[days.length - 1]?.iso ?? null
    },
    days: days.map(d => ({
      id: d.id, sort: d.sort, label: d.label, short: d.short, date: d.date, iso: d.iso,
      theme: d.theme, color: d.color, budget: d.budget, flight: J(d.flight),
      places: places.filter(p => p.day_id === d.id).map(placeOut)
    })),
    visited,
    members
  };
});

router.patch("/api/days/:id", async ctx => {
  const day = db.prepare("SELECT * FROM days WHERE id=?").get(ctx.params.id) || notFound();
  const u = requireEditor(ctx, day.trip_id);
  const b = await readJson(ctx.req);
  /* iso 를 바꾸면 화면에 뿌릴 "10.08 (목)" 도 같이 맞춘다 */
  if (b.iso !== undefined && b.iso) {
    if (!labelFromIso(b.iso)) bad("날짜가 올바르지 않습니다. (YYYY-MM-DD)");
    if (b.date === undefined) b.date = labelFromIso(b.iso);
  }
  const f = (k, cur) => (b[k] === undefined ? cur : b[k]);
  db.prepare(`UPDATE days SET label=?, short=?, date=?, iso=?, theme=?, color=?, budget=?, flight=? WHERE id=?`)
    .run(f("label", day.label), f("short", day.short), f("date", day.date), f("iso", day.iso),
         f("theme", day.theme), f("color", day.color), f("budget", day.budget),
         b.flight === undefined ? day.flight : S(b.flight), day.id);
  audit(u.id, "day.update", day.id);
  return { ok: true };
});

/* ---------------------------------------------------------------- 장소 */
function validPlace(b, partial) {
  if (!partial || b.name !== undefined)
    if (!b.name || !String(b.name).trim()) bad("장소 이름이 필요합니다.");
  for (const k of ["lat", "lng"]) {
    if (!partial || b[k] !== undefined) {
      const v = Number(b[k]);
      if (!Number.isFinite(v)) bad("좌표가 올바르지 않습니다.");
      if (k === "lat" && (v < -90 || v > 90)) bad("위도가 범위를 벗어났습니다.");
      if (k === "lng" && (v < -180 || v > 180)) bad("경도가 범위를 벗어났습니다.");
    }
  }
  if (b.time !== undefined && b.time && !/^\d{1,2}:\d{2}$/.test(b.time)) bad("시간은 HH:MM 형식이어야 합니다.");
}

/* 시간이 있으면 시간순으로, 없으면 뒤에 붙인다 */
function resortDay(dayId) {
  const rows = db.prepare("SELECT id, time, sort FROM places WHERE day_id=?").all(dayId);
  const mins = t => { if (!t) return 1e9; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  rows.sort((a, b) => mins(a.time) - mins(b.time) || a.sort - b.sort);
  const up = db.prepare("UPDATE places SET sort=? WHERE id=?");
  rows.forEach((r, i) => up.run(i, r.id));
}

router.post("/api/places", async ctx => {
  const b = await readJson(ctx.req);
  const day = db.prepare("SELECT * FROM days WHERE id=?").get(b.dayId) || notFound("날짜를 찾을 수 없습니다.");
  const u = requireEditor(ctx, day.trip_id);
  validPlace(b, false);
  const id = newId();
  const maxSort = db.prepare("SELECT COALESCE(MAX(sort),-1) s FROM places WHERE day_id=?").get(day.id).s;
  db.prepare(`INSERT INTO places
      (id,day_id,sort,name,ja,en,lat,lng,cat,time,cost,note,url,radius,fit,move,updated_at,updated_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, day.id, maxSort + 1, String(b.name).trim(), b.ja ?? null, b.en ?? null,
         Number(b.lat), Number(b.lng), b.cat ?? null, b.time ?? null, b.cost ?? null,
         b.note ?? null, b.url ?? null, b.radius ?? null, b.fit === false ? 0 : 1,
         S(b.move), now(), u.id);
  resortDay(day.id);
  audit(u.id, "place.create", id, { name: b.name, day: day.label });
  return { place: placeOut(db.prepare("SELECT * FROM places WHERE id=?").get(id)) };
});

router.patch("/api/places/:id", async ctx => {
  const p = db.prepare("SELECT * FROM places WHERE id=?").get(ctx.params.id) || notFound();
  const u = requireEditor(ctx, db.prepare("SELECT trip_id FROM days WHERE id=?").get(p.day_id)?.trip_id);
  const b = await readJson(ctx.req);
  validPlace(b, true);
  const f = (k, cur) => (b[k] === undefined ? cur : b[k]);
  db.prepare(`UPDATE places SET name=?, ja=?, en=?, lat=?, lng=?, cat=?, time=?, cost=?,
              note=?, url=?, radius=?, fit=?, move=?, updated_at=?, updated_by=? WHERE id=?`)
    .run(String(f("name", p.name)).trim(), f("ja", p.ja), f("en", p.en),
         Number(f("lat", p.lat)), Number(f("lng", p.lng)), f("cat", p.cat), f("time", p.time),
         f("cost", p.cost), f("note", p.note), f("url", p.url), f("radius", p.radius),
         b.fit === undefined ? p.fit : (b.fit ? 1 : 0),
         b.move === undefined ? p.move : S(b.move), now(), u.id, p.id);
  if (b.time !== undefined) resortDay(p.day_id);
  audit(u.id, "place.update", p.id, { name: f("name", p.name) });
  return { place: placeOut(db.prepare("SELECT * FROM places WHERE id=?").get(p.id)) };
});

router.delete("/api/places/:id", ctx => {
  const p = db.prepare("SELECT * FROM places WHERE id=?").get(ctx.params.id) || notFound();
  const u = requireEditor(ctx, db.prepare("SELECT trip_id FROM days WHERE id=?").get(p.day_id)?.trip_id);
  db.prepare("DELETE FROM places WHERE id=?").run(p.id);
  resortDay(p.day_id);
  audit(u.id, "place.delete", p.id, { name: p.name });
  return { ok: true };
});

/* 순서를 직접 지정하고 싶을 때 (시간 자동정렬을 쓰지 않는 경우) */
router.post("/api/places/reorder", async ctx => {
  const u = requireEditor(ctx);
  const b = await readJson(ctx.req);
  if (!Array.isArray(b.ids)) bad("ids 배열이 필요합니다.");
  const day = db.prepare("SELECT * FROM days WHERE id=?").get(b.dayId) || notFound();
  const own = new Set(db.prepare("SELECT id FROM places WHERE day_id=?").all(day.id).map(r => r.id));
  if (b.ids.length !== own.size || b.ids.some(id => !own.has(id))) bad("그 날짜의 장소 목록과 맞지 않습니다.");
  const up = db.prepare("UPDATE places SET sort=? WHERE id=?");
  db.exec("BEGIN");
  try { b.ids.forEach((id, i) => up.run(i, id)); db.exec("COMMIT"); }
  catch (e) { db.exec("ROLLBACK"); throw e; }
  audit(u.id, "place.reorder", day.id);
  return { ok: true };
});

/* ---------------------------------------------------------------- 방문 */
router.put("/api/visits/:placeId", ctx => {
  const u = requireMember(ctx);
  db.prepare("INSERT OR IGNORE INTO visits(user_id,place_id,visited_at) VALUES(?,?,?)")
    .run(u.id, ctx.params.placeId, now());
  return { ok: true };
});
router.delete("/api/visits/:placeId", ctx => {
  const u = requireMember(ctx);
  db.prepare("DELETE FROM visits WHERE user_id=? AND place_id=?").run(u.id, ctx.params.placeId);
  return { ok: true };
});

/* ============================================================ 가계부 */
const expenseOut = e => ({
  id: e.id, dayId: e.day_id, placeId: e.place_id, payerId: e.payer_id,
  cat: e.cat, name: e.name, amount: e.amount, pay: e.pay,
  share: J(e.share) ?? [], createdAt: e.created_at, createdBy: e.created_by
});

router.get("/api/expenses", ctx => {
  const tripId = ctx.url.searchParams.get("trip");
  requireMember(ctx, tripId);
  const trip = theTrip(tripId);
  return {
    expenses: db.prepare("SELECT * FROM expenses WHERE trip_id=? ORDER BY created_at").all(trip.id).map(expenseOut)
  };
});

router.post("/api/expenses", async ctx => {
  const b = await readJson(ctx.req);
  const trip = theTrip(tripIdOf(ctx, b));
  const u = requireEditor(ctx, trip.id);
  const amount = Math.round(Number(b.amount));
  if (!Number.isFinite(amount) || amount < 0) bad("금액이 올바르지 않습니다.");
  if (!b.name || !String(b.name).trim()) bad("내용이 필요합니다.");
  const id = newId();
  db.prepare(`INSERT INTO expenses(id,trip_id,day_id,place_id,payer_id,cat,name,amount,pay,share,created_at,created_by)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, trip.id, b.dayId ?? null, b.placeId ?? null, b.payerId || u.id,
         b.cat ?? null, String(b.name).trim(), amount, b.pay ?? null,
         S(Array.isArray(b.share) ? b.share : []), now(), u.id);
  return { expense: expenseOut(db.prepare("SELECT * FROM expenses WHERE id=?").get(id)) };
});

router.patch("/api/expenses/:id", async ctx => {
  requireEditor(ctx);
  const e = db.prepare("SELECT * FROM expenses WHERE id=?").get(ctx.params.id) || notFound();
  const b = await readJson(ctx.req);
  const f = (k, cur) => (b[k] === undefined ? cur : b[k]);
  const amount = b.amount === undefined ? e.amount : Math.round(Number(b.amount));
  if (!Number.isFinite(amount) || amount < 0) bad("금액이 올바르지 않습니다.");
  db.prepare(`UPDATE expenses SET day_id=?, place_id=?, payer_id=?, cat=?, name=?, amount=?, pay=?, share=? WHERE id=?`)
    .run(f("dayId", e.day_id), f("placeId", e.place_id), f("payerId", e.payer_id),
         f("cat", e.cat), String(f("name", e.name)).trim(), amount, f("pay", e.pay),
         b.share === undefined ? e.share : S(b.share), e.id);
  return { expense: expenseOut(db.prepare("SELECT * FROM expenses WHERE id=?").get(e.id)) };
});

router.delete("/api/expenses/:id", ctx => {
  requireEditor(ctx);
  const e = db.prepare("SELECT * FROM expenses WHERE id=?").get(ctx.params.id) || notFound();
  db.prepare("DELETE FROM expenses WHERE id=?").run(e.id);
  return { ok: true };
});

/* 정산 — 누가 얼마 냈고, 누가 누구에게 얼마를 주면 되는지 */
router.get("/api/expenses/settlement", ctx => {
  const tripId = ctx.url.searchParams.get("trip");
  requireMember(ctx, tripId);
  const trip = theTrip(tripId);
  const members = db.prepare(`
    SELECT u.id, u.name FROM trip_members m JOIN users u ON u.id = m.user_id WHERE m.trip_id=?`).all(trip.id);
  const rows = db.prepare("SELECT * FROM expenses WHERE trip_id=?").all(trip.id);

  const net = Object.fromEntries(members.map(m => [m.id, 0]));   // +면 받을 돈
  for (const e of rows) {
    let share = J(e.share) ?? [];
    if (!share.length) share = members.map(m => m.id);           // 지정이 없으면 전원 균등
    share = share.filter(id => id in net);
    if (!share.length) continue;
    const each = e.amount / share.length;
    if (e.payer_id in net) net[e.payer_id] += e.amount;
    for (const id of share) net[id] -= each;
  }

  /* 최소 횟수로 주고받도록 큰 채권자·채무자부터 상계한다 */
  const cred = members.map(m => ({ id: m.id, name: m.name, v: net[m.id] }))
                      .filter(x => x.v > 0.5).sort((a, b) => b.v - a.v);
  const debt = members.map(m => ({ id: m.id, name: m.name, v: -net[m.id] }))
                      .filter(x => x.v > 0.5).sort((a, b) => b.v - a.v);
  const transfers = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const amt = Math.min(debt[i].v, cred[j].v);
    transfers.push({ from: debt[i].id, fromName: debt[i].name, to: cred[j].id, toName: cred[j].name, amount: Math.round(amt) });
    debt[i].v -= amt; cred[j].v -= amt;
    if (debt[i].v <= 0.5) i++;
    if (cred[j].v <= 0.5) j++;
  }
  return {
    members,
    net: Object.fromEntries(Object.entries(net).map(([k, v]) => [k, Math.round(v)])),
    transfers
  };
});

/* ============================================================ 동행자 */
router.get("/api/members", ctx => {
  const tripId = ctx.url.searchParams.get("trip");
  requireMember(ctx, tripId);
  const trip = theTrip(tripId);
  return {
    members: db.prepare(`
      SELECT u.id, u.name, u.email, m.role FROM trip_members m JOIN users u ON u.id = m.user_id
      WHERE m.trip_id=? ORDER BY u.name`).all(trip.id)
  };
});

router.post("/api/members", async ctx => {
  const me = requireAdmin(ctx);
  const b = await readJson(ctx.req);
  const trip = theTrip(tripIdOf(ctx, b));
  const target = db.prepare("SELECT * FROM users WHERE id=? OR email=? COLLATE NOCASE")
    .get(b.userId ?? "", String(b.email ?? "").trim()) || notFound("사용자를 찾을 수 없습니다.");
  db.prepare("INSERT OR REPLACE INTO trip_members(trip_id,user_id,role) VALUES(?,?,?)")
    .run(trip.id, target.id, b.role === "viewer" ? "viewer" : "editor");
  audit(me.id, "member.add", target.id);
  return { ok: true };
});

router.delete("/api/members/:userId", ctx => {
  const me = requireAdmin(ctx);
  const trip = theTrip();
  if (ctx.params.userId === trip.owner_id) bad("여행 소유자는 뺄 수 없습니다.");
  db.prepare("DELETE FROM trip_members WHERE trip_id=? AND user_id=?").run(trip.id, ctx.params.userId);
  audit(me.id, "member.remove", ctx.params.userId);
  return { ok: true };
});

/* ============================================================ 설정 */
router.get("/api/settings", ctx => {
  requireMember(ctx, ctx.url.searchParams.get("trip"));
  return { rate: Number(getSetting("rate") ?? 930) };
});
router.patch("/api/settings", async ctx => {
  const b = await readJson(ctx.req);
  requireEditor(ctx, tripIdOf(ctx, b));
  if (b.rate !== undefined) {
    const r = Number(b.rate);
    if (!Number.isFinite(r) || r <= 0) bad("환율이 올바르지 않습니다.");
    setSetting("rate", r);
  }
  return { ok: true };
});

router.get("/api/health", () => ({ ok: true, at: now() }));
