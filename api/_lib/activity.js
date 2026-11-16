// Журнал действий для админки: кто что сделал на сайте (вход, заказ, оплата, просмотр урока,
// действия администратора). Запись в журнал никогда не ломает основное действие: при сбое
// пишем в лог Vercel и идём дальше. Секретов, ссылок на видео и платёжных данных здесь нет.

// Таблица появилась позже основной схемы: создаём её сами при первом обращении
// (те же команды есть в db/schema.sql), чтобы не зависеть от повторного /api/setup.
let ready = false;
export async function ensureActivitySchema(sql) {
  if (ready) return;
  await sql.query(`create table if not exists activity_log (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    actor_id text,
    user_id text,
    type text not null,
    course_id uuid,
    lesson_id uuid,
    order_id uuid,
    details jsonb not null default '{}'::jsonb
  )`);
  await sql.query(`create index if not exists activity_created_idx on activity_log(created_at desc)`);
  await sql.query(`create index if not exists activity_user_idx on activity_log(user_id, created_at desc)`);
  await sql.query(`create index if not exists activity_type_idx on activity_log(type, created_at desc)`);
  await sql.query(`alter table profiles add column if not exists last_seen_at timestamptz`);
  ready = true;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const uuidOrNull = (value) => (UUID.test(String(value || "")) ? String(value) : null);

// actor — кто сделал (клиент или админ; null — система, например ЮKassa), user — чей это клиент.
export async function logEvent(sql, type, { actor = null, user = null, course = null, lesson = null, order = null, details = {} } = {}) {
  try {
    await ensureActivitySchema(sql);
    await sql.query(
      `insert into activity_log (actor_id, user_id, type, course_id, lesson_id, order_id, details)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [actor, user ?? actor, type, uuidOrNull(course), uuidOrNull(lesson), uuidOrNull(order), JSON.stringify(details || {})],
    );
  } catch (error) {
    console.error("activity log", type, error?.message || error);
  }
}

// Грубое описание устройства по User-Agent: «iPhone · Safari», «Windows · Chrome».
// Полный User-Agent и IP не храним.
export function deviceLabel(req) {
  const ua = String(req?.headers?.["user-agent"] || "");
  if (!ua) return "";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /YaBrowser/.test(ua) ? "Яндекс Браузер" : /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [os, browser].filter(Boolean).join(" · ");
}

const TYPES = [
  "signup", "visit", "profile_updated", "account_deleted",
  "order_created", "order_cancelled", "payment_started", "payment_canceled", "payment_amount_mismatch",
  "order_paid", "order_refunded", "access_revoked",
  "lesson_opened", "lesson_completed", "course_completed", "video_denied", "other_device_blocked", "device_switched",
  "admin_course_saved", "admin_course_status", "admin_lesson_saved", "admin_lesson_published", "admin_lesson_hidden",
  "admin_lessons_reordered", "admin_video_uploaded", "admin_lesson_deleted", "admin_category_saved", "admin_category_deleted",
];
const GROUPS = {
  buy: ["order_created", "order_cancelled", "payment_started", "payment_canceled", "payment_amount_mismatch", "order_paid", "order_refunded", "access_revoked"],
  watch: ["lesson_opened", "lesson_completed", "course_completed"],
  account: ["signup", "visit", "profile_updated", "account_deleted"],
  alert: ["video_denied", "other_device_blocked", "device_switched", "payment_amount_mismatch"],
  admin: TYPES.filter((type) => type.startsWith("admin_")),
};

function eventRow(row) {
  return {
    id: String(row.id),
    at: row.created_at,
    type: row.type,
    details: row.details || {},
    user: row.user_id ? { id: row.user_id, email: row.user_email || "", name: row.user_name || "", client_no: String(row.user_id).slice(0, 8) } : null,
    actor_is_admin: !!row.actor_id && row.actor_id !== row.user_id,
    actor: row.actor_id && row.actor_id !== row.user_id ? (row.actor_email || "") : null,
    course: row.course_id ? { id: row.course_id, title: row.course_title || "" } : null,
    lesson: row.lesson_id ? { id: row.lesson_id, title: row.lesson_title || "", module: row.lesson_module || "" } : null,
    order: row.order_id ? { id: row.order_id, no: row.order_no == null ? null : String(row.order_no), total: row.order_total == null ? null : Number(row.order_total) } : null,
  };
}

const EVENT_SELECT = `select e.*, u.email as user_email, u.name as user_name, a.email as actor_email,
    c.title as course_title, l.title as lesson_title, l.module as lesson_module, o.order_no, o.total as order_total
  from activity_log e
  left join profiles u on u.id = e.user_id
  left join profiles a on a.id = e.actor_id
  left join courses c on c.id = e.course_id
  left join lessons l on l.id = e.lesson_id
  left join course_orders o on o.id = e.order_id`;

// Лента событий с фильтрами: группа, клиент, поиск по имени/email/телефону, «до» (для «Показать ещё»).
export async function adminActivity(sql, args) {
  await ensureActivitySchema(sql);
  const where = [], params = [];
  const group = String(args.p_group || "");
  if (group === "admin") { params.push(GROUPS.admin); where.push(`(e.type = any($${params.length}::text[]) or (e.actor_id is not null and e.actor_id <> e.user_id))`); }
  else if (GROUPS[group]) { params.push(GROUPS[group]); where.push(`e.type = any($${params.length}::text[])`); }
  if (!args.p_visits && group !== "account") where.push(`e.type <> 'visit'`);
  if (args.p_user) { params.push(String(args.p_user).slice(0, 80)); where.push(`e.user_id = $${params.length}`); }
  const q = String(args.p_q || "").trim().toLowerCase().slice(0, 80);
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`);
    const n = params.length;
    where.push(`(lower(u.email) like $${n} or lower(u.name) like $${n} or lower(u.phone) like $${n} or e.user_id like $${n} or o.order_no::text = trim(both '%' from $${n}))`);
  }
  const before = Number(args.p_before);
  if (Number.isSafeInteger(before) && before > 0) { params.push(before); where.push(`e.id < $${params.length}`); }
  const limit = Math.min(Math.max(Number(args.p_limit) || 50, 1), 200);
  params.push(limit);
  const rows = await sql.query(
    `${EVENT_SELECT} ${where.length ? "where " + where.join(" and ") : ""} order by e.id desc limit $${params.length}`,
    params,
  );
  return rows.map(eventRow);
}

// Сводка за сегодня и за 7 дней — для шапки журнала.
export async function adminActivitySummary(sql) {
  await ensureActivitySchema(sql);
  const rows = await sql.query(
    `select
       count(distinct user_id) filter (where created_at > now() - interval '1 day')::int as active_day,
       count(distinct user_id) filter (where created_at > now() - interval '7 days')::int as active_week,
       count(*) filter (where type = 'signup' and created_at > now() - interval '7 days')::int as signups_week,
       count(*) filter (where type = 'order_paid' and created_at > now() - interval '7 days')::int as paid_week,
       count(*) filter (where type = 'lesson_opened' and created_at > now() - interval '7 days')::int as views_week,
       count(*) filter (where type = any($1::text[]) and created_at > now() - interval '7 days')::int as alerts_week
     from activity_log`,
    [GROUPS.alert],
  );
  return rows[0];
}

// Список учеников: кто зарегистрирован, что купил, сколько прошёл, когда был на сайте.
export async function adminStudents(sql, args) {
  await ensureActivitySchema(sql);
  const params = [], where = [];
  const q = String(args.p_q || "").trim().toLowerCase().slice(0, 80);
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`);
    where.push(`(lower(p.email) like $1 or lower(p.name) like $1 or lower(p.phone) like $1 or p.id like $1)`);
  }
  const filter = String(args.p_filter || "");
  if (filter === "buyers") where.push(`exists(select 1 from course_access a where a.user_id = p.id and a.revoked_at is null)`);
  if (filter === "pending") where.push(`exists(select 1 from course_orders o where o.user_id = p.id and o.status = 'pending')`);
  if (filter === "no_purchase") where.push(`not exists(select 1 from course_access a where a.user_id = p.id)`);
  const rows = await sql.query(
    `select p.id, p.email, p.name, p.phone, p.role, p.status, p.created_at, p.last_seen_at,
       (select coalesce(json_agg(json_build_object('title', c.title, 'revoked', a.revoked_at is not null) order by a.granted_at), '[]'::json)
          from course_access a join courses c on c.id = a.course_id where a.user_id = p.id) as courses,
       (select coalesce(sum(o.total), 0) from course_orders o where o.user_id = p.id and o.status = 'paid') as paid_total,
       (select count(*) from course_orders o where o.user_id = p.id and o.status = 'pending')::int as pending_orders,
       (select count(*) from lesson_progress lp where lp.user_id = p.id and lp.completed_at is not null)::int as lessons_done,
       (select max(e.created_at) from activity_log e where e.user_id = p.id and e.type <> 'visit') as last_action_at,
       (select e.type from activity_log e where e.user_id = p.id and e.type <> 'visit' order by e.id desc limit 1) as last_action
     from profiles p ${where.length ? "where " + where.join(" and ") : ""}
     order by coalesce(p.last_seen_at, p.created_at) desc limit 300`,
    params,
  );
  const [totals] = await sql.query(
    `select count(*)::int as total,
       count(*) filter (where exists(select 1 from course_access a where a.user_id = p.id and a.revoked_at is null))::int as buyers,
       count(*) filter (where p.last_seen_at > now() - interval '7 days')::int as seen_week,
       count(*) filter (where p.created_at > now() - interval '7 days')::int as new_week
     from profiles p where p.role <> 'admin'`,
  );
  return {
    totals,
    students: rows.map((row) => ({
      id: row.id, email: row.email, name: row.name, phone: row.phone, role: row.role, status: row.status,
      client_no: String(row.id).slice(0, 8), created_at: row.created_at, last_seen_at: row.last_seen_at,
      courses: Array.isArray(row.courses) ? row.courses : [], paid_total: Number(row.paid_total || 0),
      pending_orders: row.pending_orders, lessons_done: row.lessons_done,
      last_action_at: row.last_action_at, last_action: row.last_action,
    })),
  };
}

// Карточка ученика: профиль, курсы с прогрессом по урокам, заказы, просмотры, последние события.
export async function adminStudent(sql, args) {
  await ensureActivitySchema(sql);
  const id = String(args.p_user || "").slice(0, 80);
  const profiles = await sql.query(`select * from profiles where id = $1`, [id]);
  const profile = profiles[0];
  if (!profile) { const error = new Error("not_found"); error.status = 404; throw error; }
  const access = await sql.query(
    `select a.course_id, a.source, a.granted_at, a.revoked_at, c.title,
       (select count(*) from lessons l where l.course_id = a.course_id and not l.hidden and l.video_path is not null)::int as total,
       (select count(*) from lessons l join lesson_progress lp on lp.lesson_id = l.id and lp.user_id = a.user_id
          where l.course_id = a.course_id and not l.hidden and l.video_path is not null and lp.completed_at is not null)::int as completed
     from course_access a join courses c on c.id = a.course_id where a.user_id = $1 order by a.granted_at desc`,
    [id],
  );
  const lessons = await sql.query(
    `select l.id, l.course_id, l.title, l.module, l.duration_sec, lp.position_sec, lp.completed_at, lp.updated_at
     from lesson_progress lp join lessons l on l.id = lp.lesson_id where lp.user_id = $1 order by lp.updated_at desc limit 100`,
    [id],
  );
  const orders = await sql.query(
    `select o.id, o.order_no, o.status, o.total, o.payment_method, o.note, o.created_at, o.paid_at, c.title
     from course_orders o join courses c on c.id = o.course_id where o.user_id = $1 order by o.created_at desc limit 50`,
    [id],
  );
  const sessions = await sql.query(
    `select s.started_at, s.last_seen_at, s.ended_at, s.end_reason, substr(s.device_id, 1, 6) as device, l.title as lesson
     from playback_sessions s join lessons l on l.id = s.lesson_id where s.user_id = $1 order by s.started_at desc limit 30`,
    [id],
  );
  const devices = await sql.query(
    `select count(distinct device_id)::int as n from playback_sessions where user_id = $1 and started_at > now() - interval '30 days'`,
    [id],
  );
  const events = await adminActivity(sql, { p_user: id, p_visits: true, p_limit: 150 });
  return {
    profile: {
      id: profile.id, email: profile.email, name: profile.name, phone: profile.phone, role: profile.role, status: profile.status,
      client_no: String(profile.id).slice(0, 8), created_at: profile.created_at, last_seen_at: profile.last_seen_at, course_news: profile.course_news,
    },
    access: access.map((row) => ({ ...row, percent: row.total ? Math.round(row.completed * 100 / row.total) : 0 })),
    lessons: lessons.map((row) => ({ ...row, position_sec: Number(row.position_sec || 0) })),
    orders: orders.map((row) => ({ ...row, order_no: String(row.order_no), total: Number(row.total) })),
    sessions,
    devices_30d: devices[0]?.n || 0,
    events,
  };
}
