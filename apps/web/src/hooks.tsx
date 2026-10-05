import { useEffect, useState } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { mutate, ApiError } from "./api.ts";
import { useI18n } from "./i18n.tsx";
import { MineNotice } from "../../../packages/ui/src/index.tsx";
import type { Event, Server } from "../../../packages/shared/src/index.ts";
import { sound } from "../../../packages/ui/src/sound.ts";
export function ErrorNotice({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (!error) return null;
  return (
    <MineNotice tone="error">
      <b>{t("error")}</b>
      <details>
        <summary>{t("details")}</summary>
        <pre>
          {error instanceof Error ? error.message : String(error)}
          {error instanceof ApiError && error.detail ? "\n" + error.detail : ""}
        </pre>
      </details>
    </MineNotice>
  );
}
export function useAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      path,
      body,
      method,
    }: {
      path: string;
      body?: unknown;
      method?: string;
    }) => mutate(path, body, method),
    onSuccess: () => {
      void client.invalidateQueries();
      void sound.play("success");
    },
    onError: () => {
      void sound.play("warning");
    },
  });
}
export function useRealtime() {
  const client = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let active = true,
      socket: WebSocket | null = null,
      timer: ReturnType<typeof setTimeout>,
      attempt = 0;
    function connect() {
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/v1/events`,
      );
      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
        void client.invalidateQueries();
      };
      socket.onmessage = (message) => {
        const event = JSON.parse(String(message.data)) as Event;
        if (event.type === "server.metrics" && event.serverId) {
          client.setQueryData<Server[]>(["servers"], (old) =>
            old?.map((s) =>
              s.id === event.serverId
                ? { ...s, metrics: event.data as Server["metrics"] }
                : s,
            ),
          );
          client.setQueryData<Server>(["server", event.serverId], (old) =>
            old ? { ...old, metrics: event.data as Server["metrics"] } : old,
          );
        } else if (event.type === "server.status.changed") {
          void client.invalidateQueries({ queryKey: ["servers"] });
          void client.invalidateQueries({
            queryKey: ["server", event.serverId],
          });
        } else if (event.type === "server.operation.progress") {
          void client.invalidateQueries({
            queryKey: ["operations", event.serverId],
          });
          const operation =
            event.data as import("../../../packages/shared/src/index.ts").Operation;
          if (
            ["SUCCEEDED", "FAILED", "INTERRUPTED"].includes(operation.status)
          ) {
            for (const key of [
              "server",
              "backups",
              "content",
              "settings",
              "files",
              "worlds",
              "updates",
              "update-history",
            ])
              void client.invalidateQueries({
                queryKey: [key, event.serverId],
              });
            void client.invalidateQueries({ queryKey: ["servers"] });
          }
        } else if (event.type === "backup.completed") {
          void client.invalidateQueries({
            queryKey: ["backups", event.serverId],
          });
          void client.invalidateQueries({ queryKey: ["notifications"] });
        } else if (event.type === "server.permissions.changed") {
          void client.invalidateQueries();
        }
        window.dispatchEvent(
          new CustomEvent("minemate-event", { detail: event }),
        );
      };
      socket.onclose = () => {
        setConnected(false);
        if (active)
          timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** attempt++));
      };
    }
    connect();
    const fallback = setInterval(() => {
      if (socket?.readyState !== WebSocket.OPEN)
        void client.invalidateQueries();
    }, 15000);
    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(fallback);
      socket?.close();
    };
  }, [client]);
  return connected;
}

export function useServerBusy(id: string) {
  const q = useQuery({
    queryKey: ["operations", id],
    queryFn: () =>
      import("./api.ts").then(({ api }) =>
        api<import("../../../packages/shared/src/index.ts").Operation[]>(
          `/operations?serverId=${id}`,
        ),
      ),
  });
  return (
    q.data?.some((o) => o.status === "RUNNING" || o.status === "QUEUED") ?? true
  );
}
