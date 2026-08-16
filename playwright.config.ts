import { defineConfig } from "@playwright/test";

// The e2e API server binds PORT, defaulting to 3000. On hosts where 3000 is a
// live system service (beelink's intranet), run with PORT=3010 and
// API_TARGET=http://127.0.0.1:3010.
const port = process.env.PORT ?? "3000";
const apiTarget = process.env.API_TARGET ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: [
    {
      command: `API_TARGET=${apiTarget} npm -w @waymark/web run build >/dev/null 2>&1; API_TARGET=${apiTarget} npm -w @waymark/web run preview:e2e`,
      url: "http://localhost:4173",
      // ALWAYS fresh: a reused preview serves the build it started with, so
      // code changes never reach the run (observed: new UI absent, old bundle)
      reuseExistingServer: false,
    },
    {
      command:
        `D=$(docker ps -q --filter name=waymark-pg | head -1); [ -n "$D" ] || D=$(docker ps -q --filter ancestor=postgis/postgis:16-3.4 | head -1); docker exec $D psql -U waymark -d postgres -c "CREATE DATABASE waymark_e2e" 2>/dev/null; docker exec $D psql -U waymark -d waymark_e2e -c "CREATE EXTENSION IF NOT EXISTS postgis" 2>/dev/null; DATABASE_URL=postgres://waymark:waymark@127.0.0.1:5434/waymark_e2e npm -w @waymark/server run db:migrate && DATABASE_URL=postgres://waymark:waymark@127.0.0.1:5434/waymark_e2e APP_ORIGINS=http://localhost:4173 PORT=${port} npm -w @waymark/server start`,
      url: `http://localhost:${port}/api/health`,
      // ALWAYS a fresh server: the signup rate limiter is in-memory, and a
      // reused stale server carries a hot limiter into the run (observed 429s)
      reuseExistingServer: false,
    },
  ],
});
