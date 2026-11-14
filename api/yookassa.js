import { db } from "./_lib/db.js";
import { json } from "./_lib/http.js";
import { applyPayment } from "./_lib/payments.js";
import { getPayment, isPaymentId, yookassaEnabled } from "./_lib/yookassa.js";

// HTTP-уведомления ЮKassa: https://www.drgorshechnikov.ru/api/yookassa
// (личный кабинет ЮKassa → Интеграция → HTTP-уведомления; события payment.succeeded и payment.canceled).
//
// Телу уведомления не доверяем: берём из него только id платежа и запрашиваем платёж
// у API ЮKassa с секретным ключом. Поддельное уведомление ничего не изменит.
// Ответ 200 — «принято»; при сбое связи с ЮKassa отвечаем 500, и ЮKassa повторит уведомление.
export default async function handler(req, res) {
  if (!yookassaEnabled()) return json(res, 404, { error: "not_found" });
  if (req.method !== "POST") return json(res, 405, { error: "method" });
  const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
  const id = String(body?.object?.id || "");
  const event = String(body?.event || "");
  if (!event.startsWith("payment.") || !isPaymentId(id)) return json(res, 200, { ok: true, ignored: true });
  try {
    const payment = await getPayment(id);
    const result = await applyPayment(db(), payment);
    if (!result.ok) console.error("yookassa webhook", result.reason, id);
    return json(res, 200, { ok: true });
  } catch (error) {
    if (error?.message === "payment_not_found") return json(res, 200, { ok: true, ignored: true });
    console.error("yookassa webhook error", error?.message || error);
    return json(res, 500, { error: "retry" });
  }
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}
