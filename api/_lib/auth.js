import { createRemoteJWKSet, jwtVerify } from "jose";

// Neon Auth (Better Auth): ключи — `${base}/.well-known/jwks.json`,
// issuer и audience в JWT — origin сервиса авторизации (без пути /neondb/auth).
let jwks;
let testJwks = null;

export function authBaseUrl() {
  const value = String(process.env.NEON_AUTH_BASE_URL || "").replace(/\/+$/, "");
  if (!value) throw new Error("NEON_AUTH_BASE_URL is not configured");
  return value;
}

export function authIssuer() {
  return new URL(authBaseUrl()).origin;
}

// только для тестов: локальный набор ключей вместо загрузки по сети
export function setJwksForTests(value) {
  testJwks = value;
  jwks = undefined;
}

export function bearerToken(req) {
  const value = String(req.headers?.authorization || "");
  return value.replace(/^Bearer\s+/i, "").trim();
}

function unauthorized() {
  const error = new Error("not_authenticated");
  error.status = 401;
  return error;
}

export async function verifyToken(token) {
  const base = authBaseUrl();
  const keys = testJwks || (jwks ||= createRemoteJWKSet(new URL(`${base}/.well-known/jwks.json`)));
  const issuer = authIssuer();
  const { payload } = await jwtVerify(token, keys, { issuer, audience: issuer, algorithms: ["EdDSA", "ES256", "RS256"] });
  if (!payload.sub || typeof payload.sub !== "string") throw new Error("missing sub");
  if (payload.banned === true) throw new Error("banned");
  return {
    id: payload.sub,
    email: typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "",
    emailVerified: payload.emailVerified === true || payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name : "",
    claims: payload,
  };
}

export async function authUser(req, optional = false) {
  const token = bearerToken(req);
  if (!token) {
    if (optional) return null;
    throw unauthorized();
  }
  try {
    return await verifyToken(token);
  } catch {
    // для публичных методов неверный/просроченный токен = гость, для остальных — 401
    if (optional) return null;
    throw unauthorized();
  }
}
