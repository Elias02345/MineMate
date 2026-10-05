import type { Operation } from "../../../packages/shared/src/index.ts";
import { api, upload } from "./api.ts";

export async function waitForOperation(
  operation: Operation,
  serverId: string,
  phase: (message: string) => void,
) {
  for (let i = 0; i < 900; i++) {
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
): "uploadCountError" | "uploadSizeError" | "uploadDuplicateError" | null {
  if (files.length > (folder ? 10000 : 100)) return "uploadCountError";
  if (
    files.some((f) => f.size > 512 * 1024 ** 2) ||
    files.reduce((n, f) => n + f.size, 0) > 20 * 1024 ** 3
  )
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
) {
  const body = new FormData();
  if (kind === "world-folder")
    body.append(
      "relativePaths",
      JSON.stringify(files.map((f) => f.webkitRelativePath || f.name)),
    );
  for (const file of files) body.append("file", file);
  return upload<{ operation: Operation }>(
    `/servers/${serverId}/uploads?kind=${kind}&directory=${encodeURIComponent(directory)}&confirm=true${software ? "&software=" + encodeURIComponent(software) : ""}`,
    body,
    progress,
  );
}
