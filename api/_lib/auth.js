import { createRemoteJWKSet, jwtVerify } from "jose";

let jwks;

function authBaseUrl() {
  const value = String(process.env.NEON_AUTH_BASE_URL || "").replace(/\/+$/, "");
  if (!value) throw new Error("NEON_AUTH_BASE_URL is not configured");
  return value;
}

export function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  return value.replace(/^Bearer\s+/i, "").trim();
}

export async function authUser(req, optional = false) {
  const token = bearerToken(req);
  if (!token) {
    if (optional) return null;
    const error = new Error("not_authenticated");
    error.status = 401;
    throw error;
  }
  const base = authBaseUrl();
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${base}/jwks`));
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: base });
    if (!payload.sub) throw new Error("missing sub");
    return {
      id: payload.sub,
      email: typeof payload.email === "string" ? payload.email : "",
      name: typeof payload.name === "string" ? payload.name : "",
      claims: payload,
    };
  } catch {
    const error = new Error("not_authenticated");
    error.status = 401;
    throw error;
  }
}
