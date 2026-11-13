// Проверки серверной логики курсов на настоящем Postgres (PGlite, в памяти),
// с локальными ключами JWT и без сети: R2 подменяется заглушкой fetch.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { before } from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";

const AUTH_BASE = "https://ep-test.neonauth.example.aws.neon.tech/neondb/auth";
const ISSUER = "https://ep-test.neonauth.example.aws.neon.tech";
Object.assign(process.env, {
  NEON_AUTH_BASE_URL: AUTH_BASE,
  ADMIN_EMAIL: "owner@example.com",
  R2_ACCOUNT_ID: "acc", R2_ACCESS_KEY_ID: "AKIATEST", R2_SECRET_ACCESS_KEY: "secret-test", R2_BUCKET: "videos",
});

const { setDbForTests } = await import("../api/_lib/db.js");
const { setJwksForTests, authUser } = await import("../api/_lib/auth.js");
const { dispatch } = await import("../api/rpc.js");
const courses = await import("../api/courses.js");
const { default: setupHandler } = await import("../api/setup.js");

const COURSE = "7b2e1d0f-2c3b-4d4e-9f50-000000000010";
const L1 = "8c3f2e10-3d4c-4e5f-a061-000000000011";
const L2 = "8c3f2e10-3d4c-4e5f-a061-000000000012";
const DEVICE = "device-aaaaaaaaaaaaaaaa";

let pg, sql, privateKey, otherKey;
const admin = { id: "u-admin", email: "owner@example.com", emailVerified: true, name: "Владелец" };
const adminUnverified = { id: "u-fake", email: "owner@example.com", emailVerified: false, name: "Чужой" };
const student = { id: "u-student", email: "student@example.com", emailVerified: false, name: "Анна" };

// R2: HEAD «файл есть», всё остальное — ошибка (сеть в тестах не нужна)
globalThis.fetch = async (request) => {
  const r = request instanceof Request ? request : new Request(request);
  if (r.method === "HEAD" && r.url.includes(".r2.cloudflarestorage.com/videos/lessons/")) return new Response(null, { status: 200 });
  throw new Error("unexpected network call " + r.method + " " + r.url);
};

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => { assert.equal(error.message, code); return true; });
}

before(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
  await pg.exec(schema);
  sql = { query: async (text, params = []) => (await pg.query(text, params)).rows };
  setDbForTests(sql);
  const keys = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  privateKey = keys.privateKey;
  otherKey = (await generateKeyPair("EdDSA", { crv: "Ed25519" })).privateKey;
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "EdDSA" };
  setJwksForTests(createLocalJWKSet({ keys: [jwk] }));
  // курс готов к продаже: цена, урок 1 с видео и опубликован
  await sql.query(`update courses set price=2990, status='published' where id=$1`, [COURSE]);
  await sql.query(`update lessons set video_path='r2:lessons/${L1}/0123456789abcdef0123456789abcdef.mp4', hidden=false, duration_sec=100 where id=$1`, [L1]);
});

test("схема: курс «Здоровые суставы и спина» и 10 уроков, 9 из них скрыты до загрузки видео", async () => {
  const [c] = await sql.query(`select title from courses where id=$1`, [COURSE]);
  assert.equal(c.title, "Здоровые суставы и спина");
  const [n] = await sql.query(`select count(*)::int as all, count(*) filter (where hidden)::int as hidden from lessons where course_id=$1`, [COURSE]);
  assert.deepEqual(n, { all: 10, hidden: 9 });
  const [t] = await sql.query(`select for_whom from courses where id=$1`, [COURSE]);
  assert.ok(t.for_whom.includes("\n"), "переносы строк в описании — настоящие, а не \\n");
});

test("каталог и курс доступны без входа", async () => {
  const catalog = await dispatch("courses_catalog", {}, null);
  assert.equal(catalog.courses.length, 1);
  assert.ok(Array.isArray(catalog.courses[0].modules), "у карточки в каталоге есть список модулей");
  const detail = await dispatch("course_detail", { p_slug: "zdorovye-sustavy-i-spina" }, null);
  assert.equal(detail.lessons.length, 1);
  assert.equal(detail.lessons[0].video_path, undefined);
  await expectCode(dispatch("my_courses", {}, null), "not_authenticated");
});

test("без покупки play возвращает отказ", async () => {
  await expectCode(courses.play(sql, { lesson_id: L1, device_id: DEVICE }, student), "no_access");
});

test("после оплаты выдаётся 10-минутная ссылка только на нужный урок; повтор подтверждения ничего не дублирует", async () => {
  const { order } = await dispatch("course_order_create", { p_item_type: "course", p_item_id: COURSE, p_key: "key-0001" }, student);
  assert.equal(order.status, "pending");
  // повторный заказ возвращает тот же неоплаченный
  const again = await dispatch("course_order_create", { p_item_type: "course", p_item_id: COURSE, p_key: "key-0002" }, student);
  assert.equal(again.order.id, order.id);
  await expectCode(dispatch("admin_order_mark_paid", { p_order: order.id, p_method: "перевод" }, student), "forbidden");
  const first = await dispatch("admin_order_mark_paid", { p_order: order.id, p_method: "перевод" }, admin);
  assert.equal(first.already, false);
  const second = await dispatch("admin_order_mark_paid", { p_order: order.id, p_method: "перевод" }, admin);
  assert.equal(second.already, true);
  const [counts] = await sql.query(
    `select (select count(*) from course_access where user_id=$1)::int as access,
            (select count(*) from course_orders where user_id=$1 and status='paid')::int as paid`, [student.id]);
  assert.deepEqual(counts, { access: 1, paid: 1 });

  const r = await courses.play(sql, { lesson_id: L1, device_id: DEVICE }, student);
  const url = new URL(r.url);
  assert.equal(url.hostname, "acc.r2.cloudflarestorage.com");
  assert.equal(url.pathname, `/videos/lessons/${L1}/0123456789abcdef0123456789abcdef.mp4`);
  assert.equal(url.searchParams.get("X-Amz-Expires"), "600");
  assert.equal(r.expires_in, 600);
  assert.ok(!r.url.includes("secret-test"), "секрет R2 не попадает в ссылку");
  // скрытый урок без видео не выдаётся даже после покупки
  await expectCode(courses.play(sql, { lesson_id: L2, device_id: DEVICE }, student), "no_access");
});

test("одновременно — одно устройство", async () => {
  await assert.rejects(courses.play(sql, { lesson_id: L1, device_id: "device-bbbbbbbbbbbbbbbb" }, student),
    (e) => e.message === "other_device" && e.status === 409);
  const forced = await courses.play(sql, { lesson_id: L1, device_id: "device-bbbbbbbbbbbbbbbb", force: true }, student);
  assert.ok(forced.url);
});

test("прогресс урока сохраняется и считается", async () => {
  const half = await dispatch("course_progress_save", { p_lesson: L1, p_position: 40, p_duration: 100 }, student);
  assert.equal(!!half.completed, false);
  const done = await dispatch("course_progress_save", { p_lesson: L1, p_position: 95, p_duration: 100 }, student);
  assert.equal(done.completed, true);
  assert.equal(done.progress.percent, 100);
  const player = await dispatch("course_player", { p_slug: "zdorovye-sustavy-i-spina" }, student);
  assert.equal(player.access, true);
  assert.equal(player.lessons[0].video_path, undefined, "путь к файлу не уходит в браузер");
  await expectCode(dispatch("course_progress_save", { p_lesson: L1, p_position: 1 }, { id: "u-other", email: "x@example.com" }), "no_access");
});

test("отзыв доступа закрывает просмотр и останавливает текущую сессию", async () => {
  const r = await courses.play(sql, { lesson_id: L1, device_id: DEVICE, force: true }, student);
  const [order] = await sql.query(`select id from course_orders where user_id=$1`, [student.id]);
  await dispatch("admin_access_revoke_order", { p_order: order.id }, admin);
  await expectCode(courses.play(sql, { lesson_id: L1, device_id: DEVICE }, student), "no_access");
  const beat = await dispatch("course_heartbeat", { p_session: r.session_id }, student);
  assert.deepEqual(beat, { ok: false, reason: "revoked" });
  // повторное подтверждение уже оплаченного заказа доступ не возвращает
  const again = await dispatch("admin_order_mark_paid", { p_order: order.id, p_method: "перевод" }, admin);
  assert.equal(again.already, true);
  await expectCode(courses.play(sql, { lesson_id: L1, device_id: DEVICE }, student), "no_access");
});

test("admin API: обычный пользователь и неподтверждённый email владельца получают отказ", async () => {
  await expectCode(dispatch("admin_courses_overview", {}, student), "forbidden");
  await expectCode(dispatch("admin_courses_overview", {}, adminUnverified), "email_not_verified");
  await expectCode(courses.uploadUrl(sql, { kind: "video", content_type: "video/mp4", size: 1000, target_id: L2 }, student), "forbidden");
  const ok = await dispatch("admin_me", {}, admin);
  assert.equal(ok.ok, true);
});

test("загрузка: подписанный PUT, безопасный путь, лимит размера, старый файл сохраняется", async () => {
  const up = await courses.uploadUrl(sql, { kind: "video", content_type: "video/mp4", size: 5_000_000, target_id: L2 }, admin);
  assert.match(up.path, new RegExp(`^r2:lessons/${L2}/[a-f0-9]{32}\\.mp4$`));
  const put = new URL(up.url);
  assert.equal(put.searchParams.get("X-Amz-Expires"), "3600");
  assert.equal(up.headers["Content-Type"], "video/mp4");
  await expectCode(courses.uploadUrl(sql, { kind: "video", content_type: "video/mp4", size: courses.VIDEO_MAX + 1, target_id: L2 }, admin), "video_too_big");
  await expectCode(courses.uploadUrl(sql, { kind: "video", content_type: "video/quicktime", size: 10, target_id: L2 }, admin), "video_format");
  // путь от другого урока или с «..» не принимается
  await expectCode(courses.attachVideo(sql, { lesson_id: L2, path: `r2:lessons/${L1}/0123456789abcdef0123456789abcdef.mp4` }, admin), "bad_path");
  await expectCode(courses.attachVideo(sql, { lesson_id: L2, path: `r2:lessons/${L2}/../x.mp4` }, admin), "bad_path");
  const first = await courses.attachVideo(sql, { lesson_id: L2, path: up.path, size: 5_000_000, duration: 60 }, admin);
  assert.equal(first.previous_path, null);
  const up2 = await courses.uploadUrl(sql, { kind: "video", content_type: "video/mp4", size: 6_000_000, target_id: L2 }, admin);
  const second = await courses.attachVideo(sql, { lesson_id: L2, path: up2.path, size: 6_000_000, duration: 61 }, admin);
  assert.equal(second.previous_path, up.path, "прежний файл остаётся в R2 и указан в ответе");
});

test("публикация курса — только с ценой и уроком с видео", async () => {
  const { id } = await dispatch("admin_course_save", { p: { slug: "test-kurs", category_id: "6a1f0c0e-1b2a-4c3d-8e4f-000000000005", title: "Тест", price: "" } }, admin);
  await expectCode(dispatch("admin_course_set_status", { p_id: id, p_status: "published" }, admin), "no_lessons");
  await sql.query(`insert into lessons(course_id,title,video_path,hidden) values($1,'Урок','r2:lessons/x/y.mp4',false)`, [id]);
  await expectCode(dispatch("admin_course_set_status", { p_id: id, p_status: "published" }, admin), "price_required");
});

async function token(claims, key = privateKey, opts = {}) {
  let jwt = new SignJWT({ email: "student@example.com", emailVerified: false, name: "Анна", ...claims })
    .setProtectedHeader({ alg: "EdDSA", kid: "k1" }).setSubject("u-student").setIssuedAt()
    .setIssuer(opts.issuer || ISSUER).setAudience(opts.audience || ISSUER).setExpirationTime(opts.exp || "15m");
  return jwt.sign(key);
}
const req = (t) => ({ headers: { authorization: "Bearer " + t } });

test("JWT: верный принимается, просроченный, чужой ключ и чужой издатель — 401", async () => {
  const user = await authUser(req(await token({})));
  assert.equal(user.id, "u-student");
  assert.equal(user.emailVerified, false);
  const expired = await token({}, privateKey, { exp: Math.floor(Date.now() / 1000) - 120 });
  await expectCode(authUser(req(expired)), "not_authenticated");
  await expectCode(authUser(req(await token({}, otherKey))), "not_authenticated");
  await expectCode(authUser(req(await token({}, privateKey, { issuer: "https://evil.example" }))), "not_authenticated");
  const good = await token({});
  const [h, p, s] = good.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url")), sub: "u-admin", email: "owner@example.com", emailVerified: true })).toString("base64url");
  await expectCode(authUser(req(`${h}.${forged}.${s}`)), "not_authenticated");
  await expectCode(authUser({ headers: {} }), "not_authenticated");
  assert.equal(await authUser(req("garbage"), true), null, "публичные методы: плохой токен = гость");
});

function fakeRes() {
  return { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
}

test("/api/setup закрыт без SETUP_TOKEN и с неверным токеном", async () => {
  delete process.env.SETUP_TOKEN;
  let res = fakeRes();
  await setupHandler({ method: "POST", headers: {} }, res);
  assert.equal(res.statusCode, 404);
  process.env.SETUP_TOKEN = "x".repeat(40);
  res = fakeRes();
  await setupHandler({ method: "POST", headers: { "x-setup-token": "y".repeat(40) } }, res);
  assert.equal(res.statusCode, 403);
  res = fakeRes();
  await setupHandler({ method: "POST", headers: { "x-setup-token": "x".repeat(40) } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).lessons, 10);
  delete process.env.SETUP_TOKEN;
});
