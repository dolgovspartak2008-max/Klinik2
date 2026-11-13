import { authUser } from "./_lib/auth.js";
import { db, ensureProfile, requireAdmin } from "./_lib/db.js";
import { fail, json, method, uuid } from "./_lib/http.js";

const PUBLIC = new Set(["courses_catalog", "course_detail"]);

function httpError(code, status = 400) {
  const error = new Error(code);
  error.status = status;
  return error;
}

function number(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

// обложка по умолчанию, пока в админке не загружена своя
const DEFAULT_COVERS = { "zdorovye-sustavy-i-spina": "/assets/img/course-sustavy-spina.webp" };

function courseCard(row, owned = false) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    short: row.short,
    direction: row.direction,
    price: row.price == null ? null : Number(row.price),
    old_price: row.old_price == null ? null : Number(row.old_price),
    cover_url: row.cover_url || DEFAULT_COVERS[row.slug] || null,
    status: row.status,
    category: row.category_id ? { id: row.category_id, slug: row.category_slug, title: row.category_title } : null,
    stats: { lessons: Number(row.lesson_count || 0), duration_sec: Number(row.duration_sec || 0) },
    owned,
  };
}

async function courseProgress(sql, userId, courseId) {
  const rows = await sql.query(
    `select count(*) filter (where not l.hidden and l.video_path is not null)::int as total,
       count(*) filter (where p.completed_at is not null)::int as completed,
       max(p.updated_at) as updated_at
     from lessons l left join lesson_progress p on p.lesson_id = l.id and p.user_id = $1
     where l.course_id = $2`,
    [userId, courseId],
  );
  const last = await sql.query(
    `select l.id, l.title from lesson_progress p join lessons l on l.id = p.lesson_id
     where p.user_id = $1 and l.course_id = $2 order by p.updated_at desc limit 1`,
    [userId, courseId],
  );
  const total = Number(rows[0]?.total || 0);
  const completed = Number(rows[0]?.completed || 0);
  return {
    total,
    completed,
    percent: total ? Math.round(completed * 100 / total) : 0,
    last_lesson_id: last[0]?.id || null,
    last_lesson_title: last[0]?.title || null,
  };
}

async function hasAccess(sql, userId, courseId) {
  if (!userId) return false;
  const rows = await sql.query(
    `select 1 from course_access where user_id = $1 and course_id = $2 and revoked_at is null
       and (expires_at is null or expires_at > now()) limit 1`,
    [userId, courseId],
  );
  return !!rows.length;
}

async function catalog(sql, user) {
  const categories = await sql.query(
    `select c.*, count(k.id)::int as courses from course_categories c
     left join courses k on k.category_id = c.id and k.status = 'published'
     group by c.id order by c.sort, c.title`,
  );
  const rows = await sql.query(
    `select c.*, k.slug as category_slug, k.title as category_title,
       count(l.id) filter (where not l.hidden and l.video_path is not null)::int as lesson_count,
       coalesce(sum(l.duration_sec) filter (where not l.hidden and l.video_path is not null), 0)::int as duration_sec,
       (select coalesce(json_agg(m.module order by m.first_sort), '[]'::json) from (
          select ml.module, min(ml.sort) as first_sort from lessons ml
          where ml.course_id = c.id and not ml.hidden and ml.video_path is not null and ml.module <> ''
          group by ml.module) m) as modules
     from courses c left join course_categories k on k.id = c.category_id
     left join lessons l on l.course_id = c.id where c.status = 'published'
     group by c.id, k.slug, k.title order by c.sort, c.title`,
  );
  const ownedRows = user ? await sql.query(
    `select course_id from course_access where user_id = $1 and revoked_at is null and (expires_at is null or expires_at > now())`,
    [user.id],
  ) : [];
  const owned = new Set(ownedRows.map((row) => row.course_id));
  return {
    categories: categories.filter((row) => row.courses > 0).map((row) => ({ id: row.id, slug: row.slug, title: row.title, description: row.description })),
    courses: rows.map((row) => ({ ...courseCard(row, owned.has(row.id)), modules: Array.isArray(row.modules) ? row.modules : [] })),
    bundles: [],
  };
}

async function detail(sql, args, user) {
  const slug = String(args.p_slug || "").toLowerCase();
  const rows = await sql.query(
    `select c.*, k.slug as category_slug, k.title as category_title,
       count(l.id) filter (where not l.hidden and l.video_path is not null)::int as lesson_count,
       coalesce(sum(l.duration_sec) filter (where not l.hidden and l.video_path is not null), 0)::int as duration_sec
     from courses c left join course_categories k on k.id = c.category_id
     left join lessons l on l.course_id = c.id where c.slug = $1
     group by c.id, k.slug, k.title`,
    [slug],
  );
  const row = rows[0];
  if (!row) throw httpError("not_found", 404);
  const owned = await hasAccess(sql, user?.id, row.id);
  if (row.status !== "published" && !owned) throw httpError("not_found", 404);
  const lessons = await sql.query(
    `select l.id, l.title, l.module, l.description, l.duration_sec, l.is_free,
       (p.completed_at is not null) as completed
     from lessons l left join lesson_progress p on p.lesson_id = l.id and p.user_id = $1
     where l.course_id = $2 and not l.hidden and l.video_path is not null order by l.sort, l.created_at`,
    [user?.id || "", row.id],
  );
  return {
    ...courseCard(row, owned),
    for_whom: row.for_whom,
    tasks: row.tasks,
    program: row.program,
    results: row.results,
    recommendations: row.recommendations,
    author: row.author,
    contraindications: row.contraindications,
    access_terms: row.access_terms,
    access_days: null,
    on_sale: row.status === "published" && row.price != null,
    lessons,
    progress: owned && user ? await courseProgress(sql, user.id, row.id) : null,
    bundles: [],
    signed_in: !!user,
  };
}

async function quote(sql, args, user) {
  if (args.p_item_type !== "course" || args.p_gift) throw httpError("bad_request");
  const courseId = uuid(args.p_item_id);
  const rows = await sql.query(`select * from courses where id = $1 and status = 'published' and price is not null`, [courseId]);
  const course = rows[0];
  if (!course) throw httpError("course_unavailable");
  if (await hasAccess(sql, user.id, courseId)) throw httpError("already_owned");
  return { item_type: "course", item_id: courseId, title: course.title, list_price: Number(course.price), base_price: Number(course.price), discount: 0, total: Number(course.price), promo_code: null, is_gift: false, note: null };
}

async function createOrder(sql, args, user) {
  const courseId = uuid(args.p_item_id);
  if (args.p_item_type !== "course" || args.p_gift) throw httpError("bad_request");
  const key = String(args.p_key || "").slice(0, 80);
  if (key.length < 8) throw httpError("bad_request");
  if (await hasAccess(sql, user.id, courseId)) throw httpError("already_owned");
  const courses = await sql.query(`select * from courses where id = $1 and status = 'published' and price is not null`, [courseId]);
  const course = courses[0];
  if (!course) throw httpError("course_unavailable");
  const total = Number(course.price);
  const status = total === 0 ? "paid" : "pending";
  // уже есть неоплаченный заказ на этот курс — возвращаем его, а не создаём второй
  const pending = await sql.query(`select * from course_orders where user_id=$1 and course_id=$2 and status='pending' limit 1`, [user.id, courseId]);
  if (pending[0]) return { order: { ...pending[0], total: Number(pending[0].total), title: course.title, course_slug: course.slug, is_gift: false } };
  const rows = await sql.query(
    `insert into course_orders (user_id, course_id, total, status, idempotency_key, paid_at)
     values ($1, $2, $3, $4, $5, case when $4 = 'paid' then now() else null end)
     on conflict (user_id, idempotency_key) do update set idempotency_key = excluded.idempotency_key
     returning *`,
    [user.id, courseId, total, status, key],
  );
  if (status === "paid") await sql.query(
    `insert into course_access (user_id, course_id, source) values ($1, $2, 'purchase')
     on conflict (user_id, course_id) do update set revoked_at = null, granted_at = now()`,
    [user.id, courseId],
  );
  return { order: { ...rows[0], total, title: course.title, course_slug: course.slug, is_gift: false } };
}

async function myCourses(sql, user) {
  const profile = await ensureProfile(user);
  const access = await sql.query(
    `select a.*, c.*, k.slug as category_slug, k.title as category_title,
       count(l.id) filter (where not l.hidden and l.video_path is not null)::int as lesson_count,
       coalesce(sum(l.duration_sec) filter (where not l.hidden and l.video_path is not null), 0)::int as duration_sec
     from course_access a join courses c on c.id = a.course_id
     left join course_categories k on k.id = c.category_id left join lessons l on l.course_id = c.id
     where a.user_id = $1 and a.revoked_at is null and (a.expires_at is null or a.expires_at > now())
     group by a.id, c.id, k.slug, k.title order by a.granted_at desc`,
    [user.id],
  );
  const courses = [];
  for (const row of access) courses.push({ ...courseCard(row, true), source: row.source, granted_at: row.granted_at, expires_at: row.expires_at, progress: await courseProgress(sql, user.id, row.course_id) });
  const orders = await sql.query(
    `select o.*, c.title from course_orders o join courses c on c.id = o.course_id where o.user_id = $1 order by o.created_at desc limit 50`,
    [user.id],
  );
  return { blocked: profile.status !== "active", course_news: profile.course_news, courses, orders: orders.map((row) => ({ ...row, total: Number(row.total), is_gift: false })) };
}

async function player(sql, args, user) {
  const rows = await sql.query(`select * from courses where slug = $1`, [String(args.p_slug || "").toLowerCase()]);
  const course = rows[0];
  if (!course) throw httpError("not_found", 404);
  const profile = await ensureProfile(user);
  const access = await hasAccess(sql, user.id, course.id);
  if (course.status !== "published" && !access) throw httpError("not_found", 404);
  const lessons = await sql.query(
    `select l.*, p.position_sec, p.completed_at is not null as completed
     from lessons l left join lesson_progress p on p.lesson_id = l.id and p.user_id = $1
     where l.course_id = $2 and not l.hidden and l.video_path is not null order by l.sort, l.created_at`,
    [user.id, course.id],
  );
  return {
    course: { id: course.id, slug: course.slug, title: course.title, recommendations: course.recommendations, contraindications: course.contraindications, price: course.price == null ? null : Number(course.price), on_sale: course.status === "published" && course.price != null },
    access,
    blocked: profile.status !== "active",
    watermark: profile.email,
    progress: await courseProgress(sql, user.id, course.id),
    lessons: lessons.map(({ video_path, video_size, ...lesson }) => ({ ...lesson, can_watch: (access || lesson.is_free) && profile.status === "active" })),
  };
}

async function saveProgress(sql, args, user) {
  const lessonId = uuid(args.p_lesson);
  const rows = await sql.query(`select l.*, c.id as cid from lessons l join courses c on c.id = l.course_id where l.id = $1`, [lessonId]);
  const lesson = rows[0];
  if (!lesson || (!(await hasAccess(sql, user.id, lesson.course_id)) && !lesson.is_free)) throw httpError("no_access", 403);
  const position = Math.max(0, number(args.p_position));
  const duration = number(args.p_duration) || lesson.duration_sec || null;
  const completed = !!args.p_completed || (duration && position >= duration * 0.9);
  await sql.query(
    `insert into lesson_progress (user_id, lesson_id, position_sec, duration_sec, completed_at, updated_at)
     values ($1, $2, $3, $4, case when $5 then now() else null end, now())
     on conflict (user_id, lesson_id) do update set position_sec = excluded.position_sec,
       duration_sec = coalesce(excluded.duration_sec, lesson_progress.duration_sec),
       completed_at = case when $5 then coalesce(lesson_progress.completed_at, now()) else lesson_progress.completed_at end,
       updated_at = now()`,
    [user.id, lessonId, position, duration, completed],
  );
  return { ok: true, completed, progress: await courseProgress(sql, user.id, lesson.course_id) };
}

async function adminOverview(sql) {
  const categories = await sql.query(
    `select k.*, count(c.id)::int as courses, false as hidden from course_categories k left join courses c on c.category_id = k.id group by k.id order by k.sort, k.title`,
  );
  const courses = await sql.query(
    `select c.*, k.title as category_title, k.slug as category_slug,
       count(l.id) filter (where not l.hidden and l.video_path is not null)::int as lesson_count,
       coalesce(sum(l.duration_sec) filter (where not l.hidden and l.video_path is not null), 0)::int as duration_sec,
       count(l.id)::int as lessons_all,
       count(l.id) filter (where l.video_path is null)::int as lessons_no_video,
       (select count(*) from course_access a where a.course_id = c.id and a.revoked_at is null)::int as students,
       (select count(*) from course_orders o where o.course_id = c.id and o.status = 'paid')::int as sales
     from courses c left join course_categories k on k.id = c.category_id left join lessons l on l.course_id = c.id
     group by c.id, k.title, k.slug order by c.sort, c.title`,
  );
  const pending = await sql.query(`select count(*)::int as n from course_orders where status = 'pending'`);
  return { categories, courses: courses.map((row) => ({ ...courseCard(row), category_id: row.category_id, lessons_all: row.lessons_all, lessons_no_video: row.lessons_no_video, students: row.students, sales: row.sales })), bundles: [], promos: [], pending_orders: pending[0].n };
}

async function adminCourseGet(sql, args) {
  const id = uuid(args.p_id);
  const courses = await sql.query(`select * from courses where id = $1`, [id]);
  if (!courses[0]) throw httpError("not_found", 404);
  const lessons = await sql.query(
    `select l.*, (l.video_path is not null) as has_video,
       (select count(*) from lesson_progress p where p.lesson_id = l.id)::int as viewers,
       (select count(*) from lesson_progress p where p.lesson_id = l.id and p.completed_at is not null)::int as completed,
       null::timestamptz as published_at
     from lessons l where l.course_id = $1 order by l.sort, l.created_at`,
    [id],
  );
  const students = await sql.query(`select count(*)::int as n from course_access where course_id = $1 and revoked_at is null`, [id]);
  return { ...courses[0], access_days: null, lessons, students: students[0].n, avg_progress: null };
}

async function adminCourseSave(sql, args) {
  const value = args.p || {};
  const id = value.id ? uuid(value.id) : null;
  const params = [String(value.slug || "").toLowerCase(), uuid(value.category_id), String(value.title || "").trim(), String(value.short || ""), String(value.direction || ""), String(value.for_whom || ""), String(value.tasks || ""), String(value.program || ""), String(value.results || ""), String(value.recommendations || ""), String(value.author || ""), String(value.contraindications || ""), String(value.access_terms || ""), value.price === "" ? null : number(value.price), value.old_price === "" ? null : number(value.old_price), number(value.sort)];
  if (!params[0] || !params[2]) throw httpError("bad_request");
  const rows = id ? await sql.query(
    `update courses set slug=$1, category_id=$2, title=$3, short=$4, direction=$5, for_whom=$6, tasks=$7,
       program=$8, results=$9, recommendations=$10, author=$11, contraindications=$12, access_terms=$13,
       price=$14, old_price=$15, sort=$16, updated_at=now() where id=$17 returning id`, [...params, id],
  ) : await sql.query(
    `insert into courses (slug, category_id, title, short, direction, for_whom, tasks, program, results, recommendations,
       author, contraindications, access_terms, price, old_price, sort) values (${params.map((_, i) => `$${i + 1}`).join(",")}) returning id`, params,
  );
  return { ok: true, id: rows[0].id };
}

async function adminLessonSave(sql, args) {
  const value = args.p || {};
  if (value.id) {
    const id = uuid(value.id);
    const rows = await sql.query(`select * from lessons where id=$1`, [id]);
    if (!rows[0]) throw httpError("not_found", 404);
    const hidden = value.hidden == null ? rows[0].hidden : !!value.hidden;
    if (!hidden && !rows[0].video_path) throw httpError("no_video");
    await sql.query(`update lessons set title=$1, module=$2, description=$3, recommendations=$4, is_free=$5, hidden=$6, updated_at=now() where id=$7`, [String(value.title || rows[0].title), String(value.module || ""), String(value.description || ""), String(value.recommendations || ""), !!value.is_free, hidden, id]);
    return { ok: true, id };
  }
  const courseId = uuid(value.course_id);
  const rows = await sql.query(`insert into lessons (course_id, sort, title) values ($1, (select coalesce(max(sort),0)+1 from lessons where course_id=$1), $2) returning id`, [courseId, String(value.title || "Новый урок")]);
  return { ok: true, id: rows[0].id };
}

async function adminOrders(sql, args) {
  const status = String(args.p_status || "");
  const values = status ? [status] : [];
  const rows = await sql.query(
    `select o.*, c.title, p.email, p.name, p.phone,
       exists(select 1 from course_access a where a.user_id=o.user_id and a.course_id=o.course_id and a.revoked_at is null) as has_access
     from course_orders o join courses c on c.id=o.course_id
     join profiles p on p.id=o.user_id ${status ? "where o.status=$1" : ""} order by o.created_at desc limit 100`,
    values,
  );
  return rows.map((row) => ({ ...row, total: Number(row.total), title: row.title, is_gift: false, refunded: row.status === "refunded" ? Number(row.total) : 0, user: { id: row.user_id, name: row.name, email: row.email, phone: row.phone, client_no: String(row.user_id).slice(0, 8) } }));
}

async function adminMarkPaid(sql, args) {
  const id = uuid(args.p_order);
  const method = String(args.p_method || "").trim().slice(0, 120);
  if (!method) throw httpError("method_required");
  // переводим в «оплачен» только ожидающий заказ — повторное нажатие ничего не меняет
  const rows = await sql.query(
    `update course_orders set status='paid', payment_method=$2, note=$3, paid_at=now()
     where id=$1 and status='pending' returning *`,
    [id, method, args.p_note || null],
  );
  if (!rows[0]) {
    const existing = await sql.query(`select status from course_orders where id=$1`, [id]);
    if (!existing[0]) throw httpError("not_found", 404);
    if (existing[0].status === "paid") return { ok: true, already: true };
    throw httpError("order_not_payable");
  }
  await sql.query(
    `insert into course_access (user_id, course_id, source) values ($1, $2, 'purchase')
     on conflict (user_id, course_id) do update set revoked_at = null,
       granted_at = case when course_access.revoked_at is null then course_access.granted_at else now() end`,
    [rows[0].user_id, rows[0].course_id],
  );
  return { ok: true, already: false };
}

async function heartbeat(sql, args, user) {
  const id = uuid(args.p_session);
  const rows = await sql.query(
    `select s.*, l.course_id, l.is_free from playback_sessions s join lessons l on l.id = s.lesson_id where s.id = $1 and s.user_id = $2`,
    [id, user.id],
  );
  const session = rows[0];
  if (!session) return { ok: false, reason: "expired" };
  if (session.ended_at) return { ok: false, reason: session.end_reason === "replaced" ? "replaced" : session.end_reason === "revoked" ? "revoked" : "expired" };
  // доступ отозвали во время просмотра — останавливаем
  if (!session.is_free && !(await hasAccess(sql, user.id, session.course_id))) {
    await sql.query(`update playback_sessions set ended_at=now(), end_reason='revoked' where id=$1`, [id]);
    return { ok: false, reason: "revoked" };
  }
  await sql.query(`update playback_sessions set last_seen_at=now() where id=$1`, [id]);
  return { ok: true };
}

export async function dispatch(fn, args, user, sql = db()) {
  if (user) await ensureProfile(user);
  if (fn === "courses_catalog") return catalog(sql, user);
  if (fn === "course_detail") return detail(sql, args, user);
  if (!user) throw httpError("not_authenticated", 401);
  if (fn === "course_quote") return quote(sql, args, user);
  if (fn === "course_order_create") return createOrder(sql, args, user);
  if (fn === "my_courses") return myCourses(sql, user);
  if (fn === "my_dashboard") {
    const profile = await ensureProfile(user);
    return { profile: {
      ...profile,
      is_admin: profile.role === "admin",
      name_confirmed: !!profile.name,
      client_no: String(profile.id).slice(0, 8),
      phone_locked: false,
      telegram: null,
      news_opt_in: false,
    } };
  }
  if (fn === "update_my_profile") {
    const name = String(args.p_name || "").trim().slice(0, 60);
    if (name.length < 2) throw httpError("bad_name");
    await sql.query(`update profiles set name=$1,phone=$2,updated_at=now() where id=$3`, [name, String(args.p_phone || "").trim().slice(0, 30), user.id]);
    return { ok: true };
  }
  if (fn === "set_news_opt_in") return { ok: true };
  if (fn === "delete_my_account") {
    await sql.query(`update profiles set status='blocked',updated_at=now() where id=$1`, [user.id]);
    return { ok: true };
  }
  if (fn === "course_player") return player(sql, args, user);
  if (fn === "course_progress_save") return saveProgress(sql, args, user);
  if (fn === "course_heartbeat") return heartbeat(sql, args, user);
  if (fn === "course_session_stop") {
    await sql.query(`update playback_sessions set ended_at=now(),end_reason='stopped' where id=$1 and user_id=$2 and ended_at is null`, [uuid(args.p_session), user.id]);
    return { ok: true };
  }
  if (fn === "course_order_cancel") {
    await sql.query(`update course_orders set status='cancelled' where id=$1 and user_id=$2 and status='pending'`, [uuid(args.p_order), user.id]);
    return { ok: true };
  }
  if (fn === "set_course_news") {
    await sql.query(`update profiles set course_news=$1,updated_at=now() where id=$2`, [!!args.p_on, user.id]);
    return { ok: true, course_news: !!args.p_on };
  }
  if (fn === "gift_activate") throw httpError("gift_invalid");

  await requireAdmin(user);
  if (fn === "admin_me") return { ok: true };
  if (fn === "admin_courses_overview") return adminOverview(sql);
  if (fn === "admin_course_get") return adminCourseGet(sql, args);
  if (fn === "admin_course_save") return adminCourseSave(sql, args);
  if (fn === "admin_lesson_save") return adminLessonSave(sql, args);
  if (fn === "admin_course_orders") return adminOrders(sql, args);
  if (fn === "admin_order_mark_paid") return adminMarkPaid(sql, args);
  if (fn === "admin_category_save") {
    const value = args.p || {};
    const id = value.id ? uuid(value.id) : null;
    const params = [String(value.slug || "").toLowerCase(), String(value.title || ""), String(value.description || ""), number(value.sort)];
    const rows = id ? await sql.query(`update course_categories set slug=$1,title=$2,description=$3,sort=$4 where id=$5 returning id`, [...params, id]) : await sql.query(`insert into course_categories(slug,title,description,sort) values($1,$2,$3,$4) returning id`, params);
    return { ok: true, id: rows[0].id };
  }
  if (fn === "admin_category_delete") {
    await sql.query(`delete from course_categories where id=$1 and not exists(select 1 from courses where category_id=$1)`, [uuid(args.p_id)]);
    return { ok: true };
  }
  if (fn === "admin_course_set_status") {
    const id = uuid(args.p_id), status = String(args.p_status || "");
    if (!["draft", "published", "archived"].includes(status)) throw httpError("bad_request");
    if (status === "published") {
      const ready = await sql.query(`select 1 from lessons where course_id=$1 and not hidden and video_path is not null limit 1`, [id]);
      if (!ready.length) throw httpError("no_lessons");
      const priced = await sql.query(`select 1 from courses where id=$1 and price is not null`, [id]);
      if (!priced.length) throw httpError("price_required");
    }
    await sql.query(`update courses set status=$1,updated_at=now() where id=$2`, [status, id]);
    return { ok: true };
  }
  if (fn === "admin_lesson_reorder") {
    const courseId = uuid(args.p_course), ids = Array.isArray(args.p_ids) ? args.p_ids.map(uuid) : [];
    for (let i = 0; i < ids.length; i++) await sql.query(`update lessons set sort=$1 where id=$2 and course_id=$3`, [i + 1, ids[i], courseId]);
    return { ok: true };
  }
  if (fn === "admin_order_cancel") {
    await sql.query(`update course_orders set status='cancelled',note=$2 where id=$1 and status='pending'`, [uuid(args.p_order), String(args.p_reason || "")]);
    return { ok: true };
  }
  if (fn === "admin_access_revoke_order") {
    const rows = await sql.query(`select user_id, course_id from course_orders where id=$1`, [uuid(args.p_order)]);
    if (!rows[0]) throw httpError("not_found", 404);
    await sql.query(`update course_access set revoked_at=now() where user_id=$1 and course_id=$2 and revoked_at is null`, [rows[0].user_id, rows[0].course_id]);
    await sql.query(`update playback_sessions set ended_at=now(), end_reason='revoked' where user_id=$1 and ended_at is null`, [rows[0].user_id]);
    return { ok: true };
  }
  if (fn === "admin_order_refund") {
    const rows = await sql.query(`update course_orders set status='refunded',note=$2 where id=$1 and status='paid' returning *`, [uuid(args.p_order), String(args.p_reason || "")]);
    if (rows[0] && args.p_revoke) {
      await sql.query(`update course_access set revoked_at=now() where user_id=$1 and course_id=$2 and revoked_at is null`, [rows[0].user_id, rows[0].course_id]);
      await sql.query(`update playback_sessions set ended_at=now(), end_reason='revoked' where user_id=$1 and ended_at is null`, [rows[0].user_id]);
    }
    return { ok: true };
  }
  throw httpError("bad_request");
}

export default async function handler(req, res) {
  if (!method(req, res)) return;
  try {
    const fn = String(req.body?.fn || "");
    const args = req.body?.args || {};
    const user = await authUser(req, PUBLIC.has(fn));
    json(res, 200, await dispatch(fn, args, user));
  } catch (error) {
    fail(res, error);
  }
}
