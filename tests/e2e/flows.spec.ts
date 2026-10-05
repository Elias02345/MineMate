import { test, expect } from "@playwright/test";
test.describe.serial("graphical first-run and management", () => {
  test("owner, server creation, lifecycle, settings, backup, restore and permissions", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "A new adventure begins." }),
    ).toBeVisible();
    await page.screenshot({
      path: "docs/screenshots/onboarding.png",
      fullPage: true,
    });
    await page.getByLabel("Username", { exact: true }).fill("Owner");
    await page
      .getByLabel("Password (at least 12 characters)")
      .fill("a-strong-test-password");
    await page.getByRole("button", { name: "Let’s build something" }).click();
    await expect(
      page.getByRole("heading", { name: "A little corner of the Overworld." }),
    ).toBeVisible();
    await page.screenshot({
      path: "docs/screenshots/dashboard.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Create a world", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: /Add little superpowers/ }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Enter a specific version").fill("1.21.1");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("I have read and accept").check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Give your world a name").fill("Birch Hollow");
    await page.getByRole("button", { name: "Craft this world" }).click();
    await expect(
      page.getByRole("heading", { name: "Birch Hollow", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Wake your world", exact: true })
      .click();
    await expect(
      page.locator(".server-title").getByText("Online", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "docs/screenshots/server.png",
      fullPage: true,
    });
    await page.getByRole("tab", { name: "Console", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Minecraft command", exact: true })
      .fill("list");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("players online");
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await page.getByLabel("Player slots", { exact: true }).fill("30");
    const saved = page.waitForResponse(
      (r) => r.url().endsWith("/settings") && r.request().method() === "PUT",
    );
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .first()
      .click();
    const settingsOperation = await (await saved).json();
    await expect
      .poll(async () => {
        const response = await page.request.get("/api/v1/operations");
        const operations = (await response.json()) as {
          id: string;
          status: string;
        }[];
        return operations.find((o) => o.id === settingsOperation.id)?.status;
      })
      .toBe("SUCCEEDED");
    await expect(
      page.locator(".server-title").getByText("Online", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("tab", { name: "Recovery chests", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Pack a recovery chest", exact: true })
      .click();
    await expect(page.locator(".backup-card")).toHaveCount(2);
    await page
      .locator(".backup-card")
      .first()
      .getByRole("button", { name: "Restore", exact: true })
      .click();
    await page
      .getByLabel(/Type the world name to confirm/)
      .fill("Birch Hollow");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Restore", exact: true })
      .click();
    await expect(
      page.locator(".server-title").getByText("Online", { exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Play together", exact: true }).click();
    await expect(page.locator(".cloudgate-target")).toContainText(
      "192.168.1.50",
    );
    await expect(page.locator(".cloudgate-target")).toContainText("TCP");
    await page.getByRole("link", { name: "Adventurers", exact: true }).click();
    await page.getByRole("button", { name: "Invite an adventurer" }).click();
    await page.getByLabel("Username", { exact: true }).fill("Guest");
    await page
      .getByLabel("Password (at least 12 characters)")
      .fill("a-strong-guest-password");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save changes" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Guest", exact: true }),
    ).toBeVisible();
  });
  test("mobile, German, reduced effects and muted sound", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByLabel("Username", { exact: true }).fill("Owner");
    await page
      .getByLabel("Password (at least 12 characters)")
      .fill("a-strong-test-password");
    await page.getByRole("button", { name: "Enter your worlds" }).click();
    await expect(
      page.getByRole("heading", { name: "A little corner of the Overworld." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Dein Stück Oberwelt." }),
    ).toBeVisible();
    await page.screenshot({
      path: "docs/screenshots/mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
});
