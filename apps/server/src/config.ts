export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  photoDir: string;
  appOrigins: string[];
  logEmails: boolean;
  smtpUrl: string;
  fromEmail: string;
  sessionTtlHours: number;
  secureCookies: boolean;
}

export function loadConfig(): Config {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgres://waymark:waymark@127.0.0.1:5434/waymark";
  const appOrigins = (process.env.APP_ORIGINS ?? process.env.APP_ORIGIN ?? "http://localhost:5173,http://localhost:4173")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return {
    databaseUrl,
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? "0.0.0.0",
    photoDir: process.env.PHOTO_DIR ?? "./data/photos",
    appOrigins,
    logEmails: process.env.LOG_EMAILS !== "false",
    smtpUrl: process.env.SMTP_URL ?? "",
    fromEmail: process.env.FROM_EMAIL ?? "waymark@localhost",
    sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 24 * 14),
    secureCookies: process.env.SECURE_COOKIES === "true",
  };
}
