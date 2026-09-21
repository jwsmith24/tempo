import { expect, test, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

const outcomeLabelsForTest = {
  modified: "Modified",
  rescheduled: "Rescheduled",
  intentionally_skipped: "Intentionally skipped",
  unintentionally_missed: "Unintentionally missed",
  replaced: "Replaced",
} as const;

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

async function openPostRunDetails(page: Page) {
  const region = page.getByRole("region", { name: "Session Outcome and Check-in" });
  const form = region.getByRole("form", { name: "Record Session Outcome" });
  if (await form.count() === 0) await region.getByRole("button", { name: /post-run details/ }).click();
  return region;
}

async function openPostRunHistory(page: Page) {
  const region = page.getByRole("region", { name: "Session Outcome and Check-in" });
  const history = region.locator("details").filter({ hasText: "View history" });
  if (await history.getAttribute("open") === null) await history.locator("summary").click();
  return region;
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
  const linkState = page.getByLabel("Link state");
  await expect(linkState.getByRole("link", { name: "Aerobic base on 2026-09-20" })).toBeVisible();
  await expect(linkState.getByRole("button", { name: "Change or remove" })).toBeVisible();
  await expect(page.getByRole("form", { name: "Change current Link" })).toHaveCount(0);
  const evaluation = page.getByRole("group", { name: "Technical matching audit" });
  await evaluation.getByText("Technical matching audit").click();
  await expect(evaluation.getByText("One eligible candidate was recorded and linked automatically.")).toBeVisible();
  await expect(evaluation.getByText("This evaluation does not record a Session Outcome.")).toBeVisible();
  await expect(evaluation.getByText("stage1-date-noon-v2")).toBeVisible();
  const postRun = await openPostRunDetails(page);
  const outcome = postRun.getByRole("form", { name: "Record Session Outcome" });
  await outcome.getByLabel("What happened?").selectOption("completed");
  await outcome.getByRole("button", { name: "Save Outcome" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Session Outcome recorded");
  await expect(page.getByRole("definition").filter({ hasText: "Completed" })).toBeVisible();
  await outcome.getByLabel("What happened?").selectOption("modified");
  await outcome.getByRole("button", { name: "Save Outcome" }).press("Enter");
  const history = await openPostRunHistory(page);
  await expect(history.getByRole("region", { name: "Session Outcome history" }).getByRole("listitem")).toHaveCount(2);

  const checkIn = page.getByRole("form", { name: "Record Check-in" });
  await checkIn.getByRole("button", { name: "Save observations" }).press("Enter");
  await expect(checkIn.getByLabel("Whole-session perceived effort")).toHaveAttribute("aria-invalid", "true");
  await expect(checkIn.getByLabel("Whole-session perceived effort")).toHaveAttribute("aria-describedby", /check-in-error/);
  await expect(checkIn.locator("#check-in-error")).toBeVisible();
  await checkIn.getByLabel("Whole-session perceived effort").fill("7");
  await checkIn.getByRole("button", { name: "Save observations" }).press("Enter");
  const updatedHistory = await openPostRunHistory(page);
  await expect(updatedHistory.getByRole("region", { name: "Check-in history" })).toContainText("Whole-session effort 7/10");

  await page.goto(runUrl);
  const evidence = page.getByRole("region", { name: "Confirmed Links" });
  const totals = page.getByLabel("Complete actual totals");
  await expect(totals.getByText("55 min")).toBeVisible();
  await expect(totals.getByText("9 km")).toBeVisible();
  await expect(page.getByRole("figure", { name: "Duration comparison: Planned 1 hr. Actual 55 min. 5 min under prescription." })).toBeVisible();
  await expect(page.getByRole("figure", { name: "Distance comparison: Planned 10 km. Actual 9 km. 1 km under prescription." })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "Modified" })).toBeVisible();
  const runHistory = await openPostRunHistory(page);
  await expect(runHistory.getByRole("region", { name: "Session Outcome history" })).toContainText("Modified");
  await expect(runHistory.getByRole("region", { name: "Check-in history" })).toContainText("Whole-session effort 7/10");

  for (const correction of [
    { field_name: "duration_seconds", replacement_value: 3000, reason: "Correct device pause" },
    { field_name: "distance_metres", replacement_value: 8000, reason: "Correct device distance" },
  ]) {
    const response = await page.request.post(`/api/activities/${activityId}/corrections`, { data: correction });
    expect(response.ok()).toBeTruthy();
  }
  await page.reload();
  const linkedActivity = evidence.getByRole("link", { name: /Automatic whole Link/ });
  await expect(linkedActivity).toContainText("50 min");
  await expect(linkedActivity).toContainText("8 km");
  await expect(evidence).not.toContainText(/Original duration|Original distance|Corrected|Source provenance/);
  await expect(page.getByLabel("Complete actual totals").getByText("50 min")).toBeVisible();
  await expect(page.getByLabel("Complete actual totals").getByText("8 km")).toBeVisible();
});

test("requires explicit selection for multiple candidates", async ({ page }) => {
  await createRun(page, "2026-09-24");
  await createRun(page, "2026-09-24");
  await createActivity(page, "2026-09-24", "Ambiguous whole Link");

  const choose = page.getByRole("button", { name: "Choose planned run" });
  await expect(choose).toBeVisible();
  await expect(page.getByText("The activity starts within one adjacent calendar day.")).toHaveCount(0);
  const matching = page.getByRole("group", { name: "Technical matching audit" });
  await matching.getByText("Technical matching audit").click();
  await expect(matching.getByText("2 eligible candidates were recorded for athlete selection.")).toBeVisible();
  await matching.getByText("Technical matching audit").click();
  await choose.focus();
  await choose.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Choose planned run" });
  const candidates = dialog.getByRole("region", { name: "Planned Run candidates" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("This running plan is on the activity date.")).toHaveCount(2);
  await expect(dialog.getByText(/calendar day immediately before or after/)).toHaveCount(0);
  await expect(candidates.getByRole("button", { name: "Link to this run" })).toHaveCount(2);
  const confirm = candidates.getByRole("button", { name: "Link to this run" }).first();
  await confirm.focus();
  await expect(confirm).toBeFocused();
  await confirm.press("Enter");

  await expect(page.getByRole("status")).toContainText("Link confirmed");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change or remove" })).toBeFocused();
  await expect(page.getByLabel("Link state").getByRole("link", { name: "Aerobic base on 2026-09-24" })).toBeVisible();
  const postRun = await openPostRunDetails(page);
  const outcome = postRun.getByRole("form", { name: "Record Session Outcome" });
  await outcome.getByLabel("What happened?").selectOption("modified");
  await outcome.getByRole("button", { name: "Save Outcome" }).press("Enter");
  const checkIn = page.getByRole("form", { name: "Record Check-in" });
  await checkIn.getByText("Readiness and feel").click();
  await checkIn.getByLabel("How did you feel after the session?").fill("4");
  await checkIn.getByRole("button", { name: "Save observations" }).press("Enter");
  const history = await openPostRunHistory(page);
  await expect(history.getByRole("region", { name: "Session Outcome history" })).toContainText("Modified");
  await expect(history.getByRole("region", { name: "Check-in history" })).toContainText("Post-session feel 4/5");
});

test("explains adjacent-day eligibility only for the adjacent candidate", async ({ page }) => {
  await createRun(page, "2026-09-25");
  await createRun(page, "2026-09-26");
  await createActivity(page, "2026-09-26", "Adjacent candidate comparison");

  await page.getByRole("button", { name: "Choose planned run" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose planned run" });
  const sameDay = dialog.getByRole("article").filter({ hasText: "Aerobic base on 2026-09-26" });
  const adjacentDay = dialog.getByRole("article").filter({ hasText: "Aerobic base on 2026-09-25" });
  await expect(sameDay.getByText("This running plan is on the activity date.")).toBeVisible();
  await expect(sameDay.getByText(/calendar day immediately before or after/)).toHaveCount(0);
  await expect(adjacentDay.getByText(/calendar day immediately before or after/)).toBeVisible();

  const close = dialog.getByRole("button", { name: "Close Link dialog" });
  await close.press("Enter");
  await expect(page.getByRole("button", { name: "Choose planned run" })).toBeFocused();
});

test("does not offer running plans to an incompatible activity", async ({ page }) => {
  await createRun(page, "2026-09-27");
  await page.goto("/activities/new");
  await page.getByLabel("Modality").selectOption("cycling");
  await page.getByLabel("Local start").fill("2026-09-27T08:00");
  await page.getByLabel("Duration").fill("45");
  await page.getByLabel(/Title/).fill("Unplanned ride");
  await page.getByRole("button", { name: /Save Completed Activity/ }).click();

  const linkState = page.getByLabel("Link state");
  await expect(linkState).toContainText("No compatible Planned Run is available; no action is needed.");
  await expect(linkState.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("creates changes and removes a direct whole-activity Link with focus restoration", async ({ page }) => {
  await createRun(page, "2026-10-10");
  await createRun(page, "2026-10-12");
  await createActivity(page, "2026-10-20", "Direct whole Link");

  const unmatched = page.getByRole("button", { name: "Unmatched unplanned activity" });
  await expect(unmatched).toBeVisible();
  const matching = page.getByRole("group", { name: "Technical matching audit" });
  await matching.getByText("Technical matching audit").click();
  await expect(matching.getByText("No eligible candidates were recorded; the activity was unmatched.")).toBeVisible();
  await expect(page.getByRole("form", { name: "Record Session Outcome" })).toHaveCount(0);
  await unmatched.click();
  const linkDialog = page.getByRole("dialog", { name: "Link to a planned run" });
  const direct = linkDialog.getByRole("form", { name: "Create direct Link" });
  await direct.getByLabel("Planned Run").selectOption({ label: "Aerobic base on 2026-10-10" });
  await direct.getByRole("button", { name: "Link complete activity" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Direct Link created");
  await expect(page.getByRole("button", { name: "Change or remove" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Record post-run details" })).toBeVisible();
  const postRun = await openPostRunDetails(page);
  const outcome = postRun.getByRole("form", { name: "Record Session Outcome" });
  await outcome.getByLabel("What happened?").selectOption("completed");
  await outcome.getByRole("button", { name: "Save Outcome" }).press("Enter");
  const checkIn = page.getByRole("form", { name: "Record Check-in" });
  await checkIn.getByText("Readiness and feel").click();
  await checkIn.getByLabel("How ready did you feel before the session?").fill("2");
  await checkIn.getByRole("button", { name: "Save observations" }).press("Enter");
  const history = await openPostRunHistory(page);
  await expect(history.getByRole("region", { name: "Session Outcome history" })).toContainText("Completed");
  await expect(history.getByRole("region", { name: "Check-in history" })).toContainText("Before-session readiness 2/5");

  const manage = page.getByRole("button", { name: "Change or remove" });
  await manage.click();
  const change = page.getByRole("dialog", { name: "Manage Link" }).getByRole("form", { name: "Change current Link" });
  await change.getByLabel("Change to Planned Run").selectOption({ label: "Aerobic base on 2026-10-12" });
  await change.getByRole("button", { name: "Change Link" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Link changed");
  await expect(manage).toBeFocused();
  await expect(page.getByLabel("Link state")).toContainText("Aerobic base on 2026-10-12");
  await expect(page.getByRole("definition").filter({ hasText: "Not recorded" }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Session Outcome and Check-in" }).locator("details").filter({ hasText: "View history" })).toHaveCount(0);

  await manage.click();
  await page.getByRole("dialog", { name: "Manage Link" }).getByRole("button", { name: "Remove Link" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Link removed");
  await expect(page.getByRole("button", { name: "Unmatched unplanned activity" })).toBeVisible();
  await expect(page.getByRole("form", { name: "Create direct Link" })).toHaveCount(0);
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

  const resolve = page.getByRole("button", { name: "Legacy resolution required" });
  await resolve.click();
  const legacy = page.getByRole("dialog", { name: "Resolve preserved Links" }).getByRole("region", { name: "Preserved legacy Links" });
  await expect(legacy.getByText("Preserved attribution: 20 min / 3 km")).toBeVisible();
  await expect(legacy.getByText("Preserved attribution: 30 min / 4 km")).toBeVisible();
  await legacy.getByRole("article").filter({ hasText: "Aerobic base on 2026-11-02" }).getByRole("button", { name: "Use this Planned Run" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Preserved relationships remain in history");
  await expect(page.getByRole("button", { name: "Change or remove" })).toBeFocused();
  await expect(page.getByLabel("Link state")).toContainText("Aerobic base on 2026-11-02");
  await page.reload();
  await expect(page.getByLabel("Link state")).toContainText("Aerobic base on 2026-11-02");
});

test("records append-only Session Outcome and Check-in without a Link", async ({ page }) => {
  const runUrl = await createRun(page, "2026-12-01");

  const postRun = await openPostRunDetails(page);
  const outcome = postRun.getByRole("form", { name: "Record Session Outcome" });
  await outcome.getByLabel("What happened?").selectOption("rescheduled");
  await outcome.getByRole("button", { name: "Save Outcome" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Session Outcome recorded");
  await expect(page.getByRole("definition").filter({ hasText: "Rescheduled" })).toBeVisible();

  const checkIn = page.getByRole("form", { name: "Record Check-in" });
  await checkIn.getByLabel(/Notes/).fill("Travel made the planned time unavailable.");
  await checkIn.getByRole("button", { name: "Save observations" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Check-in recorded");
  await expect(page.getByLabel("Current post-run summary")).toContainText("Travel made the planned time unavailable.");

  await page.reload();
  await expect(page).toHaveURL(runUrl);
  await expect(page.getByRole("definition").filter({ hasText: "Rescheduled" })).toBeVisible();
  const history = await openPostRunHistory(page);
  await expect(history.getByRole("region", { name: "Check-in history" })).toContainText("Travel made the planned time unavailable.");
});

test("requests a reason only for deviations and explains optional rating boundaries", async ({ page }) => {
  await createRun(page, "2027-01-10");
  const postRun = await openPostRunDetails(page);
  const outcome = postRun.getByRole("form", { name: "Record Session Outcome" });
  const disposition = outcome.getByLabel("What happened?");

  await expect(disposition).toHaveValue("completed");
  await expect(outcome.getByLabel("Reason for the deviation")).toHaveCount(0);
  for (const value of ["modified", "rescheduled", "intentionally_skipped", "unintentionally_missed", "replaced"] as const) {
    await disposition.selectOption(value);
    const reason = outcome.getByLabel("Reason for the deviation");
    await expect(reason).toBeVisible();
    await expect(reason).toHaveAttribute("placeholder", "What changed or prevented the planned session?");
    await reason.fill(`Context for ${value}.`);
    await outcome.getByRole("button", { name: "Save Outcome" }).click();
    await expect(postRun.getByLabel("Current post-run summary")).toContainText(outcomeLabelsForTest[value]);
  }
  await disposition.selectOption("completed");
  await expect(outcome.getByLabel("Reason for the deviation")).toHaveCount(0);

  const checkIn = postRun.getByRole("form", { name: "Record Check-in" });
  const effort = checkIn.getByLabel("Whole-session perceived effort");
  await expect(effort).toHaveAttribute("min", "1");
  await expect(effort).toHaveAttribute("max", "10");
  await expect(checkIn.getByText("1 = very easy; 10 = maximum effort for the session as a whole.")).toBeVisible();
  await checkIn.getByText("Readiness and feel").press("Enter");
  const readiness = checkIn.getByLabel("How ready did you feel before the session?");
  const feel = checkIn.getByLabel("How did you feel after the session?");
  await expect(readiness).toHaveAttribute("min", "1");
  await expect(readiness).toHaveAttribute("max", "5");
  await expect(feel).toHaveAttribute("min", "1");
  await expect(feel).toHaveAttribute("max", "5");
  await expect(checkIn.getByText("1 = not ready; 5 = fully ready.")).toBeVisible();
  await expect(checkIn.getByText("1 = very poor; 5 = very good.")).toBeVisible();
  await effort.fill("1");
  await readiness.fill("1");
  await feel.fill("5");
  await checkIn.getByRole("button", { name: "Save observations" }).click();
  await expect(postRun.getByLabel("Current post-run summary")).toContainText("Whole-session effort 1/10");
  await effort.fill("10");
  await readiness.fill("5");
  await feel.fill("1");
  await checkIn.getByRole("button", { name: "Save observations" }).click();
  await expect(postRun.getByLabel("Current post-run summary")).toContainText("Whole-session effort 10/10");
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
  await expect(page.getByRole("article", { name: "Planned Run review" })).toBeVisible();
  await expectNoHorizontalPageOverflow(page);

  const recordActivity = page.getByRole("link", { name: "Record activity" });
  await tabTo(page, recordActivity);
  await expectVisibleFocus(recordActivity);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/activities/new");
  const localStart = page.getByLabel("Local start");
  await tabTo(page, localStart);
  await localStart.fill("2027-03-17T08:00");
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
  await expect(page.getByLabel("Link state").getByRole("link", { name: "Aerobic base on 2027-03-17" })).toBeVisible();
  await page.getByRole("group", { name: "Technical matching audit" }).getByText("Technical matching audit").click();
  await expect(page.getByText("This evaluation does not record a Session Outcome.")).toBeVisible();
  await expectNoHorizontalPageOverflow(page);

  const postRun = await openPostRunDetails(page);
  const outcome = postRun.getByRole("form", { name: "Record Session Outcome" });
  const outcomeSelect = outcome.getByLabel("What happened?");
  await tabTo(page, outcomeSelect);
  await expect(outcomeSelect).toHaveAccessibleName("What happened?");
  await page.keyboard.press("m");
  await expect(outcomeSelect).toHaveValue("modified");
  const saveOutcome = outcome.getByRole("button", { name: "Save Outcome" });
  await tabTo(page, saveOutcome);
  await expectVisibleFocus(saveOutcome);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Links remain separate evidence");
  await expect(page.getByLabel("Current post-run summary")).toContainText("Modified");

  const checkIn = page.getByRole("form", { name: "Record Check-in" });
  const saveCheckIn = checkIn.getByRole("button", { name: "Save observations" });
  await tabTo(page, saveCheckIn);
  await page.keyboard.press("Enter");
  const effort = checkIn.getByLabel("Whole-session perceived effort");
  await expect(effort).toHaveAccessibleName(/Whole-session perceived effort/);
  await expect(effort).toHaveAttribute("aria-invalid", "true");
  await expect(effort).toHaveAttribute("aria-describedby", /check-in-error/);
  await expect(checkIn.locator("#check-in-error")).toBeVisible();
  await tabTo(page, effort);
  await page.keyboard.type("7");
  await tabTo(page, saveCheckIn);
  await expectVisibleFocus(saveCheckIn);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("athlete-reported observation");
  await expect(page.getByLabel("Current post-run summary")).toContainText("Whole-session effort 7/10");

  const editButton = page.getByRole("button", { name: "Edit activity" });
  await tabTo(page, editButton);
  await page.keyboard.press("Enter");
  const correction = page.getByRole("form", { name: "Edit activity" });
  const replacement = correction.getByLabel("Duration");
  await tabTo(page, replacement);
  await expect(replacement).toHaveAccessibleName(/Duration/);
  await replacement.fill("50");
  await tabTo(page, correction.getByLabel("Reason for changes"));
  await page.keyboard.type("Correct device pause");
  const saveCorrection = correction.getByRole("button", { name: "Save changes" });
  await tabTo(page, saveCorrection);
  await expectVisibleFocus(saveCorrection);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Source values and prior changes remain preserved");
  await page.getByText("View changes").click();
  await expect(page.getByLabel("Correction history")).toContainText("55 min → 50 min");

  const linkedRun = page.getByRole("link", { name: "Aerobic base on 2027-03-17" });
  await tabTo(page, linkedRun);
  await expectVisibleFocus(linkedRun);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/planned-runs\/[a-f0-9-]+$/);
  const totals = page.getByLabel("Complete actual totals");
  await expect(totals.getByText("50 min", { exact: true })).toBeVisible();
  await expect(page.getByRole("figure", { name: "Duration comparison: Planned 1 hr. Actual 50 min. 10 min under prescription." })).toBeVisible();
  await expect(page.getByRole("link", { name: /Keyboard tracer run/ })).toContainText("50 min");
  const history = await openPostRunHistory(page);
  await expect(history.getByRole("region", { name: "Session Outcome history" })).toContainText("Modified");
  await expect(history.getByRole("region", { name: "Check-in history" })).toContainText("Whole-session effort 7/10");
  await expectNoHorizontalPageOverflow(page);

  await page.getByRole("link", { name: "Records" }).click();
  await expectNoHorizontalPageOverflow(page);
  const exportButton = page.getByRole("button", { name: "Export my data" });
  await tabTo(page, exportButton);
  await expectVisibleFocus(exportButton);
  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("tempo-stage1-export.zip");
  await expect(page.getByRole("status")).toContainText("complete Stage 1 record");
});
