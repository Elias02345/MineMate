import { it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  apiRequest,
  downloadVerified,
} from "../packages/mod-platforms/src/index.ts";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("removes a corrupt staged download after a hash mismatch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemate-download-")),
    file = path.join(root, "content.jar");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("wrong content")),
  );
  try {
    await expect(
      downloadVerified(
        "https://cdn.modrinth.com/test.jar",
        file,
        "0".repeat(128),
        "sha512",
      ),
    ).rejects.toThrow("integrity");
    await expect(stat(file)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("rejects a CDN redirect to a private or unsupported destination", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/secret" },
        }),
    ),
  );
  await expect(
    downloadVerified(
      "https://cdn.modrinth.com/test.jar",
      "/tmp/unused-download",
      "0".repeat(128),
      "sha512",
    ),
  ).rejects.toThrow("unsupported");
});
it("bounds retries and reports an unavailable external platform", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async () => {
    throw new Error("controlled outage");
  });
  vi.stubGlobal("fetch", fetch);
  const result = expect(
    apiRequest("https://api.modrinth.com/v2/controlled-outage-test"),
  ).rejects.toThrow("unavailable");
  await vi.runAllTimersAsync();
  await result;
  expect(fetch).toHaveBeenCalledTimes(4);
});
