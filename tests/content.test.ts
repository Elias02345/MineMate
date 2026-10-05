import { describe, it, expect } from "vitest";
import {
  resolveDependencies,
  validateDownloadUrl,
  type ContentVersion,
  type ContentPlatformProvider,
  type Project,
} from "../packages/mod-platforms/src/index.ts";
import { serverConfigSchema } from "../packages/shared/src/index.ts";
import { retainedBackups } from "../packages/backup/src/archive.ts";
const config = serverConfigSchema.parse({
  name: "test",
  edition: "JAVA",
  software: "FABRIC",
  version: "1.21.1",
  eula: true,
});
const version = (
  id: string,
  deps: ContentVersion["dependencies"] = [],
): ContentVersion => ({
  id,
  projectId: id,
  source: "modrinth",
  name: id,
  gameVersions: ["1.21.1"],
  loaders: ["fabric"],
  filename: id + ".jar",
  url: "https://cdn.modrinth.com/" + id,
  hash: "hash",
  hashAlgorithm: "sha512",
  published: "",
  dependencies: deps,
});
function provider(
  items: Record<string, ContentVersion>,
): ContentPlatformProvider {
  return {
    source: "modrinth",
    search: async () => [],
    project: async (id) => ({ id, serverSide: "required" }) as Project,
    versions: async (id) => (items[id] ? [items[id]!] : []),
    version: async (id) => items[id]!,
  };
}
describe("content resolution and retention", () => {
  it("orders required dependencies before their dependent and reports optional items", async () => {
    const p = provider({
      root: version("root", [
        { projectId: "base", versionId: null, type: "required" },
        { projectId: "extras", versionId: null, type: "optional" },
      ]),
      base: version("base"),
    });
    const plan = await resolveDependencies(p, "root", config, []);
    expect(plan.versions.map((v) => v.id)).toEqual(["base", "root"]);
    expect(plan.warnings).toHaveLength(1);
  });
  it("rejects dependency cycles", async () => {
    const p = provider({
      a: version("a", [{ projectId: "b", versionId: null, type: "required" }]),
      b: version("b", [{ projectId: "a", versionId: null, type: "required" }]),
    });
    await expect(resolveDependencies(p, "a", config, [])).rejects.toThrow(
      "circular",
    );
  });
  it("rejects incompatible loaders and games", async () => {
    const v = version("a");
    v.loaders = ["forge"];
    await expect(
      resolveDependencies(provider({ a: v }), "a", config, []),
    ).rejects.toThrow("compatible");
  });
  it("rejects incompatible selected projects", async () => {
    const p = provider({
      a: version("a", [
        { projectId: "b", versionId: null, type: "required" },
        { projectId: "b", versionId: null, type: "incompatible" },
      ]),
      b: version("b"),
    });
    await expect(resolveDependencies(p, "a", config, [])).rejects.toThrow(
      "conflicts",
    );
  });
  it.each([
    "http://cdn.modrinth.com/a",
    "https://cdn.modrinth.com.evil.invalid/a",
    "https://127.0.0.1/a",
    "https://user:password@cdn.modrinth.com/a",
    "https://cdn.modrinth.com:8443/a",
  ])("restricts archive downloads %s", (url) =>
    expect(() => validateDownloadUrl(url)).toThrow(),
  );
  it("keeps a newest verified recovery point even when the storage budget is small", () => {
    const backups = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      bytes: 100,
      createdAt: new Date(100000000 + i * 86400000).toISOString(),
    }));
    expect([
      ...retainedBackups(
        backups as import("../packages/shared/src/index.ts").Backup[],
        { keepLast: 2, daily: 0, weekly: 0, maxBytes: 50 },
      ),
    ]).toEqual(["4"]);
  });
});
