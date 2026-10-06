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
      animations: "disabled",
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
      animations: "disabled",
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
    // Optional plugin selection for Paper.
    await page.getByRole("button", { name: "Continue", exact: true }).click();
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
      animations: "disabled",
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
      animations: "disabled",
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

test("companions react to views, move with pointer and keyboard, and can be hidden", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("Owner");
  await page
    .getByLabel("Password (at least 12 characters)")
    .fill("a-strong-test-password");
  await page.getByRole("button", { name: "Enter your worlds" }).click();
  await expect(
    page.getByRole("heading", { name: "A little corner of the Overworld." }),
  ).toBeVisible();
  await expect(page.locator(".companion-character")).toHaveCount(4);
  const creeper = page.getByRole("button", {
    name: "Play with Creeper",
    exact: true,
  });
  const starting = (await creeper.boundingBox())!.x;
  await expect
    .poll(async () => Math.abs((await creeper.boundingBox())!.x - starting), {
      timeout: 12000,
    })
    .toBeGreaterThan(1);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const alex = page.getByRole("button", {
    name: "Play with Alex",
    exact: true,
  });
  await alex.click();
  await expect(
    page.getByText("Hand me that pickaxe. Let's tinker!"),
  ).toBeVisible();
  const beforeKey = (await alex.boundingBox())!.x;
  await alex.press("ArrowRight");
  await expect
    .poll(async () => (await alex.boundingBox())!.x)
    .toBeGreaterThan(beforeKey + 5);
  await alex.press("Enter");
  await expect(
    page.getByText("Hand me that pickaxe. Let's tinker!"),
  ).toBeVisible();

  await creeper.focus();
  const beforeDrag = (await creeper.boundingBox())!;
  await page.mouse.move(beforeDrag.x + 25, beforeDrag.y + 25);
  await page.mouse.down();
  await page.mouse.move(beforeDrag.x + 130, beforeDrag.y + 25, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await creeper.boundingBox())!.x)
    .toBeGreaterThan(beforeDrag.x + 60);
  await page.screenshot({
    animations: "disabled",
    path: "docs/screenshots/companions.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Companion controls" }).click();
  await page.getByRole("button", { name: "Hide companions" }).click();
  await expect(page.locator(".companion-trail")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".companion-trail")).toHaveCount(0);
  await page
    .getByRole("switch", { name: "Little companions", exact: false })
    .check();
  await expect(page.locator(".companion-character")).toHaveCount(4);
});

test("sound starts only when enabled, mute stops voices, and zero volume stays silent", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const stats = { starts: 0, ended: 0 };
    Object.assign(window, { mineMateAudioCheck: stats });
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const oscillator = create.call(this),
        start = oscillator.start.bind(oscillator);
      oscillator.start = (when = 0) => {
        stats.starts++;
        start(when);
      };
      oscillator.addEventListener("ended", () => stats.ended++);
      return oscillator;
    };
  });
  const stats = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            mineMateAudioCheck: { starts: number; ended: number };
          }
        ).mineMateAudioCheck,
    );
  await page.goto("/settings");
  await page.getByLabel("Username", { exact: true }).fill("Owner");
  await page
    .getByLabel("Password (at least 12 characters)")
    .fill("a-strong-test-password");
  await page.getByRole("button", { name: "Enter your worlds" }).click();
  await expect(
    page
      .getByRole("heading", { name: "Make yourself at home", exact: true })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Play with Bee", exact: true })
    .click();
  expect((await stats()).starts).toBe(0);
  const toggle = page.getByRole("button", {
    name: "Interface sounds",
    exact: true,
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Enter a portal", exact: true })
    .click();
  await expect.poll(async () => (await stats()).starts).toBeGreaterThan(0);
  await toggle.click();
  await expect
    .poll(async () => {
      const value = await stats();
      return value.starts - value.ended;
    })
    .toBe(0);
  const mutedStarts = (await stats()).starts;
  await page
    .getByRole("button", { name: "Play with Pig", exact: true })
    .click();
  expect((await stats()).starts).toBe(mutedStarts);
  await toggle.click();
  await page.getByRole("slider").first().focus();
  await page.getByRole("slider").first().press("Home");
  const silentStarts = (await stats()).starts;
  await page.getByRole("button", { name: "Open a chest", exact: true }).click();
  expect((await stats()).starts).toBe(silentStarts);
  await page
    .getByRole("switch", { name: "Reduced visual effects", exact: true })
    .check();
  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Reduced visual effects", exact: true }),
  ).toBeChecked();
  await expect(page.getByRole("slider").first()).toHaveValue("0");
  await expect(
    page.getByRole("button", { name: "Interface sounds", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect((await stats()).starts).toBe(0);
  expect(
    await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((animation) => animation.playState === "running").length,
    ),
  ).toBe(0);
});

test("all management views fit mobile and reduced motion leaves companions interactive", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("Owner");
  await page
    .getByLabel("Password (at least 12 characters)")
    .fill("a-strong-test-password");
  await page.getByRole("button", { name: "Enter your worlds" }).click();
  await page
    .getByRole("heading", { name: "A little corner of the Overworld." })
    .waitFor();
  await page
    .getByRole("link", { name: "Birch Hollow", exact: true })
    .first()
    .click();
  await page.getByLabel("Advanced mode", { exact: true }).check();
  for (const tab of [
    "Overview",
    "Console",
    "Settings",
    "Players",
    "Worlds",
    "Inventory",
    "Recovery chests",
    "Enchant & update",
    "Play together",
    "Files",
    "World permissions",
  ]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(page.locator(".tab-scene .mine-panel").first()).toBeVisible();
    expect(
      await page
        .locator(".main-content")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      tab + " horizontal overflow",
    ).toBe(true);
  }
  await page.getByRole("tab", { name: "Play together", exact: true }).click();
  await page
    .getByRole("button", { name: "Play with Creeper", exact: true })
    .click();
  await expect(
    page.getByText("Wonder what's on the other side…"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((animation) => animation.playState === "running").length,
    ),
  ).toBe(0);
  await page.screenshot({
    animations: "disabled",
    path: "docs/screenshots/mobile-portal.png",
    fullPage: true,
  });
});
