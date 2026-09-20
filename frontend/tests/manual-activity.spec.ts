import { expect, test, type Locator, type Page } from "@playwright/test";

async function tabTo(page: Page, locator: Locator) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await locator.evaluate((element: Element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(locator).toBeFocused();
}

test("records and revisits unmatched manual training evidence", async ({ page }) => {
  await page.goto("/activities/new");
  await expect(page.getByRole("heading", { name: "Record what happened." })).toBeVisible();

  await tabTo(page, page.getByLabel("Modality"));
  await page.keyboard.press("ArrowDown");
  await tabTo(page, page.getByLabel("Local start"));
  await page.getByLabel("Local start").fill("2026-09-20T06:30");
  await tabTo(page, page.getByLabel("UTC offset"));
  await page.keyboard.press("Meta+A");
  await page.keyboard.type("+05:30");
  await tabTo(page, page.getByLabel("Duration"));
  await page.keyboard.type("45.25");
  await tabTo(page, page.getByLabel(/Distance/));
  await page.keyboard.type("7.421");
  await tabTo(page, page.getByLabel(/Title/));
  await page.keyboard.type("Morning progression");
  await tabTo(page, page.getByLabel(/Notes/));
  await page.keyboard.type("Finished relaxed.");
  await tabTo(page, page.getByRole("button", { name: /Save Completed Activity/ }));
  await expect(page.getByRole("button", { name: /Save Completed Activity/ })).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("status")).toContainText("Matching evaluated");
  await expect(page.getByText("Unmatched", { exact: true })).toBeVisible();
  await expect(page.getByText("Source: manual / Created by athlete entry")).toBeVisible();
  await expect(page.getByText("2026-09-20T06:30:00+05:30")).toBeVisible();
  await expect(page).toHaveURL(/\/activities\/[a-f0-9-]+$/);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Completed Activity" })).toBeVisible();
  await expect(page.getByText("Morning progression")).toBeVisible();
  await expect(page.getByText("Unmatched", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Activities", exact: true }).click();
  const activityRow = page.getByRole("link", { name: /Morning progression/ });
  await expect(activityRow).toBeVisible();
  await expect(activityRow.getByText("Unmatched", { exact: true })).toBeVisible();
});

test("associates invalid manual activity errors with fields", async ({ page }) => {
  await page.goto("/activities/new");
  await page.getByLabel("Local start").fill("2026-09-20T06:30");
  await page.getByLabel("UTC offset").fill("+00:00");
  await page.getByLabel("Duration").fill("-2");
  await page.getByRole("button", { name: /Save Completed Activity/ }).click();

  await expect(page.getByRole("status")).toContainText("not saved");
  await expect(page.getByLabel("Duration")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#activity-duration-error")).toBeVisible();
});

test("rejects zero distance and malformed UTC offset without saving", async ({ page }) => {
  await page.goto("/activities/new");
  await page.getByLabel("Local start").fill("2026-09-20T06:30");
  await page.getByLabel("UTC offset").fill("UTC");
  await page.getByLabel("Duration").fill("20");
  await page.getByLabel(/Distance/).fill("0");
  await page.getByRole("button", { name: /Save Completed Activity/ }).click();

  await expect(page.getByLabel("UTC offset")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#offset-error")).toContainText("UTC offset");

  await page.getByLabel("UTC offset").fill("+00:00");
  await page.getByRole("button", { name: /Save Completed Activity/ }).click();
  await expect(page.getByLabel(/Distance/)).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#activity-distance-error")).toBeVisible();
  await expect(page).toHaveURL("/activities/new");
});
