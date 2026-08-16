import { expect, test } from "@playwright/test";

// Mobile viewport acceptance ([2026] VJS-CC-WAYMARK 1 D5): at a phone size
// nothing may overflow horizontally, the topbar must hold every action, and
// every panel must dock as a bottom sheet — the layout that keeps the map
// visible and usable with one hand.

const uniq = Date.now();

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test("mobile: signup, open map, panels dock as bottom sheets", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /need an account/ }).click();
  await page.getByPlaceholder("Your name").fill("Maya");
  await page.getByPlaceholder("Email").fill(`maya-${uniq}@e2e.local`);
  await page.getByPlaceholder(/Password/).fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();

  await page.getByPlaceholder(/New map name/).fill(`Mobile map ${uniq}`);
  await page.getByRole("button", { name: "Create map" }).click();
  await expect(page.getByRole("button", { name: "+ Add place" })).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".live")).toHaveText("live", { timeout: 15000 });

  // nothing overflows the viewport at a phone width
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(1);

  // the topbar still holds every action inside the viewport
  const topbar = (await page.locator(".topbar").boundingBox())!;
  expect(topbar.width).toBeLessThanOrEqual(390);

  // Add-place sheet docks as a bottom sheet: bottom-aligned, full-width
  await page.getByRole("button", { name: "+ Add place" }).click();
  const sheet = page.locator(".add-sheet");
  await expect(sheet).toBeVisible();
  // the sheet slides up on open — wait for the transform to settle before
  // measuring geometry (boundingBox mid-animation reads a higher bottom edge)
  await page.waitForFunction(() => {
    const el = document.querySelector(".add-sheet");
    if (!el) return false;
    return el.getBoundingClientRect().bottom <= window.innerHeight;
  });
  const box = (await sheet.boundingBox())!;
  expect(box.width, "sheet width").toBeGreaterThan(390 - 32);
  expect(box.y, "sheet top edge").toBeGreaterThan(844 * 0.3);
  expect(box.y + box.height, "sheet bottom edge").toBeLessThanOrEqual(844);

  // drop a pin on the map (above the sheet), save, summary card is a sheet too
  await page.locator(".map-canvas canvas").first().click({ position: { x: 200, y: 140 } });
  await expect(page.getByText(/Pin at/)).toBeVisible({ timeout: 10000 });
  await page.getByPlaceholder("Name").fill("The Dock");
  await page.getByRole("button", { name: "Save place" }).click();
  await expect(page.getByRole("heading", { name: "The Dock" })).toBeVisible({ timeout: 10000 });

  const card = page.locator(".summary-card");
  await page.waitForFunction(() => {
    const el = document.querySelector(".summary-card");
    if (!el) return false;
    return el.getBoundingClientRect().bottom <= window.innerHeight;
  });
  const cbox = (await card.boundingBox())!;
  expect(cbox.width, "card width").toBeGreaterThan(390 - 32);
  expect(cbox.y, "card top edge").toBeGreaterThan(844 * 0.3);
  expect(cbox.y + cbox.height, "card bottom edge").toBeLessThanOrEqual(844);
});