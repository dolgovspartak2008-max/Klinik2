import crypto from "node:crypto";

import { db } from "./_lib/db.js";
import { json, method, fail } from "./_lib/http.js";
import { schemaStatements } from "./_generated/schema.js";

// Применение db/schema.sql. Работает только при заданной переменной SETUP_TOKEN
// и только с заголовком x-setup-token с тем же значением. Без переменной — 404.
function sameToken(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  const expected = process.env.SETUP_TOKEN || "";
  if (expected.length < 32) return json(res, 404, { error: "not_found" });
  if (!method(req, res)) return;
  if (!sameToken(req.headers["x-setup-token"] || "", expected)) return json(res, 403, { error: "forbidden" });
  try {
    const sql = db();
    // уборка после проверки на Preview: тестовые аккаунты и тестовое видео урока
    if (req.body?.action === "e2e_cleanup") {
      const emails = (Array.isArray(req.body.emails) ? req.body.emails : []).map((e) => String(e).toLowerCase()).filter((e) => /^e2e[a-z0-9]+@/.test(e));
      const lessons = (Array.isArray(req.body.lessons) ? req.body.lessons : []).filter((id) => /^[0-9a-f-]{36}$/.test(id));
      const users = await sql.query(`select id from profiles where lower(email) = any($1::text[])`, [emails]);
      const ids = users.map((u) => u.id);
      for (const table of ["playback_sessions", "lesson_progress", "course_access", "course_orders"]) {
        await sql.query(`delete from ${table} where user_id = any($1::text[])`, [ids]);
      }
      await sql.query(`delete from profiles where id = any($1::text[])`, [ids]);
      await sql.query(`update lessons set video_path=null, video_size=null, duration_sec=null, hidden=true, updated_at=now() where id = any($1::uuid[])`, [lessons]);
      if (req.body.reset_course) await sql.query(`update courses set status='draft', price=null, updated_at=now() where id='7b2e1d0f-2c3b-4d4e-9f50-000000000010'`);
      return json(res, 200, { ok: true, users: ids.length, lessons: lessons.length });
    }
    for (const statement of schemaStatements) await sql.query(statement);
    const check = await sql.query(
      `select (select count(*) from courses where slug='zdorovye-sustavy-i-spina')::int as courses,
              (select count(*) from lessons where course_id='7b2e1d0f-2c3b-4d4e-9f50-000000000010')::int as lessons,
              (select count(*) from lessons where course_id='7b2e1d0f-2c3b-4d4e-9f50-000000000010' and hidden)::int as hidden`,
    );
    json(res, 200, { ok: true, statements: schemaStatements.length, ...check[0] });
  } catch (error) {
    fail(res, error);
  }
}
