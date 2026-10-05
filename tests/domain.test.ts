import { describe, it, expect } from "vitest";
import { relativeSafe } from "../packages/backup/src/paths.ts";
import {
  javaRuntime,
  transition,
  can,
  type User,
} from "../packages/shared/src/index.ts";
import { assertOwned, labels } from "../packages/docker/src/index.ts";
import { validateProperties } from "../packages/settings-schema/src/index.ts";
import { validateEntry } from "../packages/backup/src/archive.ts";
import { varint, readVarint } from "../packages/gateway-protocol/src/index.ts";
describe("security and domain boundaries", () => {
  it.each(["../secret", "/etc/passwd", "x/../y", "C:/windows", "x\\y", "a\0b"])(
    "rejects unsafe path %s",
    (p) => expect(() => relativeSafe(p)).toThrow(),
  );
  it("selects safe Java runtimes", () => {
    expect(javaRuntime("1.20.4")).toBe("17");
    expect(javaRuntime("1.20.5")).toBe("21");
    expect(javaRuntime("1.16.5")).toBe("8");
    expect(javaRuntime("26.1")).toBe("25");
  });
  it("rejects invalid lifecycle transitions", () => {
    expect(transition("STOPPED", "STARTING")).toBe("STARTING");
    expect(() => transition("DELETING", "RUNNING")).toThrow();
  });
  it("enforces user permissions and disabled users", () => {
    const u: User = {
      id: "u",
      username: "Alex",
      role: "member",
      enabled: true,
      createdAt: "",
    };
    expect(can(u, ["view"], "delete")).toBe(false);
    expect(can({ ...u, role: "owner", enabled: false }, [], "view")).toBe(
      false,
    );
  });
  it("requires installation and server ownership", () => {
    const Config = { Image: "test", Labels: labels("installation", "world") };
    expect(() => assertOwned({ Config }, "other", "world")).toThrow();
    expect(() =>
      assertOwned({ Config }, "installation", "world"),
    ).not.toThrow();
  });
  it("validates typed settings and protects RCON", () => {
    expect(() =>
      validateProperties({ "rcon.password": "leak" }, "JAVA", true),
    ).toThrow();
    expect(() => validateProperties({ "max-players": "-1" }, "JAVA")).toThrow();
    expect(() =>
      validateProperties({ gamemode: "survival" }, "BEDROCK"),
    ).not.toThrow();
  });
  it("rejects symlink archives and expansion bombs", () => {
    const entry = {
      fileName: "link",
      uncompressedSize: 1,
      compressedSize: 1,
      externalFileAttributes: 0xa000 << 16,
      generalPurposeBitFlag: 0,
    };
    expect(() => validateEntry(entry)).toThrow();
    expect(() =>
      validateEntry({
        ...entry,
        externalFileAttributes: 0,
        fileName: "../escape",
      }),
    ).toThrow();
    expect(() =>
      validateEntry({
        ...entry,
        externalFileAttributes: 0,
        uncompressedSize: 20000,
      }),
    ).toThrow();
  });
  it.each([0, 127, 128, 255, 2147483647, -1])("frames varints %i", (v) =>
    expect(readVarint(varint(v))?.value).toBe(v),
  );
});
