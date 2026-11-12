import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";

await build({
  entryPoints: ["src/neon-auth-entry.js"],
  outfile: "assets/js/neon-auth.js",
  bundle: true,
  format: "iife",
  minify: true,
  platform: "browser",
  define: {
    "process.env.NEON_AUTH_BASE_URL": JSON.stringify(process.env.NEON_AUTH_BASE_URL || ""),
    "process.env.VITE_NEON_AUTH_URL": JSON.stringify(process.env.VITE_NEON_AUTH_URL || ""),
  },
});

const schema = await readFile("db/schema.sql", "utf8");
const statements = schema
  .split(/;\s*(?:\r?\n|$)/)
  .map((statement) => statement.trim())
  .filter(Boolean);
await mkdir("api/_generated", { recursive: true });
await writeFile("api/_generated/schema.js", `export const schemaStatements = ${JSON.stringify(statements, null, 2)};\n`);
