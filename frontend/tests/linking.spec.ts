import { expect, test, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

async function tabTo(page: Page, locator: Locator) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await locator.evaluate((element: Element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(locator).toBeFocused();
}

async function expectVisibleFocus(locator: Locator) {
  await expect(locator).toBeFocused();
  await expect(locator).toHaveCSS("outline-style", "solid");
}

async function expectNoHorizontalPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: Array.from(document.querySelectorAll("body *"))
      .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 10)
      .map((element) => ({
        tag: element.tagName,
        text: element.textContent?.trim().slice(0, 80),
        right: element.getBoundingClientRect().right,
      })),
  }));
  expect(overflow.offenders, JSON.stringify(overflow)).toEqual([]);
}

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
  const activityId = page.url().split("/").at(-1)!;

  await expect(page.getByRole("status")).toContainText("Matching evaluated");
  await expect(page.getByText("Linked", { exact: true })).toBeVisible();
  const evaluation = page.getByRole("region", { name: "Persisted Match Evaluation" });
  await expect(evaluation.getByText("One eligible candidate was recorded and linked automatically.")).toBeVisible();
  await expect(evaluation.getByText("This evaluation does not record a Session Outcome.")).toBeVisible();
  await expect(evaluation.getByText("stage1-date-noon-v2")).toBeVisible();
  const ownership = page.getByRole("region", { name: "Confirmed Links" });
  await expect(ownership.getByText("automatic / complete activity")).toBeVisible();
  await expect(ownership.getByText("The activity has no current Link.")).toBeVisible();
  const outcome = page.getByRole("form", { name: "Record Session Outcome" });
  await outcome.getByLabel("Session Outcome").selectOption("completed");
  await outcome.getByRole("button", { name: "Record Session Outcome" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Session Outcome recorded");
  await expect(page.getByRole("definition").filter({ hasText: "Completed" })).toBeVisible();
  await outcome.getByLabel("Session Outcome").selectOption("modified");
  await outcome.getByRole("button", { name: "Record Session Outcome" }).press("Enter");
  await expect(page.getByText("Session Outcome history: Completed; Modified")).toBeVisible();

  const checkIn = page.getByRole("form", { name: "Record Check-in" });
  await checkIn.getByRole("button", { name: "Record Check-in" }).press("Enter");
  await expect(checkIn.getByLabel("Post-session effort")).toHaveAttribute("aria-invalid", "true");
  await expect(checkIn.getByLabel("Post-session effort")).toHaveAttribute("aria-describedby", "check-in-error");
  await expect(checkIn.locator("#check-in-error")).toBeVisible();
  await checkIn.getByLabel("Post-session effort").fill("7");
  await checkIn.getByRole("button", { name: "Record Check-in" }).press("Enter");
  await expect(page.getByText("Check-in history: effort 7/10")).toBeVisible();

  await page.goto(runUrl);
  const evidence = page.getByRole("region", { name: "Confirmed Links" });
  const totals = evidence.getByRole("definition").filter({ hasText: "55 min" });
  await expect(totals.first()).toBeVisible();
  await expect(evidence.getByLabel("Complete actual totals").getByText("9 km")).toBeVisible();
  await expect(evidence.getByLabel("Complete actual totals").getByText("5 min under prescription")).toBeVisible();
  await expect(evidence.getByLabel("Complete actual totals").getByText("1 km under prescription")).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "Modified" })).toBeVisible();
  await expect(page.getByText("Session Outcome history: Completed; Modified")).toBeVisible();
  await expect(page.getByText("Check-in history: effort 7/10")).toBeVisible();

  for (const correction of [
    { field_name: "duration_seconds", replacement_value: 3000, reason: "Correct device pause" },
    { field_name: "distance_metres", replacement_value: 8000, reason: "Correct device distance" },
  ]) {
    const response = await page.request.post(`/api/activities/${activityId}/corrections`, { data: correction });
    expect(response.ok()).toBeTruthy();
  }
  await page.reload();
  const linkedActivity = evidence.getByRole("article").filter({ hasText: "Automatic whole Link" });
  await expect(linkedActivity.getByRole("definition").filter({ hasText: "55 min" })).toBeVisible();
  await expect(linkedActivity.getByRole("definition").filter({ hasText: "50 min" })).toBeVisible();
  await expect(linkedActivity.getByRole("definition").filter({ hasText: "9 km" })).toBeVisible();
  await expect(linkedActivity.getByRole("definition").filter({ hasText: "8 km" })).toBeVisible();
  await expect(linkedActivity.getByText("50 min (Corrected)")).toBeVisible();
  await expect(linkedActivity.getByText("8 km (Corrected)")).toBeVisible();
  await expect(evidence.getByLabel("Complete actual totals").getByText("50 min")).toBeVisible();
  await expect(evidence.getByLabel("Complete actual totals").getByText("8 km")).toBeVisible();
});

test("requires explicit selection for multiple candidates", async ({ page }) => {
  await createRun(page, "2026-09-24");
  await createRun(page, "2026-09-24");
  await createActivity(page, "2026-09-24", "Ambiguous whole Link");

  const candidates = page.getByRole("region", { name: "Eligible Planned Run candidates" });
  await expect(page.getByRole("region", { name: "Persisted Match Evaluation" }).getByText("2 eligible candidates were recorded for athlete selection.")).toBeVisible();
  await expect(candidates.getByText("Athlete selection required")).toBeVisible();
  await expect(candidates.getByRole("button", { name: "Confirm whole-activity Link" })).toHaveCount(2);
  const confirm = candidates.getByRole("button", { name: "Confirm whole-activity Link" }).first();
  await confirm.focus();
  await expect(confirm).toBeFocused();
  await confirm.press("Enter");

  await expect(page.getByRole("status")).toContainText("Link confirmed");
  await expect(page.getByText("athlete confirmed / complete activity")).toBeVisible();
  await expect(candidates).toHaveCount(0);
  const outcome = page.getByRole("form", { name: "Record Session Outcome" });
  await outcome.getByLabel("Session Outcome").selectOption("modified");
  await outcome.getByRole("button", { name: "Record Session Outcome" }).press("Enter");
  const checkIn = page.getByRole("form", { name: "Record Check-in" });
  await checkIn.getByLabel("Feel").fill("4");
  await checkIn.getByRole("button", { name: "Record Check-in" }).press("Enter");
  await expect(page.getByText("Session Outcome history: Modified")).toBeVisible();
  await expect(page.getByText("Check-in history: feel 4/5")).toBeVisible();
});

test("creates changes and removes a direct whole-activity Link", async ({ page }) => {
  await createRun(page, "2026-10-10");
  await createRun(page, "2026-10-12");
  await createActivity(page, "2026-10-20", "Direct whole Link");

  await expect(page.getByText(/legitimate unmatched evidence/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Persisted Match Evaluation" }).getByText("No eligible candidates were recorded; the activity was unmatched.")).toBeVisible();
  await expect(page.getByRole("form", { name: "Record Session Outcome" })).toHaveCount(0);
  const direct = page.getByRole("form", { name: "Create direct Link" });
  await direct.getByLabel("Planned Run").selectOption({ label: "Aerobic base on 2026-10-10" });
  await direct.getByRole("button", { name: "Link complete activity" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Direct Link created");
  await expect(page.getByRole("form", { name: "Record Session Outcome" })).toBeVisible();
  const outcome = page.getByRole("form", { name: "Record Session Outcome" });
  await outcome.getByLabel("Session Outcome").selectOption("completed");
  await outcome.getByRole("button", { name: "Record Session Outcome" }).press("Enter");
  const checkIn = page.getByRole("form", { name: "Record Check-in" });
  await checkIn.getByLabel("Readiness").fill("2");
  await checkIn.getByRole("button", { name: "Record Check-in" }).press("Enter");
  await expect(page.getByText("Session Outcome history: Completed")).toBeVisible();
  await expect(page.getByText("Check-in history: readiness 2/5")).toBeVisible();

  const change = page.getByRole("form", { name: "Change current Link" });
  await change.getByLabel("Move to Planned Run").selectOption({ label: "Aerobic base on 2026-10-12" });
  await change.getByRole("button", { name: "Change Link" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Link changed");
  await expect(change.locator("strong")).toHaveText("Aerobic base on 2026-10-12");
  await expect(page.getByRole("definition").filter({ hasText: "Not recorded" }).first()).toBeVisible();
  await expect(page.getByText("Session Outcome history: Completed")).toHaveCount(0);
  await expect(page.getByText("Check-in history: readiness 2/5")).toHaveCount(0);

  await change.getByRole("button", { name: "Remove Link" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Link removed");
  await expect(page.getByText("Unmatched", { exact: true })).toBeVisible();
  await expect(page.getByRole("form", { name: "Create direct Link" })).toBeVisible();
  await expect(page.getByRole("form", { name: "Record Session Outcome" })).toHaveCount(0);
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
  await expect(page.getByText("Check-in history: readiness 3/5")).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(runUrl);
  await expect(page.getByRole("definition").filter({ hasText: "Rescheduled" })).toBeVisible();
  await expect(page.getByText("Check-in history: readiness 3/5")).toBeVisible();
});

test("completes the Stage 1 journey by keyboard at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/");
  await expectNoHorizontalPageOverflow(page);

  const date = page.getByLabel("Local date");
  await tabTo(page, date);
  await page.keyboard.type("03/17/2027");
  await tabTo(page, page.getByLabel("Duration"));
  await page.keyboard.type("60");
  await tabTo(page, page.getByLabel("Distance"));
  await page.keyboard.type("10");
  const saveRun = page.getByRole("button", { name: /Save Planned Run/ });
  await tabTo(page, saveRun);
  await expectVisibleFocus(saveRun);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Saved");
  await expect(page.getByText("Active revision 1")).toBeVisible();
  await expectNoHorizontalPageOverflow(page);

  const recordActivity = page.getByRole("link", { name: "Record activity" });
  await tabTo(page, recordActivity);
  await expectVisibleFocus(recordActivity);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/activities/new");
  const localStart = page.getByLabel("Local start");
  await tabTo(page, localStart);
  await localStart.fill("2027-03-17T08:00");
  await tabTo(page, page.getByLabel("UTC offset"));
  await page.keyboard.press("Meta+A");
  await page.keyboard.type("+00:00");
  await tabTo(page, page.getByLabel("Duration"));
  await page.keyboard.type("55");
  await tabTo(page, page.getByLabel(/Distance/));
  await page.keyboard.type("9");
  await tabTo(page, page.getByLabel(/Title/));
  await page.keyboard.type("Keyboard tracer run");
  const saveActivity = page.getByRole("button", { name: /Save Completed Activity/ });
  await tabTo(page, saveActivity);
  await expectVisibleFocus(saveActivity);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("status")).toContainText("Matching evaluated");
  await expect(page.getByText("Linked", { exact: true })).toBeVisible();
  await expect(page.getByText("automatic / complete activity")).toBeVisible();
  await expect(page.getByText("This evaluation does not record a Session Outcome.")).toBeVisible();
  await expectNoHorizontalPageOverflow(page);

  const outcome = page.getByRole("form", { name: "Record Session Outcome" });
  const outcomeSelect = outcome.getByLabel("Session Outcome");
  await tabTo(page, outcomeSelect);
  await expect(outcomeSelect).toHaveAccessibleName("Session Outcome");
  await page.keyboard.press("m");
  await expect(outcomeSelect).toHaveValue("modified");
  const saveOutcome = outcome.getByRole("button", { name: "Record Session Outcome" });
  await tabTo(page, saveOutcome);
  await expectVisibleFocus(saveOutcome);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Links remain separate evidence");
  await expect(page.getByText("Session Outcome history: Modified")).toBeVisible();

  const checkIn = page.getByRole("form", { name: "Record Check-in" });
  const saveCheckIn = checkIn.getByRole("button", { name: "Record Check-in" });
  await tabTo(page, saveCheckIn);
  await page.keyboard.press("Enter");
  const effort = checkIn.getByLabel("Post-session effort");
  await expect(effort).toHaveAccessibleName(/Post-session effort/);
  await expect(effort).toHaveAttribute("aria-invalid", "true");
  await expect(effort).toHaveAttribute("aria-describedby", "check-in-error");
  await expect(checkIn.locator("#check-in-error")).toBeVisible();
  await tabTo(page, effort);
  await page.keyboard.type("7");
  await tabTo(page, saveCheckIn);
  await expectVisibleFocus(saveCheckIn);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("athlete-reported observation");
  await expect(page.getByText("Check-in history: effort 7/10")).toBeVisible();

  const correction = page.getByRole("form", { name: "Record Correction" });
  const replacement = correction.getByLabel("Replacement value");
  await tabTo(page, replacement);
  await expect(replacement).toHaveAccessibleName(/Replacement value/);
  await page.keyboard.type("3000");
  await tabTo(page, correction.getByLabel("Reason"));
  await page.keyboard.type("Correct device pause");
  const saveCorrection = correction.getByRole("button", { name: "Record Correction" });
  await tabTo(page, saveCorrection);
  await expectVisibleFocus(saveCorrection);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Original evidence remains preserved");
  await expect(page.getByLabel("Correction history")).toContainText("Replaced 3300 with 3000");

  const linkedRun = page.getByRole("link", { name: "Aerobic base on 2027-03-17" });
  await tabTo(page, linkedRun);
  await expectVisibleFocus(linkedRun);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/planned-runs\/[a-f0-9-]+$/);
  const totals = page.getByLabel("Complete actual totals");
  await expect(totals.getByText("50 min", { exact: true })).toBeVisible();
  await expect(totals.getByText("10 min under prescription")).toBeVisible();
  await expect(page.getByText("50 min (Corrected)")).toBeVisible();
  await expect(page.getByText("Session Outcome history: Modified")).toBeVisible();
  await expect(page.getByText("Check-in history: effort 7/10")).toBeVisible();
  await expectNoHorizontalPageOverflow(page);

  const exportButton = page.getByRole("button", { name: "Export Stage 1 Record" });
  await tabTo(page, exportButton);
  await expectVisibleFocus(exportButton);
  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("tempo-stage1-export.zip");
  await expect(page.getByRole("status")).toContainText("complete Stage 1 record");
});
