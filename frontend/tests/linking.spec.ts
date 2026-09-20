import { expect, test } from "@playwright/test";

async function createRun(page: import("@playwright/test").Page, day: string) {
  await page.goto("/");
  await page.getByLabel("Local date").fill(day);
  await page.getByLabel("Duration").fill("60");
  await page.getByLabel("Distance").fill("10");
  await page.getByRole("button", { name: /Save Planned Run/ }).click();
  await expect(page).toHaveURL(/\/planned-runs\/[a-f0-9-]+$/);
  return page.url();
}

async function createActivity(page: import("@playwright/test").Page, day: string, title: string) {
  await page.goto("/activities/new");
  await page.getByLabel("Local start").fill(`${day}T08:00`);
  await page.getByLabel("UTC offset").fill("+00:00");
  await page.getByLabel("Duration").fill("55");
  await page.getByLabel(/Distance/).fill("9");
  await page.getByLabel(/Title/).fill(title);
  await page.getByRole("button", { name: /Save Completed Activity/ }).click();
  await expect(page).toHaveURL(/\/activities\/[a-f0-9-]+$/);
}

test("automatically links the only eligible plan using complete evidence", async ({ page }) => {
  const runUrl = await createRun(page, "2026-09-20");
  await createActivity(page, "2026-09-20", "Automatic whole Link");

  await expect(page.getByRole("status")).toContainText("Matching evaluated");
  await expect(page.getByText("Linked", { exact: true })).toBeVisible();
  const ownership = page.getByRole("region", { name: "Confirmed Links" });
  await expect(ownership.getByText("automatic / complete activity")).toBeVisible();
  await expect(ownership.getByText("The activity has no current Link.")).toBeVisible();
  await expect(page.getByText("Session Outcome remains not recorded.")).toBeVisible();

  await page.goto(runUrl);
  const evidence = page.getByRole("region", { name: "Confirmed Links" });
  await expect(evidence.getByText("55 min")).toBeVisible();
  await expect(evidence.getByText("9 km")).toBeVisible();
  await expect(evidence.getByText("5 min under prescription")).toBeVisible();
  await expect(evidence.getByText("1 km under prescription")).toBeVisible();
});

test("requires explicit selection for multiple candidates", async ({ page }) => {
  await createRun(page, "2026-09-24");
  await createRun(page, "2026-09-24");
  await createActivity(page, "2026-09-24", "Ambiguous whole Link");

  const candidates = page.getByRole("region", { name: "Eligible Planned Run candidates" });
  await expect(candidates.getByText("Athlete selection required")).toBeVisible();
  await expect(candidates.getByRole("button", { name: "Confirm whole-activity Link" })).toHaveCount(2);
  const confirm = candidates.getByRole("button", { name: "Confirm whole-activity Link" }).first();
  await confirm.focus();
  await expect(confirm).toBeFocused();
  await confirm.press("Enter");

  await expect(page.getByRole("status")).toContainText("Link confirmed");
  await expect(page.getByText("athlete confirmed / complete activity")).toBeVisible();
  await expect(candidates).toHaveCount(0);
});

test("creates changes and removes a direct whole-activity Link", async ({ page }) => {
  await createRun(page, "2026-10-10");
  await createRun(page, "2026-10-12");
  await createActivity(page, "2026-10-20", "Direct whole Link");

  await expect(page.getByText(/legitimate unmatched evidence/)).toBeVisible();
  const direct = page.getByRole("form", { name: "Create direct Link" });
  await direct.getByLabel("Planned Run").selectOption({ label: "Aerobic base on 2026-10-10" });
  await direct.getByRole("button", { name: "Link complete activity" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Direct Link created");

  const change = page.getByRole("form", { name: "Change current Link" });
  await change.getByLabel("Move to Planned Run").selectOption({ label: "Aerobic base on 2026-10-12" });
  await change.getByRole("button", { name: "Change Link" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Link changed");
  await expect(change.locator("strong")).toHaveText("Aerobic base on 2026-10-12");

  await change.getByRole("button", { name: "Remove Link" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Link removed");
  await expect(page.getByText("Unmatched", { exact: true })).toBeVisible();
  await expect(page.getByRole("form", { name: "Create direct Link" })).toBeVisible();
});
