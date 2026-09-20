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
  await expect(page.getByText("Source: Garmin FIT import")).toBeVisible();
  await expect(page.getByText("fitdecode 0.11.0")).toBeVisible();
  await expect(page.getByText("sha256/", { exact: false })).toBeVisible();
  const originals = page.getByText("Original normalized values").locator("..");
  await expect(originals).toBeVisible();
  await expect(originals.getByText("57 sec")).toBeVisible();
  await expect(page.getByText("Unmatched", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/activities\/[a-f0-9-]+$/);

  await page.reload();
  await expect(page.getByText("Source: Garmin FIT import")).toBeVisible();
  await expect(page.getByText("Unmatched", { exact: true })).toBeVisible();
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
