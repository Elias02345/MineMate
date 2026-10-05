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
  const result = (await response.json()) as T & {
    code?: string;
    message?: string;
    detail?: string;
  };
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
