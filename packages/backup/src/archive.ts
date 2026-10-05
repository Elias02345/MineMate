import { createReadStream, createWriteStream } from "node:fs";
import { readdir, lstat, mkdir, rm, stat, rename } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import yazl from "yazl";
import { AppError, type Backup } from "../../shared/src/index.ts";
import { relativeSafe, safePath } from "./paths.ts";
export const archiveLimits = {
  files: 100000,
  bytes: 20 * 1024 ** 3,
  fileBytes: 4 * 1024 ** 3,
  ratio: 1000,
};
export interface ArchiveEntry {
  name: string;
  bytes: number;
  directory: boolean;
}
export async function walk(
  root: string,
  relative = "",
): Promise<{ path: string; bytes: number }[]> {
  const result: { path: string; bytes: number }[] = [];
  for (const entry of await readdir(await safePath(root, relative), {
    withFileTypes: true,
  })) {
    const p = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink())
      throw new AppError("UNSAFE_PATH", "Symbolic links cannot be archived.");
    if (entry.isDirectory()) result.push(...(await walk(root, p)));
    else if (entry.isFile()) {
      const s = await lstat(await safePath(root, p));
      result.push({ path: p, bytes: s.size });
    } else
      throw new AppError("UNSAFE_PATH", "Special files cannot be archived.");
    if (result.length > archiveLimits.files)
      throw new AppError("ARCHIVE_LIMIT", "There are too many files.");
  }
  return result;
}
export async function hashFile(file: string, algorithm = "sha256") {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}
export async function createArchive(root: string, output: string) {
  const files = await walk(root),
    zip = new yazl.ZipFile();
  for (const f of files)
    zip.addFile(await safePath(root, f.path), f.path, { mode: 0o100600 });
  const done = pipeline(
    zip.outputStream,
    createWriteStream(output, { flags: "wx", mode: 0o600 }),
  );
  zip.end();
  await done;
  return { hash: await hashFile(output), bytes: (await stat(output)).size };
}
export function validateEntry(
  entry: Pick<
    yauzl.Entry,
    | "fileName"
    | "uncompressedSize"
    | "compressedSize"
    | "externalFileAttributes"
    | "generalPurposeBitFlag"
  >,
): ArchiveEntry {
  const directory = entry.fileName.endsWith("/"),
    name = directory ? entry.fileName.slice(0, -1) : entry.fileName;
  relativeSafe(name);
  if (!name || name.length > 512)
    throw new AppError("UNSAFE_ARCHIVE", "Invalid archive path.");
  const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
  if (mode && mode !== 0x8000 && mode !== 0x4000)
    throw new AppError(
      "UNSAFE_ARCHIVE",
      "Links and special files cannot be imported.",
    );
  if (entry.generalPurposeBitFlag & 1)
    throw new AppError(
      "UNSAFE_ARCHIVE",
      "Encrypted archives cannot be imported.",
    );
  if (
    entry.uncompressedSize > archiveLimits.fileBytes ||
    entry.uncompressedSize / Math.max(1, entry.compressedSize) >
      archiveLimits.ratio
  )
    throw new AppError(
      "ARCHIVE_LIMIT",
      "This archive exceeds safe expansion limits.",
    );
  return { name, bytes: entry.uncompressedSize, directory };
}
async function processArchive(
  file: string,
  destination?: string,
): Promise<ArchiveEntry[]> {
  if (destination) await mkdir(destination, { recursive: true, mode: 0o700 });
  return new Promise((resolve, reject) => {
    yauzl.open(
      file,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (err, zip) => {
        if (err || !zip) {
          reject(
            new AppError(
              "INVALID_ARCHIVE",
              "This file is not a valid ZIP archive.",
            ),
          );
          return;
        }
        const entries: ArchiveEntry[] = [],
          names = new Set<string>();
        let expanded = 0,
          failed = false;
        const fail = (e: unknown) => {
          if (failed) return;
          failed = true;
          zip.close();
          reject(e);
        };
        zip.on("error", fail);
        zip.on("end", () => {
          if (!failed) resolve(entries);
        });
        zip.on("entry", (entry: yauzl.Entry) => {
          void (async () => {
            const e = validateEntry(entry);
            expanded += e.bytes;
            if (
              expanded > archiveLimits.bytes ||
              entries.length >= archiveLimits.files
            )
              throw new AppError("ARCHIVE_LIMIT", "This archive is too large.");
            if (names.has(e.name))
              throw new AppError(
                "INVALID_ARCHIVE",
                "Duplicate archive paths are not allowed.",
              );
            names.add(e.name);
            entries.push(e);
            if (destination) {
              const target = await safePath(destination, e.name, true);
              if (e.directory)
                await mkdir(target, { recursive: true, mode: 0o700 });
              else {
                await mkdir(path.dirname(target), {
                  recursive: true,
                  mode: 0o700,
                });
                const stream = await new Promise<
                  import("node:stream").Readable
                >((res, rej) =>
                  zip.openReadStream(entry, (error, s) =>
                    error || !s ? rej(error) : res(s),
                  ),
                );
                let count = 0;
                stream.on("data", (b: Buffer) => {
                  count += b.length;
                  if (count > e.bytes)
                    stream.destroy(
                      new AppError(
                        "ARCHIVE_LIMIT",
                        "Archive size does not match its manifest.",
                      ),
                    );
                });
                await pipeline(
                  stream,
                  createWriteStream(target, { flags: "wx", mode: 0o600 }),
                );
              }
            }
            zip.readEntry();
          })().catch(fail);
        });
        zip.readEntry();
      },
    );
  });
}
export function inspectArchive(file: string) {
  return processArchive(file);
}
export async function extractArchive(file: string, destination: string) {
  try {
    await inspectArchive(file);
    return await processArchive(file, destination);
  } catch (e) {
    await rm(destination, { recursive: true, force: true });
    throw e;
  }
}
export async function swapDirectory(staging: string, target: string) {
  const previous = target + ".old-" + randomUUID();
  await rename(target, previous);
  try {
    await rename(staging, target);
  } catch (e) {
    await rename(previous, target);
    throw e;
  }
  return previous;
}
export interface Retention {
  keepLast: number;
  daily: number;
  weekly: number;
  maxBytes: number;
}
export function retainedBackups(
  backups: Backup[],
  policy: Retention,
): Set<string> {
  const sorted = [...backups].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
    keep = new Set(
      sorted.slice(0, Math.max(1, policy.keepLast)).map((b) => b.id),
    ),
    days = new Set<string>(),
    weeks = new Set<string>();
  for (const b of sorted) {
    const date = new Date(b.createdAt),
      day = date.toISOString().slice(0, 10),
      week = String(Math.floor(date.getTime() / (7 * 86400000)));
    if (days.size < policy.daily && !days.has(day)) {
      days.add(day);
      keep.add(b.id);
    }
    if (weeks.size < policy.weekly && !weeks.has(week)) {
      weeks.add(week);
      keep.add(b.id);
    }
  }
  if (policy.maxBytes > 0) {
    let bytes = 0;
    for (const b of sorted.filter((b) => keep.has(b.id))) {
      if (bytes + b.bytes > policy.maxBytes && bytes > 0) keep.delete(b.id);
      else bytes += b.bytes;
    }
  }
  return keep;
}

/** Read one bounded member without exposing an archive's paths to the filesystem. */
export async function readArchiveMember(
  file: string,
  name: string,
  maxBytes = 2 * 1024 ** 2,
): Promise<string | null> {
  relativeSafe(name);
  return new Promise((resolve, reject) =>
    yauzl.open(
      file,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) {
          reject(
            new AppError(
              "INVALID_ARCHIVE",
              "This file is not a valid ZIP archive.",
            ),
          );
          return;
        }
        let found = false;
        zip.on("error", reject);
        zip.on("end", () => {
          if (!found) resolve(null);
        });
        zip.on("entry", (entry) => {
          try {
            validateEntry(entry);
            if (entry.fileName !== name) {
              zip.readEntry();
              return;
            }
            found = true;
            if (entry.uncompressedSize > maxBytes)
              throw new AppError(
                "ARCHIVE_LIMIT",
                "The content manifest is too large.",
              );
            zip.openReadStream(entry, (e, stream) => {
              if (e || !stream) {
                zip.close();
                reject(e);
                return;
              }
              const chunks: Buffer[] = [];
              let bytes = 0;
              stream.on("data", (b: Buffer) => {
                bytes += b.length;
                if (bytes > maxBytes)
                  stream.destroy(
                    new AppError(
                      "ARCHIVE_LIMIT",
                      "The content manifest is too large.",
                    ),
                  );
                else chunks.push(b);
              });
              stream.on("error", reject);
              stream.on("end", () => {
                zip.close();
                resolve(Buffer.concat(chunks).toString("utf8"));
              });
            });
          } catch (e) {
            zip.close();
            reject(e);
          }
        });
        zip.readEntry();
      },
    ),
  );
}
