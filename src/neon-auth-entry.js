import { createAuthClient } from "@neondatabase/neon-js/auth";
import { SupabaseAuthAdapter } from "@neondatabase/neon-js/auth/vanilla/adapters";

const url = process.env.NEON_AUTH_BASE_URL || process.env.VITE_NEON_AUTH_URL || "";

if (url) {
  window.NeonAuth = createAuthClient(url, { adapter: SupabaseAuthAdapter() });
  window.NeonAuthUrl = url;
}
