import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import type { Server, Operation } from "../../packages/shared/src/index.ts";

test.beforeEach(async ({ context }, info) => {
  const hash = createHash("sha256").update(info.testId).digest();
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `198.18.${hash[0]}.${hash[1]}`,
  });
});
async function login(page: Page, username = "Owner") {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page
    .getByLabel("Password (at least 12 characters)")
    .fill("a-strong-test-password");
  const setup = await page
    .getByRole("button", { name: "Let’s build something" })
    .count();
  await page
    .getByRole("button", {
      name: setup ? "Let’s build something" : "Enter your worlds",
    })
    .click();
  await page
    .getByRole("heading", { name: "A little corner of the Overworld." })
    .waitFor();
}
async function createServer(page: Page, name: string) {
  const auth = (await (
    await page.request.get("/api/v1/auth/status")
  ).json()) as { csrf: string };
  const response = await page.request.post("/api/v1/servers", {
    headers: { "x-csrf-token": auth.csrf, origin: "http://127.0.0.1:8091" },
    data: {
      name,
      edition: "JAVA",
      software: "VANILLA",
      version: "1.21.1",
      memoryMb: 1024,
      cpu: 1,
      eula: true,
    },
  });
  expect(response.status()).toBe(202);
  const result = (await response.json()) as {
    server: Server;
    operation: Operation;
  };
  await expect
    .poll(async () => {
      const operations = (await (
        await page.request.get(
          `/api/v1/operations?serverId=${result.server.id}`,
        )
      ).json()) as Operation[];
      return operations.find(
        (operation) => operation.id === result.operation.id,
      )?.status;
    })
    .toBe("SUCCEEDED");
  return result.server;
}
async function online(page: Page) {
  await expect(
    page.locator(".server-title").getByText("Online", { exact: true }),
  ).toBeVisible();
}

test("console shortcuts, command history and graphical whitelist persist through restart", async ({
  page,
}) => {
  await login(page);
  const server = await createServer(page, "Console and guests");
  await page.goto(`/servers/${server.id}`);
  await page.getByRole("tab", { name: "Console", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Make it day", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Wake your world", exact: true })
    .click();
  await online(page);
  for (const [label, command] of [
    ["List players", "list"],
    ["Save world now", "save-all flush"],
    ["Make it day", "time set day"],
    ["Clear weather", "weather clear"],
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("log")).toContainText(`> ${command}`);
  }
  await page
    .getByRole("combobox", { name: "Difficulty", exact: true })
    .selectOption("hard");
  await page
    .getByRole("button", { name: "Apply difficulty", exact: true })
    .click();
  await expect(page.getByRole("log")).toContainText("> difficulty hard");
  await page
    .getByLabel("Message to all players", { exact: true })
    .fill("Welcome friends!");
  await page.getByRole("button", { name: "Announce", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("> say Welcome friends!");
  const input = page.getByRole("textbox", {
    name: "Minecraft command",
    exact: true,
  });
  await input.fill("/list");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await input.press("ArrowUp");
  await expect(input).toHaveValue("list");
  await page
    .getByLabel("Search the console", { exact: true })
    .fill("Welcome friends!");
  await expect(page.getByRole("log")).toContainText("Welcome friends!");
  await page.getByLabel("Search the console", { exact: true }).fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".console-shortcuts").screenshot({
    path: "docs/screenshots/console-actions.png",
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Players", exact: true }).click();
  await page
    .getByLabel("Minecraft player name", { exact: true })
    .fill("Guest_123");
  await page
    .getByRole("combobox", { name: "Player action", exact: true })
    .selectOption("whitelist");
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect(page.locator(".player-access-list").first()).toContainText(
    "Guest_123",
  );
  await page
    .getByRole("switch", { name: "Only invited players may join", exact: true })
    .check();
  const settingSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/settings") &&
      response.request().method() === "PUT",
  );
  await page
    .getByRole("button", { name: "Save guest list setting", exact: true })
    .click();
  const operation = (await (await settingSaved).json()) as Operation;
  await expect
    .poll(async () => {
      const operations = (await (
        await page.request.get(`/api/v1/operations?serverId=${server.id}`)
      ).json()) as Operation[];
      return operations.find((entry) => entry.id === operation.id)?.status;
    })
    .toBe("SUCCEEDED");
  await expect(
    page.getByRole("button", { name: "Save guest list setting", exact: true }),
  ).toBeDisabled();
  await online(page);
  await page.reload();
  await page.getByRole("tab", { name: "Players", exact: true }).click();
  await expect(
    page.getByRole("switch", {
      name: "Only invited players may join",
      exact: true,
    }),
  ).toBeChecked();
  await expect(page.locator(".player-access-list").first()).toContainText(
    "Guest_123",
  );
  await page.locator(".player-access-panel").screenshot({
    path: "docs/screenshots/whitelist.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Remove invitation", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect(page.locator(".player-access-list").first()).not.toContainText(
    "Guest_123",
  );
});

test("share an invitation and grant then revoke a member's management access graphically", async ({
  page,
  browser,
}) => {
  await login(page);
  const server = await createServer(page, "Shared console");
  await page.goto(`/servers/${server.id}`);
  await expect(
    page.getByRole("tab", { name: "World permissions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Advanced mode", { exact: true }),
  ).not.toBeChecked();
  await page.getByRole("tab", { name: "Play together", exact: true }).click();
  await expect(
    page.getByLabel("Minecraft invitation", { exact: true }),
  ).toHaveValue(
    new RegExp(
      `Shared console.*\\nMinecraft Java.*\\nHost: 192\\.168\\.1\\.50.*\\nLAN port: ${server.port}`,
    ),
  );
  await expect(
    page.getByRole("button", { name: "Copy invitation", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });
  await page
    .getByRole("button", { name: "Copy invitation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Copy invitation", exact: true }),
  ).toContainText("Copied");
  await page
    .getByRole("button", { name: "Share management access", exact: true })
    .click();
  await page
    .getByRole("link", {
      name: "Create or manage member accounts",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Invite an adventurer", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Username", { exact: true })
    .fill("ConsoleFriend");
  await page
    .getByRole("dialog")
    .getByLabel("Password (at least 12 characters)")
    .fill("a-strong-test-password");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto(`/servers/${server.id}`);
  await page
    .getByRole("tab", { name: "World permissions", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Adventurers", exact: true })
    .selectOption({ label: "ConsoleFriend" });
  await page
    .getByRole("button", { name: "Manage server and console", exact: true })
    .click();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/permissions") &&
      response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  expect((await saved).status()).toBe(200);
  const memberContext = await browser.newContext({
    baseURL: "http://127.0.0.1:8091",
    extraHTTPHeaders: { "x-forwarded-for": "198.19.1.1" },
  });
  try {
    const member = await memberContext.newPage();
    await login(member, "ConsoleFriend");
    await member
      .getByRole("link", { name: "Shared console", exact: true })
      .first()
      .click();
    await expect(
      member.getByRole("tab", { name: "Console", exact: true }),
    ).toBeVisible();
    await expect(
      member.getByRole("tab", { name: "World permissions", exact: true }),
    ).toHaveCount(0);
    await expect(
      member.getByRole("tab", { name: "Settings", exact: true }),
    ).toHaveCount(0);
    await member
      .getByRole("button", { name: "Wake your world", exact: true })
      .click();
    await online(member);
    await member.getByRole("tab", { name: "Console", exact: true }).click();
    await member
      .getByRole("button", { name: "List players", exact: true })
      .click();
    await expect(member.getByRole("log")).toContainText("players online");
    await page
      .getByRole("button", { name: "Remove access", exact: true })
      .click();
    const revoked = page.waitForResponse(
      (response) =>
        response.url().endsWith("/permissions") &&
        response.request().method() === "PUT",
    );
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    expect((await revoked).status()).toBe(200);
    await expect
      .poll(async () =>
        (
          await member.request.get(`/api/v1/servers/${server.id}/console`)
        ).status(),
      )
      .toBe(403);
    await member.goto("/");
    await expect(
      member.getByRole("link", { name: "Shared console", exact: true }),
    ).toHaveCount(0);
  } finally {
    await memberContext.close();
  }
});
