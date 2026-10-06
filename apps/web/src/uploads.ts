import type { Operation } from "../../../packages/shared/src/index.ts";
import { bytesToHex } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ApiError, api, mutate } from "./api.ts";

const CHUNK = 1024 * 1024;
type UploadState = {
  id: string;
  files: { offset: number; validated: boolean }[];
  operation?: Operation;
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForOperation(
  operation: Operation,
  serverId: string,
  phase: (message: string) => void,
) {
  for (let i = 0; i < 3600; i++) {
    const operations = await api<Operation[]>(
        `/operations?serverId=${serverId}`,
      ),
      current = operations.find((o) => o.id === operation.id) ?? operation;
    phase(current.phase);
    if (current.status === "SUCCEEDED") return current;
    if (current.status === "FAILED" || current.status === "INTERRUPTED")
      throw new Error(current.error ?? current.phase);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    "The operation is still running. Follow its progress in Activity before retrying.",
  );
}
export function selectionError(
  files: File[],
  folder: boolean,
): "uploadSizeError" | "uploadDuplicateError" | null {
  if (files.reduce((n, f) => n + f.size, 0) > 20 * 1024 ** 3)
    return "uploadSizeError";
  const names = files.map((f) =>
    folder ? f.webkitRelativePath || f.name : f.name,
  );
  return new Set(names).size !== names.length ? "uploadDuplicateError" : null;
}
export async function uploadSelection(
  serverId: string,
  kind: string,
  files: File[],
  progress: (percent: number) => void,
  software?: string,
  directory = "",
  phase?: (message: string) => void,
) {
  const selected = files.map((file) => ({
    name: file.name,
    size: file.size,
    relativePath:
      kind === "world-folder"
        ? file.webkitRelativePath || file.name
        : undefined,
    lastModified: file.lastModified,
  }));
  const spec = { kind, software, directory, files: selected, confirm: true };
  const key = `minemate-upload:${serverId}:${kind}:${directory}:${software || ""}`;
  const base = `/servers/${serverId}/upload-sessions`;
  let state: UploadState | undefined;
  let resumeFrom: string | undefined;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null") as {
      id: string;
      spec: typeof spec;
    } | null;
    resumeFrom = saved?.id;
    if (saved && JSON.stringify(saved.spec) === JSON.stringify(spec))
      state = await api<UploadState>(`${base}/${saved.id}`);
  } catch {
    /* The session expired, or storage is unavailable. Start fresh. */
  }
  if (
    state?.operation &&
    ["FAILED", "INTERRUPTED"].includes(state.operation.status)
  ) {
    state = undefined;
    resumeFrom = undefined;
  }
  if (!state) {
    state = await mutate<UploadState>(base, { ...spec, resumeFrom });
    try {
      localStorage.setItem(key, JSON.stringify({ id: state.id, spec }));
    } catch {
      /* Private browsing can disable storage. */
    }
  }
  if (state.operation) return { operation: state.operation };
  let active: UploadState = state;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const acknowledged = () =>
    active.files.reduce((sum, file) => sum + file.offset, 0);
  const report = () =>
    progress(total ? Math.floor((acknowledged() / total) * 100) : 100);
  report();
  const transfer = async (index: number) => {
    const file = files[index]!;
    phase?.(`Transferring ${index + 1}/${files.length}: ${file.name}`);
    while (active.files[index]!.offset < file.size) {
      const offset = active.files[index]!.offset;
      const buffer = await file.slice(offset, offset + CHUNK).arrayBuffer();
      const hash = bytesToHex(sha256(new Uint8Array(buffer)));
      let sent = false;
      for (let attempt = 0; attempt < 5 && !sent; attempt++) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 90000);
          try {
            const result = await api<{ offset: number }>(
              `${base}/${active.id}/files/${index}`,
              {
                method: "PUT",
                body: buffer,
                signal: controller.signal,
                headers: {
                  "Content-Type": "application/octet-stream",
                  "x-upload-offset": String(offset),
                  "x-upload-sha256": hash,
                },
              },
            );
            active.files[index]!.offset = result.offset;
            sent = true;
          } finally {
            clearTimeout(timeout);
          }
        } catch (error) {
          if (attempt === 4) throw error;
          await pause(Math.min(8000, 500 * 2 ** attempt));
          active = await api<UploadState>(`${base}/${active.id}`);
          if (active.files[index]!.offset !== offset) sent = true;
        }
      }
      report();
    }
  };
  for (let index = 0; index < files.length; index++) await transfer(index);
  for (let index = 0; index < files.length; index++) {
    const file = files[index]!;
    phase?.(`Checking ${index + 1}/${files.length}: ${file.name}`);
    const digest = sha256.create();
    for (let offset = 0; offset < file.size; offset += CHUNK)
      digest.update(
        new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer()),
      );
    const checksum = bytesToHex(digest.digest());
    try {
      await mutate(`${base}/${active.id}/files/${index}/validate`, {
        sha256: checksum,
      });
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "UPLOAD_HASH")
        throw error;
      await mutate(`${base}/${active.id}/files/${index}/reset`);
      active.files[index] = { offset: 0, validated: false };
      report();
      await transfer(index);
      await mutate(`${base}/${active.id}/files/${index}/validate`, {
        sha256: checksum,
      });
    }
    active.files[index]!.validated = true;
  }
  const result = await mutate<{ operation: Operation }>(
    `${base}/${active.id}/finish`,
  );
  try {
    localStorage.removeItem(key);
  } catch {
    /* Storage may be disabled. */
  }
  return result;
}
