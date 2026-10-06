import { Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api.ts";
import { useI18n, type TranslationKey } from "../i18n.tsx";
import { ErrorNotice, useAction } from "../hooks.tsx";
import { MinePanel, MineButton } from "../../../../packages/ui/src/index.tsx";
import {
  permissions,
  type Permission,
  type User,
  type Server,
} from "../../../../packages/shared/src/index.ts";
const permissionLabels: Record<Permission, TranslationKey> = {
  view: "overview",
  start: "start",
  stop: "stop",
  restart: "restart",
  console: "console",
  players: "players",
  settings: "settings",
  content: "content",
  files: "files",
  backups: "backups",
  update: "updates",
  delete: "delete",
};
export default function AccessPanel({ server: s }: { server: Server }) {
  const { t } = useI18n(),
    action = useAction(),
    [selected, setSelected] = useState(""),
    [grants, setGrants] = useState<Permission[]>([]),
    users = useQuery({
      queryKey: ["users"],
      queryFn: () => api<User[]>("/users"),
    }),
    q = useQuery({
      queryKey: ["permissions", s.id],
      queryFn: () =>
        api<{ userId: string; permission: Permission }[]>(
          `/servers/${s.id}/permissions`,
        ),
    });
  useEffect(() => {
    if (q.data)
      setGrants(
        q.data.filter((g) => g.userId === selected).map((g) => g.permission),
      );
  }, [q.data, selected]);
  return (
    <MinePanel>
      <h2>{t("permissions")}</h2>
      <p>{t("permissionHint")}</p>
      <p>{t("shareAccessHint")}</p>
      <Link to="/users">{t("manageMembers")}</Link>
      <label className="field">
        <span>{t("users")}</span>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">—</option>
          {users.data
            ?.filter((u) => u.role === "member")
            .map((u) => (
              <option value={u.id} key={u.id}>
                {u.username}
              </option>
            ))}
        </select>
      </label>
      <div className="button-row permission-presets">
        <MineButton
          variant="secondary"
          disabled={!selected || action.isPending}
          onClick={() => setGrants(["view"])}
        >
          {t("permissionViewer")}
        </MineButton>
        <MineButton
          variant="secondary"
          disabled={!selected || action.isPending}
          onClick={() =>
            setGrants([
              "view",
              "start",
              "stop",
              "restart",
              "console",
              "players",
            ])
          }
        >
          {t("permissionOperator")}
        </MineButton>
        <MineButton
          variant="ghost"
          disabled={!selected || action.isPending}
          onClick={() => setGrants([])}
        >
          {t("permissionRevokeAll")}
        </MineButton>
      </div>
      <div className="permission-grid">
        {permissions.map((p) => (
          <label className="checkbox" key={p}>
            <input
              type="checkbox"
              checked={grants.includes(p)}
              disabled={!selected || action.isPending}
              onChange={(e) =>
                setGrants(
                  e.target.checked
                    ? [...new Set<Permission>([...grants, "view", p])]
                    : p === "view"
                      ? []
                      : grants.filter((g) => g !== p),
                )
              }
            />
            {t(permissionLabels[p])}
          </label>
        ))}
      </div>
      <MineButton
        disabled={!selected || action.isPending}
        onClick={() =>
          action.mutate({
            path: `/servers/${s.id}/permissions`,
            method: "PUT",
            body: { userId: selected, permissions: grants },
          })
        }
      >
        {t("save")}
      </MineButton>
      <ErrorNotice error={users.error ?? q.error ?? action.error} />
    </MinePanel>
  );
}
