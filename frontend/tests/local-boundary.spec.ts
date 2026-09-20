import { expect, test } from "@playwright/test";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const networkProtocols = new Set(["http:", "https:", "ws:", "wss:"]);

test("loads the primary Stage 1 page without non-loopback requests", async ({ page }) => {
  const nonLoopbackRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (networkProtocols.has(url.protocol) && !loopbackHosts.has(url.hostname)) {
      nonLoopbackRequests.push(url.href);
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set the intention." })).toBeVisible();
  await expect.poll(() => nonLoopbackRequests).toEqual([]);
});

test("keeps system typography readable at a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");

  const heading = page.getByRole("heading", { name: "Set the intention." });
  await expect(heading).toBeVisible();
  await expect(heading).toHaveCSS("font-size", "48px");
  await expect(page.locator("body")).toHaveCSS("min-width", "320px");
});
