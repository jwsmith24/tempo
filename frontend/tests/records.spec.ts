import { expect, test } from "@playwright/test";

test("records empty states lead to each Stage 1 entry path", async ({ page }) => {
  await page.goto("/records");

  await expect(page.getByRole("heading", { name: "Training records." })).toBeVisible();
  await expect(page.getByText("No Planned Runs saved yet.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Planned Sessions" }).getByRole("link", { name: "Plan a run" })).toBeVisible();
  await expect(page.getByText("No Completed Activities saved yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Record an activity" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Import a FIT activity" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export my data" })).toBeVisible();
});

test("does not present load failures as empty records", async ({ page }) => {
  await page.route("**/api/planned-runs", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/records");

  await expect(page.getByRole("alert")).toContainText("Training records unavailable");
  await expect(page.getByText("No Planned Runs saved yet.")).toHaveCount(0);
  await expect(page.getByText("No Completed Activities saved yet.")).toHaveCount(0);
});

test("rediscovers saved records and follows a Link in both directions", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Local date").fill("2027-04-12");
  await page.getByLabel("Duration").fill("45");
  await page.getByRole("button", { name: /Save Planned Run/ }).click();
  await expect(page).toHaveURL(/\/planned-runs\/[a-f0-9-]+$/);
  const plannedRunUrl = page.url();

  await page.goto("/activities/new");
  await page.getByLabel("Local start").fill("2027-04-12T07:30");
  await page.getByLabel("Duration").fill("42");
  await page.getByLabel(/Title/).fill("Riverside aerobic run");
  await page.getByRole("button", { name: /Save Completed Activity/ }).click();
  await expect(page).toHaveURL(/\/activities\/[a-f0-9-]+$/);
  const activityUrl = page.url();

  await page.goto("/");
  const recordsLink = page.getByRole("link", { name: "Records" });
  await recordsLink.focus();
  await expect(recordsLink).toHaveCSS("outline-style", "solid");
  await recordsLink.press("Enter");

  const plans = page.getByRole("region", { name: "Planned Sessions" });
  await expect(plans.getByRole("link", { name: /Aerobic base.*2027-04-12.*running.*1 linked activity/ })).toBeVisible();
  const activities = page.getByRole("region", { name: "Completed Activities" });
  await expect(activities.getByRole("link", { name: /Riverside aerobic run.*Linked/ })).toBeVisible();
  await expect(activities.getByRole("link", { name: /Riverside aerobic run.*running.*2027.*Linked/ })).toBeVisible();

  await activities.getByRole("link", { name: /Riverside aerobic run/ }).press("Enter");
  await expect(page).toHaveURL(activityUrl);
  const linkedPlan = page.getByRole("link", { name: "Aerobic base on 2027-04-12" });
  await linkedPlan.focus();
  await linkedPlan.press("Enter");
  await expect(page).toHaveURL(plannedRunUrl);

  const linkedActivity = page.getByRole("link", { name: "Riverside aerobic run" });
  await linkedActivity.focus();
  await expect(linkedActivity).toHaveCSS("outline-style", "solid");
  await linkedActivity.press("Enter");
  await expect(page).toHaveURL(activityUrl);
});
