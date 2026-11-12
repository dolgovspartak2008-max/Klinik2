import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

// db/schema.sql -> api/_generated/schema.js (для защищённого /api/setup)
const schema = await readFile("db/schema.sql", "utf8");
const statements = schema
  .split(/;\s*(?:\r?\n|$)/)
  .map((statement) => statement.trim())
  .filter(Boolean);
await mkdir("api/_generated", { recursive: true });
await writeFile("api/_generated/schema.js", `export const schemaStatements = ${JSON.stringify(statements, null, 2)};\n`);

// статический сайт -> public
await rm("public", { recursive: true, force: true });
await mkdir("public", { recursive: true });
for (const directory of ["admin", "assets", "kabinet", "kursy"]) {
  await cp(directory, `public/${directory}`, { recursive: true });
}
for (const file of ["404.html", "apple-touch-icon.png", "favicon.ico", "icon-192.png", "icon-512.png", "index.html", "politika.html", "robots.txt", "site.webmanifest", "sitemap.xml"]) {
  await cp(file, `public/${file}`);
}
