import { neon } from "@neondatabase/serverless";

import { ensureActivitySchema, logEvent } from "./activity.js";

// перерыв, после которого заход на сайт считается новым визитом
const VISIT_GAP_MS = 30 * 60 * 1000;

let client;
let testClient = null;

// только для тестов: подставить клиент с тем же интерфейсом sql.query(text, params) -> rows
export function setDbForTests(value) {
  testClient = value;
}

export function db() {
  if (testClient) return testClient;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if (!client) client = neon(process.env.DATABASE_URL);
  return client;
}

export function adminEmails() {
  return [process.env.ADMIN_EMAIL, process.env.ADMIN_EMAIL_EXTRA]
    .join(",").toLowerCase().split(",").map((value) => value.trim()).filter(Boolean);
}

// Администратор — только владелец email из ADMIN_EMAIL, и только с подтверждённым email:
// иначе любой мог бы зарегистрироваться на чужой адрес и получить админку.
export function isAdminUser(user) {
  return !!user.email && user.emailVerified === true && adminEmails().includes(user.email);
}

export async function ensureProfile(user, ctx = {}) {
  const sql = db();
  await ensureActivitySchema(sql);
  const role = isAdminUser(user) ? "admin" : "student";
  // prev — состояние до этого запроса: новая запись = регистрация, давно не был = новый визит
  const rows = await sql.query(
    `with prev as (select last_seen_at from profiles where id = $1)
     insert into profiles (id, email, name, role, last_seen_at)
     values ($1, $2, $3, $4, now())
     on conflict (id) do update set email = excluded.email,
       name = case when profiles.name = '' then excluded.name else profiles.name end,
       role = excluded.role,
       last_seen_at = now(),
       updated_at = now()
     returning *, (select count(*) from prev)::int as existed, (select last_seen_at from prev) as prev_seen_at`,
    [user.id, user.email || `${user.id}@neon.local`, user.name || "", role],
  );
  const { existed, prev_seen_at: prevSeen, ...profile } = rows[0];
  if (!existed) await logEvent(sql, "signup", { actor: user.id, details: { device: ctx.device || "" } });
  else if (!prevSeen || Date.now() - new Date(prevSeen).getTime() > VISIT_GAP_MS) {
    await logEvent(sql, "visit", { actor: user.id, details: { device: ctx.device || "" } });
  }
  return profile;
}

export async function requireAdmin(user) {
  const profile = await ensureProfile(user);
  if (profile.role !== "admin" || profile.status !== "active") {
    const error = new Error(adminEmails().includes(user.email) && !user.emailVerified ? "email_not_verified" : "forbidden");
    error.status = 403;
    throw error;
  }
  return profile;
}
