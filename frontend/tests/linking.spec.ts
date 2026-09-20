import { expect, test } from "@playwright/test";

async function createRunAndActivity(page: import("@playwright/test").Page, title: string, day: string) {
  await page.goto("/");
  await page.getByLabel("Local date").fill(day);
  await page.getByLabel("Duration").fill("60");
  await page.getByLabel("Distance").fill("10");
  await page.getByRole("button", { name: /Save Planned Run/ }).click();
  await expect(page).toHaveURL(/\/planned-runs\/[a-f0-9-]+$/);
  const runUrl = page.url();

  await page.goto("/activities/new");
  await page.getByLabel("Local start").fill(`${day}T08:00`);
  await page.getByLabel("UTC offset").fill("+00:00");
  await page.getByLabel("Duration").fill("55");
  await page.getByLabel(/Distance/).fill("9");
  await page.getByLabel(/Title/).fill(title);
  await page.getByRole("button", { name: /Save Completed Activity/ }).click();
  await expect(page).toHaveURL(/\/activities\/[a-f0-9-]+$/);

  return runUrl;
}

test("confirms a pending suggestion and revisits planned-versus-actual evidence", async ({ page }) => {
  const runUrl = await createRunAndActivity(page, "Ticket 04 confirmed run", "2026-09-20");

  const pending = page.getByRole("region", { name: "Suggested Planned Run matches" });
  await expect(pending.getByText("Pending suggestion", { exact: true })).toBeVisible();
  const suggestion = pending.getByRole("form", { name: "Suggestion for Aerobic base on 2026-09-20" });
  await expect(suggestion.getByText("Aerobic base on 2026-09-20")).toBeVisible();
  await expect(suggestion.getByText("Both records have running modality.")).toBeVisible();
  const duration = suggestion.getByLabel("Linked duration");
  await duration.focus();
  await expect(duration).toHaveCSS("outline-style", "solid");
  await duration.fill("50");
  await suggestion.getByLabel(/Linked distance/).fill("8");
  await suggestion.getByRole("button", { name: "Confirm Link" }).press("Enter");

  await expect(page.getByRole("status")).toContainText("Link confirmed");
  await expect(page.getByText("Partly linked", { exact: true })).toBeVisible();

  await page.goto(runUrl);
  const confirmed = page.getByRole("region", { name: "Confirmed Links" });
  await expect(confirmed.getByText("Confirmed Links", { exact: true })).toBeVisible();
  await expect(confirmed.getByText("50 min")).toBeVisible();
  await expect(confirmed.getByText("8 km")).toBeVisible();
  await expect(confirmed.getByText("5 min")).toBeVisible();
  await expect(confirmed.getByText("1 km")).toBeVisible();
  await expect(confirmed.getByText("10 min under prescription")).toBeVisible();
  await expect(confirmed.getByText("2 km under prescription")).toBeVisible();
  await expect(confirmed.getByText("Manual athlete entry; no imported raw source.")).toBeVisible();
  await expect(page.getByText("Session Outcome: not recorded")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("region", { name: "Confirmed Links" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Suggested Planned Run matches" })).toHaveCount(0);
});

test("rejects a suggestion without changing source records", async ({ page }) => {
  await createRunAndActivity(page, "Ticket 04 rejected run", "2026-09-24");

  const pending = page.getByRole("region", { name: "Suggested Planned Run matches" });
  const suggestion = pending.getByRole("form", { name: "Suggestion for Aerobic base on 2026-09-24" });
  await suggestion.getByRole("button", { name: "Confirm Link" }).focus();
  await page.keyboard.press("Shift+Tab");
  const reject = suggestion.getByRole("button", { name: "Reject suggestion" });
  await expect(reject).toBeFocused();
  await expect(reject).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("status")).toContainText("Suggestion rejected");
  await expect(page.getByText("No compatible Planned Run suggestions.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("No compatible Planned Run suggestions.")).toBeVisible();
});

test("creates edits and removes direct links without a suggestion", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Local date").fill("2026-10-10");
  await page.getByLabel("Duration").fill("60");
  await page.getByLabel("Distance").fill("10");
  await page.getByRole("button", { name: /Save Planned Run/ }).click();

  await page.goto("/activities/new");
  await page.getByLabel("Local start").fill("2026-10-20T08:00");
  await page.getByLabel("UTC offset").fill("+00:00");
  await page.getByLabel("Duration").fill("60");
  await page.getByLabel(/Distance/).fill("10");
  await page.getByLabel(/Title/).fill("Combined direct Link");
  await page.getByRole("button", { name: /Save Completed Activity/ }).click();

  await expect(page.getByText("No compatible Planned Run suggestions.")).toBeVisible();
  const direct = page.getByRole("form", { name: "Create direct Link" });
  await direct.getByLabel("Planned Run").selectOption({ label: "Aerobic base on 2026-10-10" });
  await direct.getByLabel("Linked duration").fill("61");
  await direct.getByRole("button", { name: "Create Link" }).click();
  await expect(page.getByRole("status")).toContainText("Direct link was not created");
  await expect(direct.getByLabel("Linked duration")).toHaveAttribute("aria-describedby", "direct-link-error");
  await expect(page.locator("#direct-link-error")).toContainText("remaining 3600 seconds");
  await direct.getByLabel("Linked duration").fill("40");
  await direct.getByLabel(/Linked distance/).fill("7");
  await direct.getByRole("button", { name: "Create Link" }).press("Enter");

  await expect(page.getByRole("status")).toContainText("Direct link created");
  await expect(page.getByText("Partly linked", { exact: true })).toBeVisible();
  await expect(page.getByText("20 min remaining")).toBeVisible();
  await expect(page.getByText("3 km remaining")).toBeVisible();

  const link = page.getByRole("form", { name: "Link to Aerobic base on 2026-10-10" });
  const duration = link.getByLabel("Linked duration");
  await duration.focus();
  await expect(duration).toHaveCSS("outline-style", "solid");
  await duration.fill("30");
  await link.getByLabel(/Linked distance/).fill("5");
  await link.getByRole("button", { name: "Save Link" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Link updated");
  await expect(page.getByText("30 min remaining")).toBeVisible();

  await link.getByRole("button", { name: "Remove Link" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Link removed");
  await expect(page.getByText("Unmatched", { exact: true })).toBeVisible();
  await expect(page.getByText("1 hr remaining")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("form", { name: "Create direct Link" })).toBeVisible();
  await expect(page.getByRole("form", { name: /Link to/ })).toHaveCount(0);
});
