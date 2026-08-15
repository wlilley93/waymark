import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Negative control for the PINNED VDS BINARY ([2026] VJS-CA-VDS 1 order 3,
// VDS S-7(2)(2)): the enforcement instrument itself must fail closed on a
// seeded violation, and this test is the control that proves it — recorded in
// .vds/enforcement.lock as the released_binary seat's failing direction.
// Skipped where the vendor tree is absent (CI) or VDS_GATE_SKIP is set.
const VDS_BIN = process.env.VDS_BIN ?? "/Users/williamlilley/Projects/vibe-design-system/target/release/vds";
const skip = !VDS_BIN || process.env.VDS_GATE_SKIP === "1";

function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(VDS_BIN, args, (err, stdout, stderr) => {
      resolve({ code: (err as { code?: number } | null)?.code ?? 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

describe.skipIf(skip)("vds binary negative control", () => {
  it("vds binary fails on a seeded stored colour", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vds-ctl-"));
    try {
      const init = await run(["init", "--root", root, "--jurisdiction", "ctl", "--repo-code", "CTL"]);
      expect(init.code, init.stderr).toBe(0);
      // seed the violation: a colour literal under .vds/** is the storing form
      await writeFile(path.join(root, ".vds", "seeded-violation.yaml"), 'brand_pink: "#ebebeb"\n');
      const proof = await run(["--root", root, "proof", "no_stored_values", "--no-capture"]);
      expect(proof.code, `binary must exit non-zero on a seeded stored colour; got: ${proof.stdout}`).not.toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
