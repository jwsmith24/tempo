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
  await expect(page.getByRole("article", { name: "Planned Run review" })).toBeVisible();
  await expect(page.getByText("50 min")).toBeVisible();
  await expect(page.getByText("10 km")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Active revision|Created by athlete entry|[a-f0-9]{8}-[a-f0-9-]{27}/);
  await expect(page).toHaveURL(/\/planned-runs\/[a-f0-9-]+$/);
  await expect(page.getByRole("status")).toBeEmpty({ timeout: 6_000 });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Planned Run" })).toBeVisible();
  await expect(page.getByText("Hold a controlled effort.")).toBeVisible();
  await expect(page.getByRole("article", { name: "Planned Run review" })).toBeVisible();
});

test("associates an actionable prescription error", async ({ page }) => {
  await page.goto("/");
  const date = page.getByLabel("Local date");
  await expect(date).toHaveValue(await date.evaluate((input: HTMLInputElement) => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }));
  await page.getByRole("button", { name: /Save Planned Run/ }).click();

  await expect(page.getByRole("status")).toContainText("not saved");
  await expect(page.locator("fieldset")).toHaveAttribute("aria-describedby", "prescription-error");
  await expect(page.getByText("Enter a duration, distance, or both.")).toBeVisible();
});

test("explains priority and keeps validation from moving the duration control", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("How important this session is when plans compete.")).toBeVisible();
  await expect(page.getByLabel("Priority").locator("option")).toHaveText([
    "Low - flexible",
    "Normal - standard importance",
    "High - protect this session",
  ]);
  const duration = page.locator('input[name="duration_minutes"]');
  const before = await duration.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  await page.getByRole("button", { name: /Save Planned Run/ }).click();
  await expect(page).toHaveURL("/");
  const after = await duration.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  expect(after).toBe(before);
  await expect(page.locator("fieldset")).toContainText("Enter either or both");
  await expect(page.locator("fieldset")).not.toContainText(/or \/ and|required \/ optional|Observed amount/);
});

test("compares only prescribed measures for duration-only and distance-only runs", async ({ page }) => {
  const durationPlan = await page.request.post("/api/planned-runs", { data: {
    scheduled_date: "2027-05-01", training_intent: "aerobic_base", priority: "normal", duration_seconds: 1800,
  } });
  const durationRun = await durationPlan.json();
  await page.request.post("/api/activities", { data: {
    modality: "running", start_instant: "2027-05-01T08:00:00Z", duration_seconds: 1500, distance_metres: 4000, title: "Duration prescription",
  } });
  await page.goto(`/planned-runs/${durationRun.id}`);
  await expect(page.getByRole("figure", { name: "Duration comparison: Planned 30 min. Actual 25 min. 5 min under prescription." })).toBeVisible();
  await expect(page.getByLabel("Distance comparison")).toContainText("Not comparable");

  const distancePlan = await page.request.post("/api/planned-runs", { data: {
    scheduled_date: "2027-05-03", training_intent: "assessment", priority: "high", distance_metres: 5000,
  } });
  const distanceRun = await distancePlan.json();
  await page.request.post("/api/activities", { data: {
    modality: "running", start_instant: "2027-05-03T08:00:00Z", duration_seconds: 1500, distance_metres: 5000, title: "Distance prescription",
  } });
  await page.goto(`/planned-runs/${distanceRun.id}`);
  await expect(page.getByLabel("Duration comparison")).toContainText("Not comparable");
  await expect(page.getByRole("figure", { name: "Distance comparison: Planned 5 km. Actual 5 km. On prescription." })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/undefined|NaN|score/i);
});

test("shows split recordings separately and totals all complete evidence", async ({ page }) => {
  const planResponse = await page.request.post("/api/planned-runs", { data: {
    scheduled_date: "2027-05-10", training_intent: "threshold", priority: "normal", duration_seconds: 2700, distance_metres: 7000,
  } });
  const plan = await planResponse.json();
  for (const activity of [
    { start_instant: "2027-05-10T08:00:00Z", duration_seconds: 1200, distance_metres: 3000, title: "Warm-up recording" },
    { start_instant: "2027-05-10T08:25:00Z", duration_seconds: 1500, distance_metres: 4000, title: "Main recording" },
  ]) {
    const response = await page.request.post("/api/activities", { data: { modality: "running", ...activity } });
    expect(response.ok()).toBeTruthy();
  }

  await page.goto(`/planned-runs/${plan.id}`);
  const activities = page.getByRole("region", { name: "Confirmed Links" });
  await expect(activities.getByRole("link", { name: /Warm-up recording.*20 min.*3 km/ })).toBeVisible();
  await expect(activities.getByRole("link", { name: /Main recording.*25 min.*4 km/ })).toBeVisible();
  await expect(page.getByLabel("Complete actual totals")).toContainText("45 min");
  await expect(page.getByLabel("Complete actual totals")).toContainText("7 km");
  await expect(page.getByRole("figure", { name: "Duration comparison: Planned 45 min. Actual 45 min. On prescription." })).toBeVisible();
  await expect(page.getByRole("figure", { name: "Distance comparison: Planned 7 km. Actual 7 km. On prescription." })).toBeVisible();
});
