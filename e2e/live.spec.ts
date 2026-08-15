import { expect, test } from "@playwright/test";

// The acceptance journey ([2026] VJS-CC-WAYMARK 1 D5, M5):
// signup → create map → invite → second user joins → first user adds a place
// → the second user SEES IT LIVE without reloading.

const uniq = Date.now();

test("two users, one live map", async ({ browser }) => {
  const aliceCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();

  // Alice signs up
  await alice.goto("/");
  await alice.getByRole("button", { name: /need an account/ }).click();
  await alice.getByPlaceholder("Your name").fill("Alice");
  await alice.getByPlaceholder("Email").fill(`alice-${uniq}@e2e.local`);
  await alice.getByPlaceholder(/Password/).fill("correct-horse-battery");
  await alice.getByRole("button", { name: "Create account" }).click();

  // Alice creates a map
  await alice.getByPlaceholder(/New map name/).fill(`E2E map ${uniq}`);
  await alice.getByRole("button", { name: "Create map" }).click();

  // Map screen: add-place button present, live badge eventually 'live'
  await expect(alice.getByRole("button", { name: "+ Add place" })).toBeVisible({ timeout: 15000 });
  await expect(alice.locator(".live")).toHaveText("live", { timeout: 15000 });

  // Alice creates an invite link (via the API from her authenticated page)
  const inviteUrl = await alice.evaluate(async () => {
    const maps = await fetch("/api/maps").then((r) => r.json());
    const mapId = maps[0]?.id as string;
    const invite = await fetch(`/api/maps/${mapId}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "editor" }),
    }).then((r) => r.json());
    return invite.url as string;
  });
  expect(inviteUrl).toContain("/join/");

  // Bob joins via the invite link in a fresh context
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await bob.goto("/");
  await bob.getByRole("button", { name: /need an account/ }).click();
  await bob.getByPlaceholder("Your name").fill("Bob");
  await bob.getByPlaceholder("Email").fill(`bob-${uniq}@e2e.local`);
  await bob.getByPlaceholder(/Password/).fill("correct-horse-battery");
  await bob.getByRole("button", { name: "Create account" }).click();
  await bob.goto(inviteUrl);
  await expect(bob.getByRole("button", { name: "+ Add place" })).toBeVisible({ timeout: 15000 });
  await expect(bob.locator(".live")).toHaveText("live", { timeout: 15000 });

  // Alice adds a place by dropping a pin
  await alice.getByRole("button", { name: "+ Add place" }).click();
  await alice.getByPlaceholder("Name").fill("The Reliance");
  // click the map to drop the pin, and wait for the sheet to acknowledge it
  const canvas = alice.locator(".map-canvas canvas").first();
  await canvas.click({ position: { x: 300, y: 250 } });
  await expect(alice.getByText(/Pin at/)).toBeVisible({ timeout: 10000 });
  await alice.getByRole("button", { name: "Save place" }).click();
  await expect(alice.getByRole("heading", { name: "The Reliance" })).toBeVisible({ timeout: 10000 });

  // Bob sees the place appear LIVE (no reload): wait until his map actually
  // HOLDS the feature (style loaded + places source non-empty), then click it.
  // Clicking blind coordinates races the live delivery and style load.
  await bob.waitForFunction(
    () => {
      const m = (window as unknown as { __map?: { isStyleLoaded(): boolean; getSource(id: string): { serialize(): { data?: { features?: unknown[] } } } | undefined } }).__map;
      if (!m || !m.isStyleLoaded()) return false;
      const src = m.getSource("places");
      if (!src) return false;
      return (src.serialize().data?.features?.length ?? 0) >= 1;
    },
    { timeout: 15000 },
  );
  const bobCanvas = bob.locator(".map-canvas canvas").first();
  await bobCanvas.click({ position: { x: 300, y: 250 } });
  await expect(bob.getByRole("heading", { name: "The Reliance" })).toBeVisible({ timeout: 10000 });

  await aliceCtx.close();
  await bobCtx.close();
});
