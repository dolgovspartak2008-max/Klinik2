import { neon } from "@neondatabase/serverless";

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

export async function ensureProfile(user) {
  const sql = db();
  const role = isAdminUser(user) ? "admin" : "student";
  const rows = await sql.query(
    `insert into profiles (id, email, name, role)
     values ($1, $2, $3, $4)
     on conflict (id) do update set email = excluded.email,
       name = case when profiles.name = '' then excluded.name else profiles.name end,
       role = excluded.role,
       updated_at = now()
     returning *`,
    [user.id, user.email || `${user.id}@neon.local`, user.name || "", role],
  );
  return rows[0];
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
