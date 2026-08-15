import { expect, test } from "@playwright/test";

// Map preferences (D8): styles and terrain are replaceable sources persisted
// per browser; terrain is opt-in and OFF by default.
const uniq = Date.now();

test("style switch and terrain toggle persist across reloads", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /need an account/ }).click();
  await page.getByPlaceholder("Your name").fill("Prefs");
  await page.getByPlaceholder("Email").fill(`prefs-${uniq}@e2e.local`);
  await page.getByPlaceholder(/Password/).fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByPlaceholder(/New map name/).fill("Prefs map");
  await page.getByRole("button", { name: "Create map" }).click();
  await expect(page.getByRole("button", { name: "+ Add place" })).toBeVisible({ timeout: 15000 });

  // terrain off by default
  expect(await page.evaluate(() => localStorage.getItem("waymark.terrain"))).toBeNull();

  // switch style to Positron and wait for the new style to load
  await page.getByLabel("Map style").selectOption("positron");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __map?: { isStyleLoaded: () => boolean } }).__map?.isStyleLoaded() ?? false), { timeout: 15000 })
    .toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("waymark.style"))).toBe("positron");

  // enable 3D terrain
  await page.getByRole("button", { name: "3D", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("waymark.terrain"))).toBe("on");

  // preferences survive a reload
  await page.reload();
  await page.getByRole("button", { name: /Prefs map/ }).click();
  await expect(page.getByRole("button", { name: "+ Add place" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByLabel("Map style")).toHaveValue("positron");
  expect(await page.evaluate(() => localStorage.getItem("waymark.terrain"))).toBe("on");
});
