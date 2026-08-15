import { defineConfig } from "@playwright/test";

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
      command: "npm -w @waymark/web run build >/dev/null 2>&1; npm -w @waymark/web run preview:e2e",
      url: "http://localhost:4173",
      reuseExistingServer: true,
    },
    {
      command:
        "docker exec waymark-pg psql -U waymark -d postgres -c \"CREATE DATABASE waymark_e2e\" 2>/dev/null; docker exec waymark-pg psql -U waymark -d waymark_e2e -c \"CREATE EXTENSION IF NOT EXISTS postgis\" 2>/dev/null; DATABASE_URL=postgres://waymark:waymark@127.0.0.1:5434/waymark_e2e npm -w @waymark/server run db:migrate && DATABASE_URL=postgres://waymark:waymark@127.0.0.1:5434/waymark_e2e APP_ORIGINS=http://localhost:4173 PORT=3000 npm -w @waymark/server start",
      url: "http://localhost:3000/api/health",
      // ALWAYS a fresh server: the signup rate limiter is in-memory, and a
      // reused stale server carries a hot limiter into the run (observed 429s)
      reuseExistingServer: false,
    },
  ],
});
