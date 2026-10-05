import { it, expect } from "vitest";
import net from "node:net";
import { javaStatus } from "../packages/gateway-protocol/src/index.ts";
import { fixtureProtocol } from "./fixtures/protocol.ts";
it("rejects a readiness connection closed before any response", async () => {
  const server = net.createServer((s) => s.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await expect(
      javaStatus("127.0.0.1", (server.address() as net.AddressInfo).port),
    ).rejects.toThrow("closed");
  } finally {
    server.close();
  }
});
it("reads a framed Java status response", async () => {
  const server = await fixtureProtocol(0);
  try {
    expect(
      await javaStatus("127.0.0.1", (server.address() as net.AddressInfo).port),
    ).toEqual({ players: 0, names: [] });
  } finally {
    server.close();
  }
});
