import { describe, it, expect, vi } from "vitest";
import { makeMailer } from "../src/services/mailer.js";

describe("mailer postures", () => {
  it("log posture logs instead of sending", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const m = makeMailer({ logEmails: true });
    expect(m.mode).toBe("log");
    await m.send("a@b.c", "subj", "body");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("a@b.c"));
    spy.mockRestore();
  });

  it("log posture is silent when disabled", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const m = makeMailer({ logEmails: false });
    await m.send("a@b.c", "subj", "body");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("smtp posture renders through the transport (jsonTransport seam)", async () => {
    const m = makeMailer({ jsonTransport: true, fromEmail: "waymark@test" });
    expect(m.mode).toBe("smtp");
    // jsonTransport resolves instead of connecting; a malformed URL would throw here
    await m.send("friend@example.com", "Reset your Waymark password", "token: x");
  });
});
