// Онлайн-оплата через ЮKassa: настоящий Postgres в памяти (PGlite), API ЮKassa подменён заглушкой.
// Проверяется: повторный клик не создаёт второй платёж, поддельное уведомление ничего не меняет,
// неверная сумма не открывает доступ, повтор уведомления не дублирует доступ, чек 54-ФЗ.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

Object.assign(process.env, { YOOKASSA_SHOP_ID: "123456", YOOKASSA_SECRET_KEY: "test_secret", ADMIN_EMAIL: "owner@example.com",
  NEON_AUTH_BASE_URL: "https://ep-test.neonauth.example.aws.neon.tech/neondb/auth" });
delete process.env.YOOKASSA_RECEIPT;

const { setDbForTests } = await import("../api/_lib/db.js");
const { dispatch } = await import("../api/rpc.js");
const { default: webhook } = await import("../api/yookassa.js");

test("оплата заказа через ЮKassa", async () => {
const pg = await PGlite.create({ extensions: { pgcrypto } });
await pg.exec(await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
const sql = { query: async (text, params = []) => (await pg.query(text, params)).rows };
setDbForTests(sql);
const COURSE = "7b2e1d0f-2c3b-4d4e-9f50-000000000010", L1 = "8c3f2e10-3d4c-4e5f-a061-000000000011";
await sql.query(`update courses set price=2990, status='published' where id=$1`, [COURSE]);
await sql.query(`update lessons set video_path='r2:x', hidden=false, duration_sec=100 where id=$1`, [L1]);
const student = { id: "u-st", email: "st@example.com", emailVerified: true, name: "Анна Иванова" };
const other = { id: "u-ot", email: "ot@example.com", emailVerified: true, name: "Борис" };
const admin = { id: "u-ad", email: "owner@example.com", emailVerified: true, name: "A" };
const realFetch = globalThis.fetch;

// фейковый ЮKassa
const payments = {}; let created = 0; const keys = [];
globalThis.fetch = async (url, init = {}) => {
  assert.ok(String(url).startsWith("https://api.yookassa.ru/v3/"));
  assert.equal(init.headers.Authorization, "Basic " + Buffer.from("123456:test_secret").toString("base64"));
  if (init.method === "POST") {
    const key = init.headers["Idempotence-Key"]; keys.push(key);
    const body = JSON.parse(init.body);
    const existing = Object.values(payments).find((p) => p._key === key);
    if (existing) return new Response(JSON.stringify(existing), { status: 200 });
    const id = `2419a771-000f-5000-9000-${String(++created).padStart(12, "0")}`;
    payments[id] = { id, _key: key, status: "pending", paid: false, amount: body.amount, metadata: body.metadata, confirmation: { type: "redirect", confirmation_url: `https://yoomoney.ru/checkout/payments/v2/contract?orderId=${id}` }, _body: body };
    return new Response(JSON.stringify(payments[id]), { status: 200 });
  }
  const id = String(url).split("/").pop();
  if (!payments[id]) return new Response(JSON.stringify({ type: "error", code: "not_found" }), { status: 404 });
  return new Response(JSON.stringify(payments[id]), { status: 200 });
};
  function fakeRes() { return { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } }; }

const q = await dispatch("course_quote", { p_item_type: "course", p_item_id: COURSE }, student);
assert.equal(q.online_payment, true);
const { order, online_payment } = await dispatch("course_order_create", { p_item_type: "course", p_item_id: COURSE, p_key: "k-00000001" }, student);
assert.equal(online_payment, true); assert.equal(order.status, "pending");
assert.equal(order.payment_id, undefined); assert.equal(order.idempotency_key, undefined);

const ctx = { origin: "https://www.drgorshechnikov.ru" };
const s1 = await dispatch("course_payment_start", { p_order: order.id }, student, sql, ctx);
assert.match(s1.url, /^https:\/\/yoomoney\.ru\//);
const p1 = Object.values(payments)[0];
assert.equal(p1._body.amount.value, "2990.00");
assert.equal(p1._body.confirmation.return_url, `https://www.drgorshechnikov.ru/kabinet/?order=${order.id}#courses`);
assert.equal(p1._body.receipt, undefined);
// повторный клик — тот же платёж
const s2 = await dispatch("course_payment_start", { p_order: order.id }, student, sql, ctx);
assert.equal(s2.url, s1.url); assert.equal(created, 1);
// чужой заказ
await assert.rejects(dispatch("course_payment_start", { p_order: order.id }, other, sql, ctx), /not_found/);
await assert.rejects(dispatch("course_payment_check", { p_order: order.id }, other, sql, ctx), /not_found/);
// проверка до оплаты
assert.equal((await dispatch("course_payment_check", { p_order: order.id }, student)).status, "waiting");

// поддельное уведомление: в теле "succeeded", но API говорит pending — ничего не меняется
let res = fakeRes();
await webhook({ method: "POST", body: { type: "notification", event: "payment.succeeded", object: { id: p1.id, status: "succeeded", paid: true, amount: { value: "2990.00", currency: "RUB" }, metadata: { order_id: order.id } } } }, res);
assert.equal(res.statusCode, 200);
let [o] = await sql.query(`select status from course_orders where id=$1`, [order.id]);
assert.equal(o.status, "pending");

// платёж отменён -> новая попытка с новым ключом
p1.status = "canceled";
const s3 = await dispatch("course_payment_start", { p_order: order.id }, student, sql, ctx);
assert.equal(created, 2); assert.notEqual(s3.url, s1.url);
assert.notEqual(keys[0], keys[keys.length - 1]);
const p2 = Object.values(payments)[1];

// неверная сумма -> доступ не выдаётся
p2.status = "succeeded"; p2.paid = true; p2.amount = { value: "1.00", currency: "RUB" };
res = fakeRes(); await webhook({ method: "POST", body: { event: "payment.succeeded", object: { id: p2.id } } }, res);
assert.equal(res.statusCode, 200);
[o] = await sql.query(`select status, payment_status from course_orders where id=$1`, [order.id]);
assert.deepEqual(o, { status: "pending", payment_status: "amount_mismatch" });

// настоящая оплата: webhook дважды -> один доступ
p2.amount = { value: "2990.00", currency: "RUB" }; p2.payment_method = { type: "sbp" };
for (let i = 0; i < 2; i++) { res = fakeRes(); await webhook({ method: "POST", body: JSON.stringify({ event: "payment.succeeded", object: { id: p2.id } }) }, res); assert.equal(res.statusCode, 200); }
[o] = await sql.query(`select status, payment_method, payment_status from course_orders where id=$1`, [order.id]);
assert.deepEqual(o, { status: "paid", payment_method: "ЮKassa · СБП", payment_status: "succeeded" });
const [n] = await sql.query(`select count(*)::int as n from course_access where user_id=$1 and revoked_at is null`, [student.id]);
assert.equal(n.n, 1);
const chk = await dispatch("course_payment_check", { p_order: order.id }, student);
assert.equal(chk.status, "paid"); assert.equal(chk.course_slug, "zdorovye-sustavy-i-spina");
const st = await dispatch("course_payment_start", { p_order: order.id }, student, sql, ctx);
assert.equal(st.paid, true);
await assert.rejects(dispatch("course_order_create", { p_item_type: "course", p_item_id: COURSE, p_key: "k-00000002" }, student), /already_owned/);

// плеер: имя, прогресс
const pl = await dispatch("course_player", { p_slug: "zdorovye-sustavy-i-spina" }, student);
assert.equal(pl.student_name, "Анна Иванова"); assert.equal(pl.access, true);
const done = await dispatch("course_progress_save", { p_lesson: L1, p_position: 99, p_duration: 100 }, student);
assert.deepEqual([done.progress.total, done.progress.completed], [1, 1]);

// админка: кнопка ручной оплаты по-прежнему работает, список заказов без секретов
const o2 = (await dispatch("course_order_create", { p_item_type: "course", p_item_id: COURSE, p_key: "k-00000003" }, other)).order;
assert.equal((await dispatch("admin_order_mark_paid", { p_order: o2.id, p_method: "перевод" }, admin)).already, false);
assert.equal((await dispatch("admin_order_mark_paid", { p_order: o2.id, p_method: "перевод" }, admin)).already, true);
const list = await dispatch("admin_course_orders", {}, admin);
assert.ok(list.every((r) => r.payment_url === undefined && r.idempotency_key === undefined));
assert.ok(list.find((r) => r.id === order.id).payment.method.includes("ЮKassa"));
const my = await dispatch("my_courses", {}, student);
assert.equal(my.online_payment, true); assert.ok(my.orders.every((r) => r.payment_id === undefined));

// уведомление ЮKassa не дошло и клиент не вернулся на сайт: доступ откроется при открытии кабинета
const late = { id: "u-late", email: "late@example.com", emailVerified: true, name: "Г" };
const o4 = (await dispatch("course_order_create", { p_item_type: "course", p_item_id: COURSE, p_key: "k-00000005" }, late)).order;
await dispatch("course_payment_start", { p_order: o4.id }, late, sql, ctx);
const p4 = Object.values(payments).pop();
p4.status = "succeeded"; p4.paid = true;
const myLate = await dispatch("my_courses", {}, late);
assert.equal(myLate.courses.length, 1, "курс выдан без уведомления ЮKassa");
assert.equal(myLate.orders[0].status, "paid");

// чек 54-ФЗ
process.env.YOOKASSA_RECEIPT = "1";
const third = { id: "u-3", email: "c@example.com", emailVerified: true, name: "В" };
const o3 = (await dispatch("course_order_create", { p_item_type: "course", p_item_id: COURSE, p_key: "k-00000004" }, third)).order;
await dispatch("course_payment_start", { p_order: o3.id }, third, sql, ctx);
const p3 = Object.values(payments).pop();
assert.equal(p3._body.receipt.customer.email, "c@example.com");
assert.equal(p3._body.receipt.items[0].amount.value, "2990.00");
// оплатили отменённый клиентом заказ — доступ всё равно даём
await dispatch("course_order_cancel", { p_order: o3.id }, third);
p3.status = "succeeded"; p3.paid = true;
res = fakeRes(); await webhook({ method: "POST", body: { event: "payment.succeeded", object: { id: p3.id } } }, res);
[o] = await sql.query(`select status from course_orders where id=$1`, [o3.id]);
assert.equal(o.status, "paid");
// мусор и выключенная оплата
res = fakeRes(); await webhook({ method: "POST", body: { event: "payment.succeeded", object: { id: "../../x" } } }, res); assert.equal(res.statusCode, 200);
res = fakeRes(); await webhook({ method: "GET" }, res); assert.equal(res.statusCode, 405);
delete process.env.YOOKASSA_SECRET_KEY;
res = fakeRes(); await webhook({ method: "POST", body: {} }, res); assert.equal(res.statusCode, 404);
assert.equal((await dispatch("course_quote", { p_item_type: "course", p_item_id: "7b2e1d0f-2c3b-4d4e-9f50-000000000010" }, { id: "u-4", email: "d@example.com", emailVerified: true })).online_payment, false);
globalThis.fetch = realFetch;
process.env.YOOKASSA_SECRET_KEY = "test_secret";
delete process.env.YOOKASSA_RECEIPT;
});
