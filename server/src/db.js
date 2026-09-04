/* ============================================================================
   SQLite — Node 내장 node:sqlite 사용 (네이티브 모듈 컴파일 불필요)
   ========================================================================== */
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH || "./data/trip.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

/* 짧고 충돌 없는 문자열 ID. 순번 기반 id 를 쓰면 장소를 지웠을 때
   방문기록·지출이 엉뚱한 장소로 옮겨 붙기 때문에 고정 ID 를 쓴다. */
export const newId = () => randomBytes(9).toString("base64url");

export const now = () => new Date().toISOString();

/* ---------------------------------------------------------------- 스키마 */
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'member',   -- admin | member
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,                    -- 토큰의 sha256, 원본은 저장하지 않는다
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    user_agent TEXT
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE trips (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    owner_id   TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE trip_members (
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role    TEXT NOT NULL DEFAULT 'editor',         -- editor | viewer
    PRIMARY KEY (trip_id, user_id)
  );

  CREATE TABLE days (
    id      TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    sort    INTEGER NOT NULL,
    label   TEXT NOT NULL,
    short   TEXT,
    date    TEXT,
    iso     TEXT,
    theme   TEXT,
    color   TEXT,
    budget  TEXT,
    flight  TEXT                                    -- JSON
  );
  CREATE INDEX idx_days_trip ON days(trip_id, sort);

  CREATE TABLE places (
    id         TEXT PRIMARY KEY,
    day_id     TEXT NOT NULL REFERENCES days(id) ON DELETE CASCADE,
    sort       INTEGER NOT NULL,
    name       TEXT NOT NULL,
    ja         TEXT,
    en         TEXT,
    lat        REAL NOT NULL,
    lng        REAL NOT NULL,
    cat        TEXT,
    time       TEXT,
    cost       TEXT,
    note       TEXT,
    url        TEXT,
    radius     INTEGER,
    fit        INTEGER NOT NULL DEFAULT 1,
    move       TEXT,                                -- JSON {mode,min,via,cost}
    updated_at TEXT NOT NULL,
    updated_by TEXT REFERENCES users(id)
  );
  CREATE INDEX idx_places_day ON places(day_id, sort);

  CREATE TABLE visits (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    place_id   TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    visited_at TEXT NOT NULL,
    PRIMARY KEY (user_id, place_id)
  );

  CREATE TABLE expenses (
    id         TEXT PRIMARY KEY,
    trip_id    TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    day_id     TEXT REFERENCES days(id) ON DELETE SET NULL,
    place_id   TEXT REFERENCES places(id) ON DELETE SET NULL,
    payer_id   TEXT NOT NULL REFERENCES users(id),
    cat        TEXT,
    name       TEXT NOT NULL,
    amount     INTEGER NOT NULL,                    -- 엔, 정수
    pay        TEXT,
    share      TEXT,                                -- JSON: 정산 대상 user_id 배열
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id)
  );
  CREATE INDEX idx_expenses_trip ON expenses(trip_id, day_id);

  CREATE TABLE audit (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    at      TEXT NOT NULL,
    user_id TEXT,
    action  TEXT NOT NULL,
    target  TEXT,
    detail  TEXT
  );
  CREATE INDEX idx_audit_at ON audit(at DESC);

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `
];

db.exec("CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)");
let ver = db.prepare("SELECT v FROM schema_version").get()?.v;
if (ver === undefined) {
  db.prepare("INSERT INTO schema_version(v) VALUES (0)").run();
  ver = 0;
}
for (let i = ver; i < MIGRATIONS.length; i++) {
  db.exec("BEGIN");
  try {
    db.exec(MIGRATIONS[i]);
    db.prepare("UPDATE schema_version SET v = ?").run(i + 1);
    db.exec("COMMIT");
    console.log(`[db] migration ${i + 1} 적용`);
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/* ---------------------------------------------------------------- 도우미 */
export const getSetting = k => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value ?? null;
export const setSetting = (k, v) =>
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, String(v));

export const audit = (userId, action, target, detail) =>
  db.prepare("INSERT INTO audit(at,user_id,action,target,detail) VALUES(?,?,?,?,?)")
    .run(now(), userId ?? null, action, target ?? null, detail ? JSON.stringify(detail) : null);

/* 만료 세션 정리 */
export const purgeSessions = () =>
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now()).changes;
