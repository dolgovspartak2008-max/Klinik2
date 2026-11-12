export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

export function fail(res, error) {
  const code = /^[a-z_]{3,40}$/.test(String(error?.message || "")) ? error.message : "server_error";
  json(res, Number(error?.status) || 500, { error: code });
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
