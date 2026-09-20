import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

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
  const totals = evidence.getByRole("definition").filter({ hasText: "55 min" });
  await expect(totals.first()).toBeVisible();
  await expect(evidence.getByLabel("Complete actual totals").getByText("9 km")).toBeVisible();
  await expect(evidence.getByLabel("Complete actual totals").getByText("5 min under prescription")).toBeVisible();
  await expect(evidence.getByLabel("Complete actual totals").getByText("1 km under prescription")).toBeVisible();
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

test("resolves preserved legacy Links without hiding their history", async ({ page }) => {
  const firstUrl = await createRun(page, "2026-11-01");
  const firstId = firstUrl.split("/").at(-1)!;
  const secondUrl = await createRun(page, "2026-11-02");
  const secondId = secondUrl.split("/").at(-1)!;
  await createActivity(page, "2026-11-20", "Legacy combined recording");
  const activityId = page.url().split("/").at(-1)!;
  const database = process.env.TEMPO_PLAYWRIGHT_DATABASE_PATH!;
  execFileSync("../.venv/bin/python", ["-c", `
import sqlite3, uuid
db, activity, first, second = ${JSON.stringify(database)}, ${JSON.stringify(activityId)}, ${JSON.stringify(firstId)}, ${JSON.stringify(secondId)}
with sqlite3.connect(db) as connection:
    resolution = str(uuid.uuid4())
    connection.execute("INSERT INTO legacy_link_resolutions (id, completed_activity_id, status) VALUES (?, ?, 'unresolved')", (resolution, activity))
    for plan, duration, distance in ((first, 1200, 3000), (second, 1800, 4000)):
        connection.execute("INSERT INTO legacy_link_records VALUES (?, ?, ?, ?, ?, ?, 'direct', 1, '2026-09-20T01:00:00Z')", (str(uuid.uuid4()), resolution, plan, activity, duration, distance))
`]);
  await page.reload();

  const legacy = page.getByRole("region", { name: "Unresolved legacy Links" });
  await expect(page.getByText("Legacy Links need resolution", { exact: true })).toBeVisible();
  await expect(legacy.getByText("Preserved: 20 min / 3 km")).toBeVisible();
  await expect(legacy.getByText("Preserved: 30 min / 4 km")).toBeVisible();
  await legacy.getByText("Aerobic base on 2026-11-02").locator("..").getByRole("button", { name: "Use this Planned Run" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Preserved relationships remain in history");
  await expect(page.getByRole("form", { name: "Change current Link" }).locator("strong")).toHaveText("Aerobic base on 2026-11-02");
  await page.reload();
  await expect(page.getByText("Linked", { exact: true })).toBeVisible();
});

test("records append-only Session Outcome and Check-in without a Link", async ({ page }) => {
  const runUrl = await createRun(page, "2026-12-01");

  const outcome = page.getByRole("form", { name: "Record Session Outcome" });
  await outcome.getByLabel("Session Outcome").selectOption("rescheduled");
  await outcome.getByRole("button", { name: "Record Session Outcome" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Session Outcome recorded");
  await expect(page.getByRole("definition").filter({ hasText: "Rescheduled" })).toBeVisible();

  const checkIn = page.getByRole("form", { name: "Record Check-in" });
  await checkIn.getByLabel("Readiness").fill("3");
  await checkIn.getByRole("button", { name: "Record Check-in" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Check-in recorded");
  await expect(page.getByText("Check-in history: 1 record.")).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(runUrl);
  await expect(page.getByRole("definition").filter({ hasText: "Rescheduled" })).toBeVisible();
  await expect(page.getByText("Check-in history: 1 record.")).toBeVisible();
});
