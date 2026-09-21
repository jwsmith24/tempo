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
  await page.getByLabel("Local start").fill("2027-09-20T06:30");
  await page.getByText("Advanced: use a different UTC offset").press("Enter");
  await page.getByLabel("UTC offset override").check();
  await tabTo(page, page.getByRole("textbox", { name: /^UTC offset/ }));
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
  await expect(page.getByLabel("Link state")).toContainText("Unmatched unplanned activity");
  await expect(page.getByRole("article", { name: "Activity summary" }).getByText("Manual entry", { exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Activity summary" })).toContainText("9/19/2027, 8:00:00 PM");
  await expect(page).toHaveURL(/\/activities\/[a-f0-9-]+$/);
  await expect(page.getByRole("status")).toBeEmpty({ timeout: 6_000 });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Completed Activity" })).toBeVisible();
  await expect(page.getByText("Morning progression").first()).toBeVisible();
  await expect(page.getByLabel("Link state")).toContainText("Unmatched unplanned activity");

  await page.getByRole("link", { name: "Records", exact: true }).click();
  const activityRow = page.getByRole("link", { name: /Morning progression/ });
  await expect(activityRow).toBeVisible();
  await expect(activityRow.getByText("Unmatched", { exact: true })).toBeVisible();
});

test.describe("browser-local activity entry", () => {
  test.use({ timezoneId: "America/New_York" });

  test("defaults local time and derives DST offset for the selected instant", async ({ page }) => {
    await page.goto("/activities/new");
    const localStart = page.getByLabel("Local start");
    await expect(localStart).not.toHaveValue("");
    await expect(page.getByLabel("UTC offset", { exact: true })).toHaveCount(0);

    await localStart.fill("2027-01-15T08:00");
    await expect(page.getByText("Timezone detected for this local time: UTC-05:00")).toBeVisible();
    await expect(page.locator('input[type="hidden"][name="utc_offset"]')).toHaveValue("-05:00");

    await localStart.fill("2027-07-15T08:00");
    await expect(page.getByText("Timezone detected for this local time: UTC-04:00")).toBeVisible();
    await expect(page.locator('input[type="hidden"][name="utc_offset"]')).toHaveValue("-04:00");
  });

  test("converts familiar units to the canonical generated API contract", async ({ page }) => {
    let requestBody: Record<string, unknown> | undefined;
    await page.route("**/api/activities", async (route) => {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.abort();
    });
    await page.goto("/activities/new");
    await page.getByLabel("Local start").fill("2027-07-15T08:00");
    await page.getByLabel("Duration").fill("45.25");
    await page.getByLabel(/Distance/).fill("7.421");
    await page.getByRole("button", { name: /Save Completed Activity/ }).click();

    expect(requestBody).toMatchObject({
      start_instant: "2027-07-15T08:00:00-04:00",
      duration_seconds: 2715,
      distance_metres: 7421,
    });
  });
});

test("entry remains usable at a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/activities/new");
  await expect(page.getByLabel("Local start")).toBeVisible();
  await expect(page.getByLabel("Duration")).toBeVisible();
  await expect(page.getByRole("button", { name: /Save Completed Activity/ })).toBeVisible();
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(documentWidth).toBeLessThanOrEqual(360);
});

test("renders omitted manual activity distance intentionally", async ({ page }) => {
  const run = await page.request.post("/api/planned-runs", {
    data: {
      scheduled_date: "2027-10-20",
      training_intent: "aerobic_base",
      priority: "normal",
      duration_seconds: 1800,
      distance_metres: 5000,
    },
  });
  expect(run.ok()).toBeTruthy();

  await page.goto("/activities/new");
  await page.getByLabel("Local start").fill("2027-10-20T06:30");
  await page.getByLabel("Duration").fill("30");
  await page.getByLabel(/Title/).fill("Duration only run");
  await page.getByRole("button", { name: /Save Completed Activity/ }).click();

  await expect(page.getByRole("heading", { name: "Completed Activity" })).toBeVisible();
  await expect(page.getByText("Not recorded", { exact: true }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/undefined|NaN/);

  await page.getByLabel("Link state").getByRole("link", { name: "Aerobic base on 2027-10-20" }).click();
  const totals = page.getByLabel("Complete actual totals");
  await expect(totals.getByText("Not comparable", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Distance comparison")).toContainText("Not comparable");
  await expect(page.locator("body")).not.toContainText(/undefined|NaN/);

  await page.goBack();
  await expect(page.getByText("Duration only run").first()).toBeVisible();
  await expect(page.getByText("Not recorded", { exact: true }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/undefined|NaN/);
});

test("associates invalid manual activity errors with fields", async ({ page }) => {
  await page.goto("/activities/new");
  await page.getByLabel("Local start").fill("2026-09-20T06:30");
  await page.getByLabel("Duration").fill("-2");
  await page.getByRole("button", { name: /Save Completed Activity/ }).click();

  await expect(page.getByRole("status")).toContainText("not saved");
  await expect(page.getByLabel("Duration")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#activity-duration-error")).toBeVisible();
});

test("rejects zero distance and malformed UTC offset without saving", async ({ page }) => {
  await page.goto("/activities/new");
  await page.getByLabel("Local start").fill("2026-09-20T06:30");
  await page.getByText("Advanced: use a different UTC offset").click();
  await page.getByLabel("UTC offset override").check();
  await page.getByRole("textbox", { name: /^UTC offset/ }).fill("UTC");
  await page.getByLabel("Duration").fill("20");
  await page.getByLabel(/Distance/).fill("0");
  await page.getByRole("button", { name: /Save Completed Activity/ }).click();

  await expect(page.getByRole("textbox", { name: /^UTC offset/ })).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#offset-error")).toContainText("UTC offset");

  await page.getByRole("textbox", { name: /^UTC offset/ }).fill("+00:00");
  await page.getByRole("button", { name: /Save Completed Activity/ }).click();
  await expect(page.getByLabel(/Distance/)).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#activity-distance-error")).toBeVisible();
  await expect(page).toHaveURL("/activities/new");
});

test("appends Corrections while preserving original activity evidence", async ({ page }) => {
  await page.goto("/activities/new");
  await page.getByLabel("Local start").fill("2026-09-20T08:00");
  await page.getByLabel("Duration").fill("50");
  await page.getByLabel(/Distance/).fill("8");
  await page.getByLabel(/Title/).fill("Original title");
  await page.getByRole("button", { name: /Save Completed Activity/ }).click();

  await page.getByRole("button", { name: "Edit activity" }).click();
  const correction = page.getByRole("form", { name: "Edit activity" });
  await correction.getByLabel("Duration").fill("55");
  await correction.getByLabel("Reason for changes").fill("Stopped watch late");
  await correction.getByRole("button", { name: "Save changes" }).press("Enter");

  await expect(page.getByRole("status")).toContainText("Source values and prior changes remain preserved");
  await expect(page.getByText("55 min", { exact: true })).toBeVisible();
  await page.getByText("View changes").click();
  await expect(page.getByLabel("Correction history")).toContainText("50 min → 55 min");
  await page.reload();
  await expect(page.getByText("55 min", { exact: true })).toBeVisible();
  await page.getByText("View changes").click();
  await expect(page.getByLabel("Correction history")).toContainText("Stopped watch late");
});

test("removes distance through an append-only Correction", async ({ page }) => {
  await page.goto("/activities/new");
  await page.getByLabel("Local start").fill("2026-09-20T08:00");
  await page.getByLabel("Duration").fill("50");
  await page.getByLabel(/Distance/).fill("8");
  await page.getByRole("button", { name: /Save Completed Activity/ }).click();

  await page.getByRole("button", { name: "Edit activity" }).click();
  const correction = page.getByRole("form", { name: "Edit activity" });
  await correction.getByLabel(/Distance/).fill("");
  await correction.getByLabel("Reason for changes").fill("GPS distance unavailable");
  await correction.getByRole("button", { name: "Save changes" }).press("Enter");

  await expect(page.getByRole("status")).toContainText("Source values and prior changes remain preserved");
  await expect(page.getByText("Not recorded", { exact: true }).first()).toBeVisible();
  await page.getByText("View changes").click();
  await expect(page.getByLabel("Correction history")).toContainText("8 km → Not recorded");
  await expect(page.locator("body")).not.toContainText(/undefined|NaN/);
});

test("edits multiple activity fields with one reason and preserves the current Link", async ({ page }) => {
  const run = await page.request.post("/api/planned-runs", {
    data: {
      scheduled_date: "2027-06-12",
      training_intent: "aerobic_base",
      priority: "normal",
      duration_seconds: 3600,
      distance_metres: 10_000,
    },
  });
  expect(run.ok()).toBeTruthy();

  await page.goto("/activities/new");
  await page.getByLabel("Local start").fill("2027-06-12T08:00");
  await page.getByLabel("Duration").fill("50");
  await page.getByLabel(/Distance/).fill("8");
  await page.getByLabel(/Title/).fill("Morning run");
  await page.getByLabel(/Notes/).fill("Easy route");
  await page.getByRole("button", { name: /Save Completed Activity/ }).click();
  await expect(page).toHaveURL(/\/activities\/[a-f0-9-]+$/);
  await expect(page.getByLabel("Link state").getByRole("link", { name: "Aerobic base on 2027-06-12" })).toBeVisible();
  const activityId = page.url().split("/").at(-1)!;
  const linkBefore = (await (await page.request.get(`/api/activities/${activityId}/linking`)).json()).link.link.id;

  const card = page.getByRole("article", { name: "Activity summary" });
  await expect(card.getByText("Manual entry", { exact: true })).toBeVisible();
  await expect(card.getByText("50 min", { exact: true })).toBeVisible();
  const technicalAudit = page.getByRole("group", { name: "Technical matching audit" });
  await expect(technicalAudit).not.toHaveAttribute("open", "");
  await expect(technicalAudit.getByText("Algorithm version")).not.toBeVisible();

  const editButton = page.getByRole("button", { name: "Edit activity" });
  await tabTo(page, editButton);
  await expect(editButton).toHaveCSS("outline-style", "solid");
  await editButton.press("Enter");
  const edit = page.getByRole("form", { name: "Edit activity" });
  await expect(page.getByRole("heading", { name: "Edit activity" })).toBeFocused();
  await expect(edit.getByLabel("Duration")).toHaveValue("50");
  await expect(edit.getByLabel(/Distance/)).toHaveValue("8");
  await edit.getByLabel("Duration").fill("47.5");
  await edit.getByLabel(/Distance/).fill("7.75");
  await edit.getByLabel("Title").fill("Adjusted morning run");
  await edit.getByLabel("Notes").fill("Watch included the walk home");
  await edit.getByLabel("Reason for changes").fill("Trimmed non-running time");
  await edit.getByRole("button", { name: "Save changes" }).press("Enter");

  await expect(page.getByRole("status")).toContainText("Activity updated");
  await expect(card.getByRole("heading", { name: "Adjusted morning run" })).toBeVisible();
  await expect(card.getByText("47 min 30 sec", { exact: true })).toBeVisible();
  await expect(card.getByText("7.75 km", { exact: true })).toBeVisible();
  await expect(editButton).toBeFocused();
  const linkAfter = (await (await page.request.get(`/api/activities/${activityId}/linking`)).json()).link.link.id;
  expect(linkAfter).toBe(linkBefore);

  await page.getByText("View changes").click();
  const history = page.getByLabel("Correction history");
  await expect(history.getByRole("article")).toHaveCount(4);
  await expect(history).toContainText("50 min → 47 min 30 sec");
  await expect(history).toContainText("8 km → 7.75 km");
  await expect(history.getByText("Trimmed non-running time")).toHaveCount(4);
});

test("cancel and unchanged save create no Corrections on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/activities/new");
  await page.getByLabel("Local start").fill("2027-07-20T06:30");
  await page.getByLabel("Duration").fill("30");
  await page.getByLabel(/Title/).fill("Mobile run");
  await page.getByRole("button", { name: /Save Completed Activity/ }).click();
  await expect(page).toHaveURL(/\/activities\/[a-f0-9-]+$/);
  const activityId = page.url().split("/").at(-1)!;

  await page.getByRole("button", { name: "Edit activity" }).click();
  await page.getByRole("form", { name: "Edit activity" }).getByLabel("Duration").fill("35");
  await page.getByRole("button", { name: "Cancel" }).press("Enter");
  await expect(page.getByRole("form", { name: "Edit activity" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit activity" })).toBeFocused();

  await page.getByRole("button", { name: "Edit activity" }).click();
  await page.getByRole("form", { name: "Edit activity" }).getByRole("button", { name: "Save changes" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("No changes to save");
  const saved = await (await page.request.get(`/api/activities/${activityId}`)).json();
  expect(saved.corrections).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test("editing duration preserves fractional-second start precision", async ({ page }) => {
  const created = await page.request.post("/api/activities", {
    data: {
      modality: "running",
      start_instant: "2027-08-20T06:30:37.500+00:00",
      duration_seconds: 1800,
      distance_metres: null,
      title: "Second precision run",
      notes: null,
    },
  });
  expect(created.ok()).toBeTruthy();
  const activity = await created.json();

  await page.goto(`/activities/${activity.id}`);
  await page.getByRole("button", { name: "Edit activity" }).click();
  const edit = page.getByRole("form", { name: "Edit activity" });
  await expect(edit.getByLabel("Local start")).toHaveValue(/T\d{2}:\d{2}:37\.5(?:00)?$/);
  await edit.getByLabel("Duration").fill("31");
  await edit.getByLabel("Reason for changes").fill("Corrected elapsed time");
  await edit.getByRole("button", { name: "Save changes" }).click();

  const saved = await (await page.request.get(`/api/activities/${activity.id}`)).json();
  expect(saved.start_instant).toBe("2027-08-20T06:30:37.500000Z");
  expect(saved.corrections.map((correction: { field_name: string }) => correction.field_name)).toEqual(["duration_seconds"]);
});
