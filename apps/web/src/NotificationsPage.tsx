import { useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";
import { useI18n } from "./i18n.tsx";
import { ErrorNotice, useAction } from "./hooks.tsx";
import {
  MinePanel,
  MineButton,
  MineEmpty,
  MineNotice,
} from "../../../packages/ui/src/index.tsx";
export function NotificationsPage() {
  const { t } = useI18n(),
    action = useAction(),
    q = useQuery({
      queryKey: ["notifications"],
      queryFn: () =>
        api<
          {
            id: string;
            level: "info" | "warning" | "error";
            message: string;
            created_at: string;
            read: number;
          }[]
        >("/notifications"),
    });
  return (
    <div className="page">
      <div className="page-heading">
        <h1>{t("notifications")}</h1>
      </div>
      <MinePanel>
        <ErrorNotice error={q.error ?? action.error} />
        {!q.data?.length ? (
          <MineEmpty
            icon="bee"
            title={t("notificationsEmpty")}
            description={t("notificationsEmptyBody")}
          />
        ) : (
          q.data.map((n) => (
            <div
              key={n.id}
              className={"notification-card " + (n.read ? "read" : "")}
            >
              <MineNotice tone={n.level === "info" ? "success" : n.level}>
                <b>{n.message}</b>
                <small>{new Date(n.created_at).toLocaleString()}</small>
                {!n.read && (
                  <MineButton
                    variant="ghost"
                    onClick={() =>
                      action.mutate({ path: `/notifications/${n.id}/read` })
                    }
                  >
                    {t("markRead")}
                  </MineButton>
                )}
              </MineNotice>
            </div>
          ))
        )}
      </MinePanel>
    </div>
  );
}
