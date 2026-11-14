// Оплата заказов курсов через ЮKassa.
//
// Источник правды — сам ЮKassa: статус платежа сервер всегда перепроверяет запросом
// GET /v3/payments/{id} с секретным ключом. Уведомлению (webhook) и возврату из браузера
// не доверяем — они лишь повод перепроверить. Сумма и валюта сверяются с заказом.
// Повторные уведомления и повторные проверки доступ не дублируют.
import { createPayment, getPayment, isPaymentId, sameAmount, yookassaEnabled } from "./yookassa.js";

function httpError(code, status = 400) {
  const error = new Error(code);
  error.status = status;
  return error;
}

// Колонки оплаты появились позже основной схемы: добавляем их сами при первом обращении,
// чтобы не зависеть от повторного /api/setup (те же команды есть в db/schema.sql).
let columnsReady = false;
export async function ensurePaymentColumns(sql) {
  if (columnsReady) return;
  await sql.query(`alter table course_orders add column if not exists payment_id text`);
  await sql.query(`alter table course_orders add column if not exists payment_status text`);
  await sql.query(`alter table course_orders add column if not exists payment_url text`);
  await sql.query(`alter table course_orders add column if not exists payment_attempt integer not null default 0`);
  await sql.query(`create unique index if not exists orders_payment_id_idx on course_orders(payment_id) where payment_id is not null`);
  columnsReady = true;
}

// Перевод заказа в «оплачен» и выдача доступа. Общая для кнопки админа и ЮKassa.
// allowCancelled — деньги реально пришли по заказу, который клиент успел отменить: доступ всё равно даём.
export async function markOrderPaid(sql, orderId, method, note, { allowCancelled = false } = {}) {
  const from = allowCancelled ? ["pending", "expired", "cancelled"] : ["pending", "expired"];
  const rows = await sql.query(
    `update course_orders set status='paid', payment_method=$2, note=coalesce($3, note), paid_at=now()
     where id=$1 and status = any($4::text[]) returning *`,
    [orderId, method, note || null, from],
  );
  if (!rows[0]) {
    const existing = await sql.query(`select status from course_orders where id=$1`, [orderId]);
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
  // курс оплачен — другие неоплаченные заказы на него больше не нужны
  await sql.query(
    `update course_orders set status='cancelled', note='оплачен другой заказ'
     where user_id=$1 and course_id=$2 and status='pending' and id<>$3`,
    [rows[0].user_id, rows[0].course_id, orderId],
  );
  return { ok: true, already: false };
}

const METHOD_NAMES = { bank_card: "карта", sbp: "СБП", yoo_money: "ЮMoney", sberbank: "SberPay", tinkoff_bank: "T-Pay" };

// Применить к заказу проверенный (полученный из API ЮKassa) платёж.
export async function applyPayment(sql, payment) {
  await ensurePaymentColumns(sql);
  const orderId = String(payment?.metadata?.order_id || "");
  if (!/^[0-9a-f-]{36}$/.test(orderId)) return { ok: false, reason: "no_order" };
  const rows = await sql.query(`select * from course_orders where id=$1`, [orderId]);
  const order = rows[0];
  if (!order) return { ok: false, reason: "no_order" };

  if (payment.status === "succeeded" && payment.paid === true) {
    if (!sameAmount(payment, order.total)) {
      console.error("yookassa amount mismatch", order.id, payment.id);
      await sql.query(`update course_orders set payment_status='amount_mismatch' where id=$1`, [order.id]);
      return { ok: false, reason: "amount_mismatch", order };
    }
    if (order.status === "refunded") return { ok: true, status: "refunded", order };
    const kind = METHOD_NAMES[payment.payment_method?.type] || payment.payment_method?.type || "";
    const result = await markOrderPaid(sql, order.id, `ЮKassa${kind ? " · " + kind : ""}`, `платёж ${payment.id}`, { allowCancelled: true });
    await sql.query(
      `update course_orders set payment_id=coalesce(payment_id, $2), payment_status='succeeded', payment_url=null where id=$1`,
      [order.id, payment.id],
    );
    return { ok: true, status: "paid", already: result.already, order };
  }
  // отменённый, ожидающий и т.п. — просто запоминаем статус текущего платежа
  await sql.query(`update course_orders set payment_status=$2 where id=$1 and payment_id=$3`, [order.id, String(payment.status || ""), payment.id]);
  return { ok: true, status: payment.status, order };
}

async function ownOrder(sql, orderId, user) {
  const rows = await sql.query(
    `select o.*, c.title, c.slug as course_slug from course_orders o join courses c on c.id=o.course_id
     where o.id=$1 and o.user_id=$2`,
    [orderId, user.id],
  );
  if (!rows[0]) throw httpError("not_found", 404);
  return rows[0];
}

// Начать оплату: вернуть ссылку на страницу оплаты ЮKassa.
// Живой (ожидающий) платёж по заказу переиспользуется — второй платёж не создаётся.
export async function startPayment(sql, orderId, user, { origin, email }) {
  if (!yookassaEnabled()) throw httpError("payment_unavailable", 503);
  await ensurePaymentColumns(sql);
  let order = await ownOrder(sql, orderId, user);
  if (order.status === "paid") return { paid: true, course_slug: order.course_slug };
  if (order.status !== "pending") throw httpError("order_not_payable");
  if (Number(order.total) <= 0) throw httpError("bad_request");

  if (order.payment_id) {
    const current = await getPayment(order.payment_id);
    const applied = await applyPayment(sql, current);
    if (applied.status === "paid") return { paid: true, course_slug: order.course_slug };
    if (current.status === "pending" && current.confirmation?.confirmation_url) {
      return { url: current.confirmation.confirmation_url };
    }
    if (current.status === "waiting_for_capture") return { waiting: true };
    // прежний платёж отменён/истёк — следующая попытка получит новый ключ идемпотентности
    await sql.query(
      `update course_orders set payment_attempt=payment_attempt+1, payment_id=null, payment_url=null
       where id=$1 and payment_id=$2`,
      [order.id, order.payment_id],
    );
    order = await ownOrder(sql, orderId, user);
  }

  const returnUrl = `${origin}/kabinet/?order=${encodeURIComponent(order.id)}#courses`;
  // один и тот же ключ на одну попытку: двойной клик не создаст два платежа
  const payment = await createPayment({
    order, title: order.title, email, returnUrl,
    idempotenceKey: `order-${order.id}-${Number(order.payment_attempt) || 0}`,
  });
  if (!isPaymentId(payment?.id) || !payment.confirmation?.confirmation_url) throw httpError("payment_failed", 502);
  await sql.query(
    `update course_orders set payment_id=$2, payment_status=$3, payment_url=$4 where id=$1 and status='pending'`,
    [order.id, payment.id, payment.status, payment.confirmation.confirmation_url],
  );
  return { url: payment.confirmation.confirmation_url };
}

// Проверить оплату после возврата со страницы ЮKassa (на случай, если уведомление ещё не дошло).
export async function checkPayment(sql, orderId, user) {
  await ensurePaymentColumns(sql);
  const order = await ownOrder(sql, orderId, user);
  const out = (status) => ({ status, order_no: order.order_no, title: order.title, course_slug: order.course_slug });
  if (order.status === "paid") return out("paid");
  if (!order.payment_id || !yookassaEnabled()) return out(order.status);
  const payment = await getPayment(order.payment_id);
  const applied = await applyPayment(sql, payment);
  if (applied.status === "paid") return out("paid");
  if (payment.status === "canceled") return out("canceled");
  return out(order.status === "pending" ? "waiting" : order.status);
}
