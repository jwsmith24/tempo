import { expect, test } from "@playwright/test";
import path from "node:path";

const fixture = path.resolve("../tests/fixtures/garmin-fenix-5-run.fit");

test("imports and revisits unmatched Garmin FIT evidence", async ({ page }) => {
  await page.goto("/activities/import");
  await expect(page.getByRole("heading", { name: "Import observed work." })).toBeVisible();

  const input = page.getByLabel("Garmin FIT activity");
  await input.focus();
  await expect(input).toHaveCSS("outline-style", "solid");
  await input.setInputFiles(fixture);
  await page.getByRole("button", { name: /Import FIT Activity/ }).click();

  await expect(page.getByRole("status")).toContainText("Matching evaluated");
  const card = page.getByRole("article", { name: "Activity summary" });
  await expect(card.getByText("FIT import", { exact: true })).toBeVisible();
  await expect(card.getByText("57 sec", { exact: true })).toBeVisible();
  await expect(page.getByText("fitdecode 0.11.0")).toBeHidden();
  await expect(page.getByText("sha256/", { exact: false })).toBeHidden();
  await page.getByText("Source details").click();
  await expect(page.getByText("retained Garmin FIT source")).toBeVisible();
  await expect(page.getByText("fitdecode 0.11.0")).toBeVisible();
  await expect(page.getByText("garmin_fit")).toBeVisible();
  await expect(page.getByText("Source identity")).toBeVisible();
  await expect(page.getByText("sha256/", { exact: false })).toBeVisible();
  await expect(page.getByText("Source checksum")).toBeVisible();
  await expect(page.getByText("Original imported values")).toBeVisible();
  await expect(page.getByText("57 sec", { exact: true })).toHaveCount(2);

  await page.getByRole("button", { name: "Edit activity" }).click();
  const edit = page.getByRole("form", { name: "Edit activity" });
  await edit.getByLabel("Duration").fill("1.25");
  await edit.getByLabel("Reason for changes").fill("Corrected device elapsed time");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(card.getByText("1 min 15 sec", { exact: true })).toBeVisible();
  await page.getByText("View changes").click();
  await expect(page.getByLabel("Correction history")).toContainText("57 sec → 1 min 15 sec");
  await expect(page.getByText("fitdecode 0.11.0")).toBeVisible();
  await expect(page.getByLabel("Link state")).toContainText("Unmatched unplanned activity");
  await expect(page).toHaveURL(/\/activities\/[a-f0-9-]+$/);

  await page.reload();
  await expect(page.getByRole("article", { name: "Activity summary" }).getByText("FIT import", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Link state")).toContainText("Unmatched unplanned activity");
});

test("shows an actionable FIT import error", async ({ page }) => {
  await page.goto("/activities/import");
  await page.getByLabel("Garmin FIT activity").setInputFiles({
    name: "broken.fit",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not a FIT file"),
  });
  await page.getByRole("button", { name: /Import FIT Activity/ }).click();

  await expect(page.getByRole("status")).toContainText("not imported");
  await expect(page.getByLabel("Garmin FIT activity")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#fit-file-error")).toContainText("FIT");
});

test("requests a portable Stage 1 export", async ({ page }) => {
  await page.goto("/records");
  const button = page.getByRole("button", { name: "Export my data" });
  await button.focus();
  await expect(button).toBeFocused();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    button.press("Enter"),
  ]);
  await expect(page.getByRole("status")).toContainText("Export downloaded");
  await expect(download.suggestedFilename()).toBe("tempo-stage1-export.zip");
});
