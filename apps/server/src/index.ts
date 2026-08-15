import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { mkdir } from "node:fs/promises";

async function main() {
  const config = loadConfig();
  await mkdir(config.photoDir, { recursive: true });
  const { app, db, sqlClient } = await buildApp();
  if (process.env.AUTO_MIGRATE !== "false") {
    await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  }
  await app.listen({ port: config.port, host: config.host });
  console.log(`waymark server on ${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
