/* ============================================================================
   index.html 안의 TRIP_DATA 를 DB 로 옮긴다.
   이미 장소가 들어 있으면 아무것도 하지 않는다 (실수로 덮어쓰는 걸 막는다).
     node src/seed.js            일정만 넣기
     node src/seed.js --force    기존 날짜·장소를 지우고 다시 넣기
   ========================================================================== */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { db, newId, now } from "./db.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = process.env.INDEX_HTML || resolve(HERE, "../../index.html");
const force = process.argv.includes("--force");

const src = readFileSync(HTML, "utf8");
const start = src.indexOf("const TRIP_DATA = {");
if (start < 0) { console.error("index.html 에서 TRIP_DATA 를 찾지 못했습니다:", HTML); process.exit(1); }
const end = src.indexOf("\n};", start);
const literal = src.slice(start + "const TRIP_DATA = ".length, end + 2);

/* 객체 리터럴이라 JSON.parse 로는 못 읽는다. 이 파일은 우리가 만든 정적 문자열이므로
   Function 으로 한 번만 평가한다. */
const TRIP_DATA = Function(`"use strict"; return (${literal});`)();
console.log(`[seed] ${TRIP_DATA.days.length}일 / ${TRIP_DATA.days.reduce((a, d) => a + d.places.length, 0)}곳 읽음`);

const trip = db.prepare("SELECT * FROM trips ORDER BY created_at LIMIT 1").get();
if (!trip) { console.error("[seed] 여행이 없습니다. 먼저 /api/auth/setup 으로 관리자 계정을 만드세요."); process.exit(1); }

const existing = db.prepare(`SELECT COUNT(*) n FROM places p JOIN days d ON d.id=p.day_id WHERE d.trip_id=?`)
  .get(trip.id).n;
if (existing && !force) {
  console.log(`[seed] 이미 장소가 ${existing}곳 있습니다. 덮어쓰려면 --force 를 붙이세요.`);
  process.exit(0);
}

db.exec("BEGIN");
try {
  if (force) {
    db.prepare("DELETE FROM days WHERE trip_id=?").run(trip.id);   // places 는 CASCADE
    console.log("[seed] 기존 날짜·장소 삭제");
  }
  db.prepare("UPDATE trips SET title=? WHERE id=?").run(TRIP_DATA.title ?? "여행", trip.id);

  const insDay = db.prepare(`INSERT INTO days(id,trip_id,sort,label,short,date,iso,theme,color,budget,flight)
                             VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  const insPlace = db.prepare(`INSERT INTO places
    (id,day_id,sort,name,ja,en,lat,lng,cat,time,cost,note,url,radius,fit,move,updated_at,updated_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  TRIP_DATA.days.forEach((d, di) => {
    const dayId = newId();
    insDay.run(dayId, trip.id, di, d.label, d.short ?? null, d.date ?? null, d.iso ?? null,
               d.theme ?? null, d.color ?? null, d.budget ?? null,
               d.flight ? JSON.stringify(d.flight) : null);
    d.places.forEach((p, pi) => {
      insPlace.run(newId(), dayId, pi, p.name, p.ja ?? null, p.en ?? null, p.lat, p.lng,
                   p.cat ?? null, p.time ?? null, p.cost ?? null, p.note ?? null, p.url ?? null,
                   p.radius ?? null, p.fit === false ? 0 : 1,
                   p.move ? JSON.stringify(p.move) : null, now(), trip.owner_id);
    });
  });
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

const n = db.prepare(`SELECT COUNT(*) n FROM places p JOIN days d ON d.id=p.day_id WHERE d.trip_id=?`).get(trip.id).n;
console.log(`[seed] 완료 — 날짜 ${TRIP_DATA.days.length}개, 장소 ${n}곳`);
