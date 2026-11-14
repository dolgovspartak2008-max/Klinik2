// Клиент API ЮKassa (https://yookassa.ru/developers/api).
// Ключи — только в переменных окружения Vercel: YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY.
// В браузер они не попадают: все вызовы идут с сервера.
const API = "https://api.yookassa.ru/v3";
const TIMEOUT_MS = 10000;

function httpError(code, status = 400) {
  const error = new Error(code);
  error.status = status;
  return error;
}

export function yookassaEnabled() {
  return !!(String(process.env.YOOKASSA_SHOP_ID || "").trim() && String(process.env.YOOKASSA_SECRET_KEY || "").trim());
}

// id платежа ЮKassa — 36 символов вида 2419a771-000f-5000-9000-1edaf29243f2
export function isPaymentId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(value || ""));
}

function authHeader() {
  const shop = String(process.env.YOOKASSA_SHOP_ID || "").trim();
  const key = String(process.env.YOOKASSA_SECRET_KEY || "").trim();
  return "Basic " + Buffer.from(`${shop}:${key}`).toString("base64");
}

async function call(path, { method = "GET", body, idempotenceKey } = {}) {
  if (!yookassaEnabled()) throw httpError("payment_unavailable", 503);
  const headers = { Authorization: authHeader(), "Content-Type": "application/json" };
  if (idempotenceKey) headers["Idempotence-Key"] = idempotenceKey;
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error("yookassa network", error?.name || error);
    throw httpError("payment_failed", 502);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    // в лог — только код и описание ошибки ЮKassa, без ключей и персональных данных
    console.error("yookassa api", res.status, data?.code || "", data?.description || "");
    throw httpError(res.status === 404 ? "payment_not_found" : "payment_failed", res.status === 404 ? 404 : 502);
  }
  return data;
}

function money(value) {
  return Number(value).toFixed(2);
}

function validEmail(value) {
  const text = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) && !text.endsWith("@neon.local") ? text : null;
}

// Чек по 54-ФЗ. Нужен, если в личном кабинете ЮKassa подключены «Чеки от ЮKassa»
// или онлайн-касса: тогда задайте YOOKASSA_RECEIPT=1 (и при необходимости YOOKASSA_VAT_CODE).
export function receiptFor({ title, total, email }) {
  if (String(process.env.YOOKASSA_RECEIPT || "") !== "1") return null;
  const customerEmail = validEmail(email);
  if (!customerEmail) throw httpError("email_required");
  const vat = Number(process.env.YOOKASSA_VAT_CODE || 1); // 1 — без НДС
  const receipt = {
    customer: { email: customerEmail },
    items: [{
      description: `Онлайн-курс «${title}»`.slice(0, 128),
      quantity: "1.00",
      amount: { value: money(total), currency: "RUB" },
      vat_code: Number.isInteger(vat) && vat >= 1 && vat <= 12 ? vat : 1,
      payment_mode: "full_payment",
      payment_subject: "service",
    }],
  };
  const tax = Number(process.env.YOOKASSA_TAX_SYSTEM_CODE || 0);
  if (Number.isInteger(tax) && tax >= 1 && tax <= 6) receipt.tax_system_code = tax;
  return receipt;
}

export async function createPayment({ order, title, email, returnUrl, idempotenceKey }) {
  const body = {
    amount: { value: money(order.total), currency: "RUB" },
    capture: true,
    confirmation: { type: "redirect", return_url: returnUrl },
    description: `Заказ № ${order.order_no}: онлайн-курс «${title}»`.slice(0, 128),
    metadata: { order_id: String(order.id), order_no: String(order.order_no) },
  };
  const receipt = receiptFor({ title, total: order.total, email });
  if (receipt) body.receipt = receipt;
  return call("/payments", { method: "POST", body, idempotenceKey });
}

export async function getPayment(id) {
  if (!isPaymentId(id)) throw httpError("bad_request");
  return call(`/payments/${id}`);
}

export function sameAmount(payment, total) {
  return payment?.amount?.currency === "RUB" && money(payment?.amount?.value) === money(total);
}
