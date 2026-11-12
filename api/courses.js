import crypto from "node:crypto";

import { authUser } from "./_lib/auth.js";
import { db, ensureProfile, requireAdmin } from "./_lib/db.js";
import { fail, json, method, uuid } from "./_lib/http.js";
import { exists, parseR2Path, r2Path, signGet, signPut } from "./_lib/r2.js";

// Один PUT в R2 — до 5 ГиБ; оставляем запас. Больше — понятная ошибка video_too_big.
export const VIDEO_MAX = 5 * 1024 * 1024 * 1024 - 5 * 1024 * 1024;
export const URL_TTL = 600; // ссылка на видео живёт 10 минут

function error(code, status = 400, extra = {}) {
  const value = new Error(code);
  value.status = status;
  if (Object.keys(extra).length) value.extra = extra;
  return value;
}

export async function play(sql, body, user) {
  const lessonId = uuid(body.lesson_id);
  const deviceId = String(body.device_id || "");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(deviceId)) throw error("bad_request");
  const profile = await ensureProfile(user);
  if (profile.status !== "active") throw error("courses_blocked", 403);
  const rows = await sql.query(
    `select l.*, exists(select 1 from course_access a where a.user_id=$1 and a.course_id=l.course_id
       and a.revoked_at is null and (a.expires_at is null or a.expires_at>now())) as owned
     from lessons l where l.id=$2 and not l.hidden and l.video_path is not null`,
    [user.id, lessonId],
  );
  const lesson = rows[0];
  if (!lesson || (!lesson.owned && !lesson.is_free)) throw error("no_access", 403);
  const active = await sql.query(
    `select * from playback_sessions where user_id=$1 and ended_at is null and last_seen_at>now()-interval '2 minutes'
     order by started_at desc limit 1`,
    [user.id],
  );
  if (active[0] && active[0].device_id !== deviceId && body.force !== true) {
    throw error("other_device", 409, { since: active[0].started_at, device_hint: active[0].device_id.slice(0, 6) });
  }
  if (active[0]) await sql.query(`update playback_sessions set ended_at=now(),end_reason=$2 where id=$1`, [active[0].id, active[0].device_id === deviceId ? "renewed" : "replaced"]);
  const session = await sql.query(`insert into playback_sessions(user_id,lesson_id,device_id) values($1,$2,$3) returning id`, [user.id, lessonId, deviceId]);
  const key = parseR2Path(lesson.video_path);
  return { ok: true, session_id: session[0].id, url: await signGet(key, URL_TTL), expires_in: URL_TTL };
}

export async function uploadUrl(sql, body, user) {
  await requireAdmin(user);
  if (body.kind !== "video") throw error("upload_unavailable", 503);
  if (body.content_type !== "video/mp4") throw error("video_format");
  const size = Number(body.size) || 0;
  if (size <= 0 || size > VIDEO_MAX) throw error("video_too_big");
  const lessonId = uuid(body.target_id);
  const lesson = await sql.query(`select 1 from lessons where id=$1`, [lessonId]);
  if (!lesson.length) throw error("not_found", 404);
  const key = `lessons/${lessonId}/${crypto.randomBytes(16).toString("hex")}.mp4`;
  return { ok: true, path: r2Path(key), ...(await signPut(key, 3600)) };
}

export async function attachVideo(sql, body, user) {
  await requireAdmin(user);
  const lessonId = uuid(body.lesson_id);
  const path = String(body.path || "");
  const key = parseR2Path(path);
  if (!new RegExp(`^lessons/${lessonId}/[a-f0-9]{32}\\.mp4$`).test(key)) throw error("bad_path");
  if (!(await exists(key))) throw error("file_missing");
  const rows = await sql.query(`select video_path from lessons where id=$1`, [lessonId]);
  if (!rows[0]) throw error("not_found", 404);
  const duration = Math.round(Number(body.duration) || 0);
  await sql.query(`update lessons set video_path=$1,video_size=$2,duration_sec=$3,updated_at=now() where id=$4`, [path, Number(body.size) || null, duration > 0 && duration < 36000 ? duration : null, lessonId]);
  // прежний файл не удаляем: его можно вернуть, пока новое видео не проверено
  return { ok: true, previous_path: rows[0].video_path || null };
}

export async function deleteLesson(sql, body, user) {
  await requireAdmin(user);
  const lessonId = uuid(body.lesson_id);
  const progress = await sql.query(`select 1 from lesson_progress where lesson_id=$1 limit 1`, [lessonId]);
  if (progress.length) throw error("lesson_has_progress");
  const rows = await sql.query(`delete from lessons where id=$1 returning video_path`, [lessonId]);
  if (!rows[0]) throw error("not_found", 404);
  // файл в R2 сохраняется (удаление видео — только вручную после проверки)
  return { ok: true };
}

export default async function handler(req, res) {
  if (!method(req, res)) return;
  try {
    const user = await authUser(req);
    const sql = db();
    const action = String(req.body?.action || "");
    let result;
    if (action === "play") result = await play(sql, req.body, user);
    else if (action === "admin_upload_url") result = await uploadUrl(sql, req.body, user);
    else if (action === "admin_attach_video") result = await attachVideo(sql, req.body, user);
    else if (action === "admin_lesson_delete") result = await deleteLesson(sql, req.body, user);
    else throw error("bad_request");
    json(res, 200, result);
  } catch (value) {
    fail(res, value);
  }
}
