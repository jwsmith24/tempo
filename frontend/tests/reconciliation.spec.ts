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
  const duration = suggestion.getByLabel("Allocated duration");
  await duration.focus();
  await expect(duration).toHaveCSS("outline-style", "solid");
  await duration.fill("50");
  await suggestion.getByLabel(/Allocated distance/).fill("8");
  await suggestion.getByRole("button", { name: "Confirm Reconciliation" }).press("Enter");

  await expect(page.getByRole("status")).toContainText("Reconciliation confirmed");
  await expect(page.getByText("Partly reconciled", { exact: true })).toBeVisible();

  await page.goto(runUrl);
  const confirmed = page.getByRole("region", { name: "Confirmed Reconciliation" });
  await expect(confirmed.getByText("Confirmed Reconciliation", { exact: true })).toBeVisible();
  await expect(confirmed.getByText("50 min")).toBeVisible();
  await expect(confirmed.getByText("8 km")).toBeVisible();
  await expect(confirmed.getByText("5 min")).toBeVisible();
  await expect(confirmed.getByText("1 km")).toBeVisible();
  await expect(confirmed.getByText("10 min under prescription")).toBeVisible();
  await expect(confirmed.getByText("2 km under prescription")).toBeVisible();
  await expect(confirmed.getByText("Manual athlete entry; no imported raw source.")).toBeVisible();
  await expect(page.getByText("Session Outcome: not recorded")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("region", { name: "Confirmed Reconciliation" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Suggested Planned Run matches" })).toHaveCount(0);
});

test("rejects a suggestion without changing source records", async ({ page }) => {
  await createRunAndActivity(page, "Ticket 04 rejected run", "2026-09-24");

  const pending = page.getByRole("region", { name: "Suggested Planned Run matches" });
  const suggestion = pending.getByRole("form", { name: "Suggestion for Aerobic base on 2026-09-24" });
  await suggestion.getByRole("button", { name: "Confirm Reconciliation" }).focus();
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

test("creates edits and removes direct allocations without a suggestion", async ({ page }) => {
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
  await page.getByLabel(/Title/).fill("Combined direct allocation");
  await page.getByRole("button", { name: /Save Completed Activity/ }).click();

  await expect(page.getByText("No compatible Planned Run suggestions.")).toBeVisible();
  const direct = page.getByRole("form", { name: "Create direct allocation" });
  await direct.getByLabel("Planned Run").selectOption({ label: "Aerobic base on 2026-10-10" });
  await direct.getByLabel("Allocated duration").fill("61");
  await direct.getByRole("button", { name: "Create allocation" }).click();
  await expect(page.getByRole("status")).toContainText("Direct allocation was not created");
  await expect(direct.getByLabel("Allocated duration")).toHaveAttribute("aria-describedby", "direct-allocation-error");
  await expect(page.locator("#direct-allocation-error")).toContainText("remaining 3600 seconds");
  await direct.getByLabel("Allocated duration").fill("40");
  await direct.getByLabel(/Allocated distance/).fill("7");
  await direct.getByRole("button", { name: "Create allocation" }).press("Enter");

  await expect(page.getByRole("status")).toContainText("Direct allocation created");
  await expect(page.getByText("Partly reconciled", { exact: true })).toBeVisible();
  await expect(page.getByText("20 min unallocated")).toBeVisible();
  await expect(page.getByText("3 km unallocated")).toBeVisible();

  const allocation = page.getByRole("form", { name: "Allocation to Aerobic base on 2026-10-10" });
  const duration = allocation.getByLabel("Allocated duration");
  await duration.focus();
  await expect(duration).toHaveCSS("outline-style", "solid");
  await duration.fill("30");
  await allocation.getByLabel(/Allocated distance/).fill("5");
  await allocation.getByRole("button", { name: "Save allocation" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Allocation updated");
  await expect(page.getByText("30 min unallocated")).toBeVisible();

  await allocation.getByRole("button", { name: "Remove allocation" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Allocation removed");
  await expect(page.getByText("Unmatched", { exact: true })).toBeVisible();
  await expect(page.getByText("1 hr unallocated")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("form", { name: "Create direct allocation" })).toBeVisible();
  await expect(page.getByRole("form", { name: /Allocation to/ })).toHaveCount(0);
});
