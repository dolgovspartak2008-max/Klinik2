import { db } from "./_lib/db.js";
import { json, method, fail } from "./_lib/http.js";
import { schemaStatements } from "./_generated/schema.js";

export default async function handler(req, res) {
  if (!method(req, res)) return;
  try {
    const sql = db();
    for (const statement of schemaStatements) await sql.query(statement);
    json(res, 200, { ok: true, statements: schemaStatements.length });
  } catch (error) {
    fail(res, error);
  }
}
