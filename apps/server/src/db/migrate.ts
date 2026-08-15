import { migrate } from "drizzle-orm/postgres-js/migrator";
import { makeDb } from "./client.js";
import { loadConfig } from "../config.js";

async function main() {
  const config = loadConfig();
  const { db, sqlClient } = makeDb(config.databaseUrl);
  console.log(`migrating ${config.databaseUrl.replace(/:[^:@/]+@/, ":***@")}`);
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  await sqlClient.end();
  console.log("migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
