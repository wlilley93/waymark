// drizzle-kit quotes custom type names, producing "geography(Point,4326)"
// which PostgreSQL reads as a literal type. Unquote it in generated SQL.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] ?? "drizzle");
for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
  const p = path.join(dir, f);
  const before = readFileSync(p, "utf8");
  const after = before.replaceAll('"geography(Point,4326)"', "geography(Point,4326)");
  if (after !== before) {
    writeFileSync(p, after);
    console.log(`patched ${f}`);
  }
}
