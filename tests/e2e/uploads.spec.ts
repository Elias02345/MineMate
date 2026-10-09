import { test, expect, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import yazl from "yazl";
import type { Server, Operation } from "../../packages/shared/src/index.ts";

// Model independent browser clients so this fast suite does not share one IP's
// production request quota. Forwarded addresses are trusted only by the fixture.
test.beforeEach(async ({ context }, info) => {
  const hash = createHash("sha256").update(info.testId).digest();
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `198.18.${hash[0]}.${hash[1]}`,
  });
});

async function archive(entries: Record<string, string | Buffer>) {
  const zip = new yazl.ZipFile(),
    chunks: Buffer[] = [];
  for (const [name, text] of Object.entries(entries))
    zip.addBuffer(Buffer.from(text), name);
  const done = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
  zip.end();
  return done;
}
async function login(page: Page) {
  await page.route("**/api/v1/marketplace?**", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("Owner");
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
async function finish(page: Page, serverId: string, operation: Operation) {
  await expect
    .poll(async () => {
      const response = await page.request.get(
          `/api/v1/operations?serverId=${serverId}`,
        ),
        operations = (await response.json()) as Operation[];
      return operations.find((o) => o.id === operation.id)?.status;
    })
    .toBe("SUCCEEDED");
}
async function makeServer(page: Page, name: string) {
  const auth = (await (
    await page.request.get("/api/v1/auth/status")
  ).json()) as { csrf: string };
  const response = await page.request.post("/api/v1/servers", {
    headers: { "x-csrf-token": auth.csrf, origin: "http://127.0.0.1:8091" },
    data: {
      name,
      edition: "JAVA",
      software: "FABRIC",
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
  await finish(page, result.server.id, result.operation);
  return result.server;
}
async function fit(page: Page, selector: string) {
  expect(
    await page
      .locator(selector)
      .evaluateAll((elements) =>
        elements.every((e) => e.scrollWidth <= e.clientWidth + 2),
      ),
    selector + " clipped content",
  ).toBe(true);
}

test("creates NeoForge with 201 wizard mods and adds 121 mods from Inventory", async ({
  page,
}) => {
  test.setTimeout(120000);
  await login(page);
  await page.setViewportSize({ width: 390, height: 680 });
  await page
    .getByRole("button", { name: "Create a world", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Make it your own/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Server software", exact: true })
    .selectOption("NEOFORGE");
  await page
    .getByRole("combobox", { name: "Server installation", exact: true })
    .selectOption("upload");
  const installer = await archive({
    "META-INF/MANIFEST.MF":
      "Manifest-Version: 1.0\nMain-Class: net.neoforged.installer.Main\n",
    "install_profile.json": JSON.stringify({
      minecraft: "1.21.1",
      path: "net.neoforged:neoforge:21.1.200",
    }),
  });
  await page.getByLabel("Enter a specific version").fill("1.21.1");
  await page.locator('input[type="file"]').setInputFiles({
    name: "neoforge.jar",
    mimeType: "application/java-archive",
    buffer: installer,
  });
  await fit(page, ".modal-body");
  await page.screenshot({
    path: "docs/screenshots/server-jar-upload.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Choose your mods", exact: true }),
  ).toBeVisible();
  const mod = await archive({
    "META-INF/neoforge.mods.toml": "modLoader=javafml",
    "example/Mod.class": "controlled fixture",
  });
  await page.locator('input[type="file"]').setInputFiles([
    {
      name: "first-mod.jar",
      mimeType: "application/java-archive",
      buffer: mod,
    },
    {
      name: "second-mod.jar",
      mimeType: "application/java-archive",
      buffer: mod,
    },
  ]);
  await page.locator('input[type="file"]').setInputFiles([
    {
      name: "third-mod.jar",
      mimeType: "application/java-archive",
      buffer: mod,
    },
    ...Array.from({ length: 198 }, (_, i) => ({
      name: `wizard-mod-${i}.jar`,
      mimeType: "application/java-archive",
      buffer: mod,
    })),
  ]);
  await expect(page.locator(".upload-files li")).toHaveCount(201);
  await fit(page, ".modal-body");
  await page.screenshot({
    path: "docs/screenshots/wizard-mod-upload.png",
    animations: "disabled",
  });
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("I have read and accept").check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".review-grid")).toContainText("third-mod.jar");
  await page.getByLabel("Give your world a name").fill("Uploaded NeoForge");
  await page.getByRole("button", { name: "Craft this world" }).click();
  await expect(
    page.getByRole("heading", { name: "Uploaded NeoForge", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const serverId = page.url().split("/").at(-1)!;
  const server = (await (
    await page.request.get(`/api/v1/servers/${serverId}`)
  ).json()) as Server;
  expect(server.config.software).toBe("NEOFORGE");
  expect(server.config.serverSource).toBe("upload");
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(page.locator(".inventory-list")).toContainText("first-mod.jar");
  await expect(page.locator(".inventory-list")).toContainText("third-mod.jar");
  expect(
    await (
      await page.request.get(`/api/v1/servers/${serverId}/content`)
    ).json(),
  ).toHaveLength(201);
  await page
    .getByRole("button", { name: "Upload mod / plugin JARs", exact: true })
    .click();
  await page.locator('input[type="file"]').setInputFiles([
    {
      name: "later-mod.jar",
      mimeType: "application/java-archive",
      buffer: mod,
    },
    ...Array.from({ length: 120 }, (_, i) => ({
      name: `later-mod-${i}.jar`,
      mimeType: "application/java-archive",
      buffer: mod,
    })),
  ]);
  await expect(page.locator(".upload-files li")).toHaveCount(121);
  await page
    .getByLabel("I trust these files and confirm their installation.")
    .check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Upload", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator(".inventory-list")).toContainText("later-mod.jar");
  expect(
    await (
      await page.request.get(`/api/v1/servers/${serverId}/content`)
    ).json(),
  ).toHaveLength(322);
});

test("creates ATM-style NeoForge from its server ZIP in the wizard", async ({
  page,
}) => {
  await login(page);
  const installer = await archive({
    "install_profile.json": JSON.stringify({
      minecraft: "26.1.2",
      version: "neoforge-26.1.2.109",
    }),
  });
  const mod = await archive({
    "META-INF/neoforge.mods.toml": "[[mods]]",
  });
  const pack = await archive({
    "neoforge-26.1.2.109-installer.jar": installer,
    "mods/example.jar": mod,
    "config/atm.toml": "enabled = true",
    "kubejs/server_scripts/atm.js": "// pack content",
    "startserver.sh": "exit 99",
  });
  await page
    .getByRole("button", { name: "Create a world", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /A whole new adventure/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Server software", exact: true })
    .selectOption("NEOFORGE");
  await page.getByLabel("Enter a specific version").fill("26.1.2");
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("combobox", { name: "A fresh beginning, or a familiar home?" })
    .selectOption("pack");
  await expect(page.getByText(/official ServerFiles ZIP/)).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: "ServerFiles-0.10.0-beta.zip",
    mimeType: "application/zip",
    buffer: pack,
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("I have read and accept").check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Give your world a name").fill("ATM 11 fixture");
  await page.getByRole("button", { name: "Craft this world" }).click();
  await expect(
    page.getByRole("heading", { name: "ATM 11 fixture", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const id = page.url().split("/").at(-1)!;
  const server = (await (
    await page.request.get(`/api/v1/servers/${id}`)
  ).json()) as Server;
  expect(server.config).toMatchObject({
    software: "NEOFORGE",
    version: "26.1.2",
    loaderVersion: "26.1.2.109",
    serverSource: "upload",
    java: "auto",
  });
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(page.locator(".inventory-list")).toContainText("example.jar");
});

test("custom JAR, world and bulk mods retry only the failed batch without duplicating the server", async ({
  page,
}) => {
  await login(page);
  const requests: string[] = [];
  let chunks = 0;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      request.method() === "PUT" &&
      /\/upload-sessions\/[^/]+\/files\/\d+$/.test(pathname)
    )
      chunks++;
    if (request.method() !== "POST") return;
    if (pathname === "/api/v1/servers") requests.push("create");
    else if (/\/api\/v1\/servers\/[^/]+\/upload-sessions$/.test(pathname))
      requests.push((request.postDataJSON() as { kind: string }).kind);
  });
  await page
    .getByRole("button", { name: "Create a world", exact: true })
    .first()
    .click();
  const next = page.getByRole("button", { name: "Continue", exact: true });
  await next.click();
  await page.getByRole("button", { name: /Your own server JAR/ }).click();
  await next.click();
  const serverJar = await archive({
    "META-INF/MANIFEST.MF": "Main-Class: example.Server\n",
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "custom.jar",
    mimeType: "application/java-archive",
    buffer: serverJar,
  });
  await next.click();
  const picker = page.locator('input[type="file"]');
  const invalid = {
    name: "bad-mod.jar",
    mimeType: "application/java-archive",
    buffer: await archive({ "README.txt": "not a mod" }),
  };
  await picker.setInputFiles([invalid, invalid]);
  await expect(next).toBeDisabled();
  await page
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await picker.setInputFiles({
    name: "wrong.zip",
    mimeType: "application/zip",
    buffer: invalid.buffer,
  });
  await expect(next).toBeDisabled();
  await page
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  const valid = {
    name: "valid-mod.jar",
    mimeType: "application/java-archive",
    buffer: await archive({ "fabric.mod.json": "{}" }),
  };
  await picker.setInputFiles([valid, invalid]);
  await next.click();
  await next.click();
  await page
    .getByRole("combobox", {
      name: "A fresh beginning, or a familiar home?",
      exact: true,
    })
    .selectOption("world");
  await picker.setInputFiles({
    name: "world.zip",
    mimeType: "application/zip",
    buffer: await archive({
      "Saved/level.dat": "imported world",
      "Saved/region/r.0.0.mca": "saved region",
    }),
  });
  await next.click();
  await page.getByLabel("I have read and accept").check();
  await next.click();
  await page.getByLabel("Give your world a name").fill("Custom wizard retry");
  const craft = page.getByRole("button", { name: "Craft this world" });
  await craft.click();
  await page.getByText("Technical details", { exact: true }).click();
  await expect(
    page.getByText(
      "bad-mod.jar: This JAR has no Java classes or recognized mod/plugin metadata. Select the actual mod or plugin JAR for this server.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open the created world", exact: true }),
  ).toBeVisible();
  expect(requests).toEqual(["create", "custom", "world", "jar"]);
  expect(chunks).toBe(4);
  const servers = (await (
    await page.request.get("/api/v1/servers")
  ).json()) as Server[];
  const server = servers.find(
    (server) => server.name === "Custom wizard retry",
  )!;
  expect(
    await (
      await page.request.get(`/api/v1/servers/${server.id}/content`)
    ).json(),
  ).toHaveLength(0);
  await page
    .getByRole("button", {
      name: "Remove selected file bad-mod.jar",
      exact: true,
    })
    .click();
  await craft.click();
  await expect(
    page.getByRole("heading", { name: "Custom wizard retry", exact: true }),
  ).toBeVisible();
  expect(requests).toEqual(["create", "custom", "world", "jar", "jar"]);
  expect(chunks).toBe(4);
  const content = (await (
    await page.request.get(`/api/v1/servers/${server.id}/content`)
  ).json()) as { filename: string }[];
  expect(content.map((item) => item.filename)).toEqual(["mods/valid-mod.jar"]);
  const root = (await (
    await page.request.get(`/api/v1/servers/${server.id}/files`)
  ).json()) as { name: string }[];
  expect(root.map((item) => item.name)).toContain("custom-server.jar");
  const world = await page.request.get(
    `/api/v1/servers/${server.id}/files/text?path=world/level.dat`,
  );
  expect(await world.json()).toMatchObject({ text: "imported world" });
});

test("changing software clears mods and Vanilla and Bedrock skip the content step", async ({
  page,
}) => {
  await login(page);
  const open = page
    .getByRole("button", { name: "Create a world", exact: true })
    .first();
  await open.click();
  const next = page.getByRole("button", { name: "Continue", exact: true });
  await next.click();
  await page.getByRole("button", { name: /Make it your own/ }).click();
  await next.click();
  await next.click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "discarded-mod.jar",
    mimeType: "application/java-archive",
    buffer: await archive({ "fabric.mod.json": "{}" }),
  });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Server software", exact: true })
    .selectOption("NEOFORGE");
  await next.click();
  await expect(page.locator(".upload-files li")).toHaveCount(0);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Server software", exact: true })
    .selectOption("VANILLA");
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Room for everyone", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await open.click();
  await page.getByRole("button", { name: /Edition · Bedrock/ }).click();
  for (let i = 0; i < 3; i++) await next.click();
  await expect(
    page.getByRole("heading", { name: "Room for everyone", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".wizard-progress > div")).toHaveCount(7);
});

test("Paper creation installs 201 plugins into plugins", async ({ page }) => {
  await login(page);
  await page
    .getByRole("button", { name: "Create a world", exact: true })
    .first()
    .click();
  const next = page.getByRole("button", { name: "Continue", exact: true });
  await next.click();
  await page.getByRole("button", { name: /Add little superpowers/ }).click();
  await next.click();
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Choose your plugins", exact: true }),
  ).toBeVisible();
  const plugin = await archive({
    "plugin.yml": "name: Example\nmain: example.Plugin\n",
  });
  await page.locator('input[type="file"]').setInputFiles(
    Array.from({ length: 201 }, (_, i) => ({
      name: `plugin-${i}.jar`,
      mimeType: "application/java-archive",
      buffer: plugin,
    })),
  );
  for (let i = 0; i < 3; i++) await next.click();
  await page.getByLabel("I have read and accept").check();
  await next.click();
  await page.getByLabel("Give your world a name").fill("Wizard plugins");
  await page.getByRole("button", { name: "Craft this world" }).click();
  await expect(
    page.getByRole("heading", { name: "Wizard plugins", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const serverId = page.url().split("/").at(-1)!;
  const content = (await (
    await page.request.get(`/api/v1/servers/${serverId}/content`)
  ).json()) as { filename: string }[];
  expect(content).toHaveLength(201);
  expect(content.map((item) => item.filename)).toContain(
    "plugins/plugin-200.jar",
  );
});

test("browser resumes a mod upload after a broken chunk request", async ({
  page,
}) => {
  await login(page);
  const server = await makeServer(page, "Resumable mods");
  await page.goto(`/servers/${server.id}`);
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  let attempts = 0;
  await page.route("**/upload-sessions/*/files/0", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    attempts++;
    if (attempts === 1) await route.abort("failed");
    else await route.continue();
  });
  await page
    .getByRole("button", { name: "Upload mod / plugin JARs", exact: true })
    .click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "recovered.jar",
    mimeType: "application/java-archive",
    buffer: await archive({ "fabric.mod.json": '{"id":"recovered"}' }),
  });
  await page
    .getByLabel("I trust these files and confirm their installation.")
    .check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Upload", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator(".inventory-list")).toContainText("recovered.jar");
  expect(attempts).toBeGreaterThanOrEqual(2);
});

test("uploads saved worlds through ZIP and native folder selection", async ({
  page,
}) => {
  await login(page);
  const server = await makeServer(page, "Imported worlds");
  await page.goto(`/servers/${server.id}`);
  await page.getByRole("tab", { name: "Worlds", exact: true }).click();
  await page
    .getByRole("button", { name: "Bring your world", exact: true })
    .click();
  const zip = await archive({
    "Wrapped/Saved world/level.dat": "world data",
    "Wrapped/Saved world/region/r.0.0.mca": "region",
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "saved-world.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  await page
    .getByLabel("I trust these files and confirm their installation.")
    .check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Upload", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".world-manager-grid")).toContainText("world");
  const temporary = await mkdtemp(
      path.join(os.tmpdir(), "minemate-browser-world-"),
    ),
    folder = path.join(temporary, "Saved world");
  try {
    await mkdir(path.join(folder, "region"), { recursive: true });
    await writeFile(path.join(folder, "level.dat"), "folder world");
    await writeFile(path.join(folder, "region/r.4.5.mca"), "folder region");
    await page
      .getByRole("button", { name: "Bring your world", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Upload type", exact: true })
      .selectOption("world-folder");
    await page.locator('input[type="file"]').setInputFiles(folder);
    await expect(page.locator(".upload-files")).toContainText(
      "Saved world/region/r.4.5.mca",
    );
    await page
      .getByLabel("I trust these files and confirm their installation.")
      .check();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Upload", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const exported = await page.request.get(
      `/api/v1/servers/${server.id}/worlds/export?path=world`,
    );
    expect(exported.status()).toBe(200);
    await page
      .getByRole("tab", { name: "Recovery chests", exact: true })
      .click();
    await expect(page.locator(".backup-card")).toHaveCount(2);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 768, height: 600 },
  { width: 1024, height: 600 },
  { width: 1920, height: 1080 },
]) {
  test(`management pages and wizard controls remain reachable at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await login(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const server = await makeServer(
      page,
      "A_long_world_name_with_no_breaks_to_exercise_responsive_controls",
    );
    await page.setViewportSize(viewport);
    await page.goto(`/servers/${server.id}`);
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
      await page.locator(".tab-scene .mine-panel").first().waitFor();
      await fit(page, ".main-content, .tab-scene .mine-panel");
    }
    await page.goto("/");
    await page
      .getByRole("button", { name: "Create a world", exact: true })
      .first()
      .click();
    for (let step = 0; step < 8; step++) {
      await fit(page, ".modal-body");
      const footer = await page.locator(".modal-footer").boundingBox();
      expect(footer!.y).toBeGreaterThanOrEqual(0);
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(viewport.height);
      if (step === 1)
        await page.getByRole("button", { name: /Make it your own/ }).click();
      if (step === 2)
        await page.getByLabel("Advanced mode", { exact: true }).check();
      if (step === 6) await page.getByLabel("I have read and accept").check();
      if (step < 7)
        await page
          .getByRole("button", { name: "Continue", exact: true })
          .click();
    }
    if (viewport.width === 320)
      await page.screenshot({
        path: "docs/screenshots/responsive-wizard.png",
        animations: "disabled",
      });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
  });
}
