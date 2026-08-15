import nodemailer from "nodemailer";

// Mail delivery ([2026] VJS-CC-WAYMARK 1 D8): two postures, one artifact.
// SMTP_URL set → transactional email through the configured transport
// (SMTPS/STARTTLS URL, e.g. smtps://user:pass@smtp.example.com). Unset →
// dev posture: the message is logged by the server and nothing leaves host.

export interface Mailer {
  send: (to: string, subject: string, body: string) => Promise<void>;
  readonly mode: "smtp" | "log";
}

export function makeMailer(opts: {
  smtpUrl?: string;
  fromEmail?: string;
  logEmails?: boolean;
  jsonTransport?: boolean;
}): Mailer {
  const from = opts.fromEmail ?? "waymark@localhost";
  if (opts.jsonTransport) {
    // test seam: captures the rendered message instead of sending
    const transport = nodemailer.createTransport({ jsonTransport: true });
    return {
      mode: "smtp",
      async send(to, subject, body) {
        await transport.sendMail({ from, to, subject, text: body });
      },
    };
  }
  if (opts.smtpUrl) {
    const transport = nodemailer.createTransport(opts.smtpUrl);
    return {
      mode: "smtp",
      async send(to, subject, body) {
        await transport.sendMail({ from, to, subject, text: body });
      },
    };
  }
  const log = opts.logEmails !== false;
  return {
    mode: "log",
    async send(to, subject, body) {
      if (log) console.log(`[email:stub] to=${to} subject="${subject}"\n${body}`);
    },
  };
}
