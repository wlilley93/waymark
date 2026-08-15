import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function makeDb(databaseUrl: string) {
  const sqlClient = postgres(databaseUrl, { max: 10 });
  const db = drizzle(sqlClient, { schema });
  return { db, sqlClient };
}
