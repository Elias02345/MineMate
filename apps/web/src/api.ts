let csrf = "";
export const setCsrf = (value: string | null) => {
  csrf = value ?? "";
};
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public detail?: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      "x-csrf-token": csrf,
      ...options.headers,
    },
  });
  let result: T & {
    code?: string;
    message?: string;
    detail?: string;
  };
  try {
    result = (await response.json()) as typeof result;
  } catch {
    throw new ApiError(
      "UPLOAD_RESPONSE",
      response.status === 413
        ? "A reverse proxy rejected the upload chunk. Allow request bodies of at least 2 MB."
        : `The server returned an unreadable response (HTTP ${response.status}). Check the reverse proxy and try again.`,
    );
  }
  if (!response.ok)
    throw new ApiError(
      result.code ?? "REQUEST",
      result.message ?? "Request failed",
      result.detail,
    );
  return result;
}
export const mutate = <T>(path: string, body?: unknown, method = "POST") =>
  api<T>(path, { method, body: JSON.stringify(body ?? {}) });
export function upload<T>(
  path: string,
  body: FormData,
  progress: (percent: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/v1" + path);
    request.setRequestHeader("x-csrf-token", csrf);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () =>
      reject(
        new ApiError(
          "UPLOAD_NETWORK",
          "Upload interrupted. Check the connection and try again.",
        ),
      );
    request.onload = () => {
      let result: T & { code?: string; message?: string; detail?: string };
      try {
        result = JSON.parse(request.responseText) as typeof result;
      } catch {
        reject(
          new ApiError(
            "UPLOAD_RESPONSE",
            "The upload could not be completed. Check the file size and any reverse proxy upload limits.",
          ),
        );
        return;
      }
      if (request.status < 200 || request.status >= 300)
        reject(
          new ApiError(
            result.code ?? "UPLOAD",
            result.message ?? "Upload failed",
            result.detail,
          ),
        );
      else resolve(result);
    };
    request.send(body);
  });
}
