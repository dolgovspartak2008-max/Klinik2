import { neon } from "@neondatabase/serverless";

let client;

export function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if (!client) client = neon(process.env.DATABASE_URL);
  return client;
}

export async function ensureProfile(user) {
  const sql = db();
  const adminEmails = String(process.env.ADMIN_EMAIL || "").toLowerCase().split(",").map((value) => value.trim()).filter(Boolean);
  const role = adminEmails.includes(String(user.email || "").toLowerCase()) ? "admin" : "student";
  const rows = await sql.query(
    `insert into profiles (id, email, name, role)
     values ($1, $2, $3, $4)
     on conflict (id) do update set email = excluded.email,
       name = case when profiles.name = '' then excluded.name else profiles.name end,
       role = case when excluded.role = 'admin' then 'admin' else profiles.role end,
       updated_at = now()
     returning *`,
    [user.id, user.email || `${user.id}@neon.local`, user.name || "", role],
  );
  return rows[0];
}

export async function requireAdmin(user) {
  const profile = await ensureProfile(user);
  if (profile.role !== "admin" || profile.status !== "active") {
    const error = new Error("forbidden");
    error.status = 403;
    throw error;
  }
  return profile;
}
