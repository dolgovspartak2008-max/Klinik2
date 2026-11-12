export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

export function fail(res, error) {
  const known = /^[a-z_]{3,40}$/.test(String(error?.message || ""));
  const code = known ? error.message : "server_error";
  if (!known) console.error("api error", error?.message || error);
  const body = { error: code };
  // безопасные подробности для клиента (например, other_device)
  if (known && error.extra && typeof error.extra === "object") Object.assign(body, error.extra);
  json(res, known ? Number(error?.status) || 400 : 500, body);
}

export function method(req, res) {
  if (req.method === "POST") return true;
  json(res, 405, { error: "method" });
  return false;
}

export function uuid(value) {
  const text = String(value || "").toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(text)) {
    const error = new Error("bad_request");
    error.status = 400;
    throw error;
  }
  return text;
}
