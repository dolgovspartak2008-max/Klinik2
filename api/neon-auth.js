// Прокси Neon Auth на своём домене: /neon-auth/<путь> -> NEON_AUTH_BASE_URL/<путь>.
// Cookie сессии становится first-party (вход работает и в Safari), а Neon Auth
// получает правильный Host. Origin браузера передаётся как есть — домен сайта
// должен быть в списке доверенных в настройках Neon Auth.
const PATH_RE = /^[a-z0-9][a-z0-9/_.-]{0,120}$/i;
const PASS_REQUEST = ["content-type", "cookie", "origin", "user-agent", "accept", "accept-language"];
const MAX_BODY = 16 * 1024;

function base() {
  const value = String(process.env.NEON_AUTH_BASE_URL || "").replace(/\/+$/, "");
  if (!value) throw new Error("NEON_AUTH_BASE_URL is not configured");
  return value;
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://local");
    const path = String(url.searchParams.get("path") || "");
    if (!PATH_RE.test(path) || path.includes("..")) {
      res.statusCode = 404;
      return res.end(JSON.stringify({ code: "NOT_FOUND" }));
    }
    url.searchParams.delete("path");
    const target = `${base()}/${path}${url.search}`;
    const headers = {};
    for (const name of PASS_REQUEST) if (req.headers[name]) headers[name] = req.headers[name];
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (ip) headers["x-forwarded-for"] = ip;
    let body;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
      if (Buffer.byteLength(body) > MAX_BODY) {
        res.statusCode = 413;
        return res.end(JSON.stringify({ code: "PAYLOAD_TOO_LARGE" }));
      }
      headers["content-type"] = headers["content-type"] || "application/json";
    }
    const upstream = await fetch(target, { method: req.method, headers, body, redirect: "manual" });
    res.statusCode = upstream.status;
    for (const name of ["content-type", "location", "set-auth-jwt"]) {
      const v = upstream.headers.get(name);
      if (v) res.setHeader(name, v);
    }
    const cookies = typeof upstream.headers.getSetCookie === "function" ? upstream.headers.getSetCookie() : [];
    if (cookies.length) res.setHeader("set-cookie", cookies.map((c) => c.replace(/;\s*Domain=[^;]+/i, "")));
    res.setHeader("Cache-Control", "no-store");
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error("neon-auth proxy", error?.message || error);
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ code: "AUTH_UNAVAILABLE" }));
  }
}
