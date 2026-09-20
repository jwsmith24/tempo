import { expect, test, type Locator, type Page } from "@playwright/test";

async function tabTo(page: Page, locator: Locator) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await locator.evaluate((element: Element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(locator).toBeFocused();
}

test("creates and revisits a Planned Run with keyboard controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set the intention." })).toBeVisible();

  await tabTo(page, page.getByLabel("Local date"));
  await page.keyboard.type("09/21/2026");
  await tabTo(page, page.getByLabel("Training intent"));
  await page.keyboard.press("ArrowDown");
  await tabTo(page, page.getByLabel("Priority"));
  await page.keyboard.press("ArrowDown");
  await tabTo(page, page.getByLabel("Duration"));
  await page.keyboard.type("50");
  await tabTo(page, page.getByLabel("Distance"));
  await page.keyboard.type("10");
  await tabTo(page, page.getByLabel(/Notes/));
  await page.keyboard.type("Hold a controlled effort.");
  await tabTo(page, page.getByRole("button", { name: /Save Planned Run/ }));
  await expect(page.getByRole("button", { name: /Save Planned Run/ })).toBeFocused();
  await expect(page.getByRole("button", { name: /Save Planned Run/ })).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("status")).toContainText("Saved");
  await expect(page.getByText("Active revision 1")).toBeVisible();
  await expect(page.getByText("50 min")).toBeVisible();
  await expect(page.getByText("10000 m (10 km)")).toBeVisible();
  await expect(page).toHaveURL(/\/planned-runs\/[a-f0-9-]+$/);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Planned Run" })).toBeVisible();
  await expect(page.getByText("Hold a controlled effort.")).toBeVisible();
  await expect(page.getByText("Active revision 1")).toBeVisible();
});

test("associates an actionable prescription error", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Local date").fill("2026-09-21");
  await page.getByRole("button", { name: /Save Planned Run/ }).click();

  await expect(page.getByRole("status")).toContainText("not saved");
  await expect(page.locator("fieldset")).toHaveAttribute("aria-describedby", "prescription-error");
  await expect(page.getByText("Enter a duration, distance, or both.")).toBeVisible();
});
