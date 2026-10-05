import { lstat, realpath, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AppError, idSchema } from "../../shared/src/index.ts";

export function relativeSafe(input: string): string {
  if (
    input.includes("\0") ||
    input.includes("\\") ||
    path.isAbsolute(input) ||
    /^[a-z]:/i.test(input) ||
    input.split("/").some((p) => p === ".." || p === ".")
  )
    throw new AppError("UNSAFE_PATH", "This path is outside your world.");
  return input;
}
export async function safePath(
  root: string,
  input: string,
  allowMissing = false,
): Promise<string> {
  relativeSafe(input);
  const canonical = await realpath(root);
  let current = canonical;
  for (const part of input.split("/").filter(Boolean)) {
    current = path.join(current, part);
    try {
      const s = await lstat(current);
      if (s.isSymbolicLink())
        throw new AppError("UNSAFE_PATH", "Symbolic links are not allowed.");
    } catch (e) {
      if (allowMissing && (e as NodeJS.ErrnoException).code === "ENOENT")
        continue;
      throw e;
    }
  }
  if (current !== canonical && !current.startsWith(canonical + path.sep))
    throw new AppError("UNSAFE_PATH", "Path escapes the data directory.");
  return current;
}
export async function atomicWrite(
  filename: string,
  content: string | Buffer,
  mode = 0o600,
) {
  const temp = filename + "." + randomUUID() + ".tmp";
  try {
    const file = await open(temp, "wx", mode);
    try {
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, filename);
  } finally {
    await rm(temp, { force: true });
  }
}
export class DataPaths {
  constructor(
    readonly root: string,
    readonly hostRoot: string,
  ) {}
  async initialize() {
    for (const p of [
      "app/database",
      "app/config",
      "app/secrets",
      "app/logs",
      "servers",
      "cache/mods",
      "cache/plugins",
      "cache/modpacks",
      "cache/minecraft",
      "cache/downloads",
      "gateway",
      "assets",
      "tmp",
    ])
      await mkdir(path.join(this.root, p), { recursive: true, mode: 0o700 });
  }
  server(id: string, area = "server") {
    idSchema.parse(id);
    if (
      ![
        "server",
        "backups",
        "snapshots",
        "uploads",
        "imports",
        "metadata",
      ].includes(area)
    )
      throw new AppError("UNSAFE_PATH", "Invalid data area");
    return path.join(this.root, "servers", id, area);
  }
  async createServer(id: string) {
    for (const area of [
      "server",
      "backups",
      "snapshots",
      "uploads",
      "imports",
      "metadata",
    ])
      await mkdir(this.server(id, area), { recursive: true, mode: 0o700 });
  }
  async hostServer(id: string) {
    idSchema.parse(id);
    if (
      !path.isAbsolute(this.hostRoot) ||
      this.hostRoot === "/" ||
      this.hostRoot.includes("\0")
    )
      throw new AppError(
        "HOST_PATH",
        "The installer must configure the absolute host data path.",
      );
    await safePath(this.root, `servers/${id}/server`);
    return path.join(this.hostRoot, "servers", id, "server");
  }
}

/** Anchor every path component to an open directory on Linux, including during rename races. */
export async function openWorldFile(root: string, input: string) {
  relativeSafe(input);
  const parts = input.split("/").filter(Boolean);
  if (!parts.length) throw new AppError("FILE", "Choose a file.");
  const { constants } = await import("node:fs");
  let parent = await open(
    await realpath(root),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    for (const part of parts.slice(0, -1)) {
      const next = await open(
        `/proc/self/fd/${parent.fd}/${part}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      await parent.close();
      parent = next;
    }
    const file = await open(
      `/proc/self/fd/${parent.fd}/${parts.at(-1)!}`,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const info = await file.stat();
    if (!info.isFile()) {
      await file.close();
      throw new AppError("FILE", "Choose a regular file.");
    }
    return file;
  } catch (e) {
    if (["ELOOP", "ENOTDIR"].includes((e as NodeJS.ErrnoException).code ?? ""))
      throw new AppError("UNSAFE_PATH", "Symbolic links are not allowed.");
    throw e;
  } finally {
    await parent.close();
  }
}
export async function readWorldText(
  root: string,
  input: string,
  maxBytes = 2 * 1024 ** 2,
) {
  const file = await openWorldFile(root, input);
  try {
    if ((await file.stat()).size > maxBytes)
      throw new AppError(
        "FILE_LIMIT",
        "Use Download for files larger than 2 MB.",
      );
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}
