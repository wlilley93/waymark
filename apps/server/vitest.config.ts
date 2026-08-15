import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    hookTimeout: 30000,
    testTimeout: 30000,
    // one shared test database: files must not race each other's truncates
    fileParallelism: false,
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgres://waymark:waymark@127.0.0.1:5434/waymark_test",
      PHOTO_DIR: "/tmp/waymark-test-photos",
      APP_ORIGIN: "http://localhost:5173",
      LOG_EMAILS: "true",
    },
  },
});
