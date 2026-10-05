import { useScene } from "./Experience.tsx";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";
import { useI18n } from "./i18n.tsx";
import { ErrorNotice, useAction } from "./hooks.tsx";
import {
  MinePanel,
  MineButton,
  MineEmpty,
  MineInput,
  MineModal,
  MineBadge,
  Asset,
} from "../../../packages/ui/src/index.tsx";
import type { User } from "../../../packages/shared/src/index.ts";
export function UsersPage() {
  useScene("users");
  const { t } = useI18n(),
    action = useAction(),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState<User | null>(null),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [role, setRole] = useState<"admin" | "member">("member"),
    [enabled, setEnabled] = useState(true);
  const q = useQuery({
    queryKey: ["users"],
    queryFn: () => api<User[]>("/users"),
  });
  return (
    <div className="page">
      <div className="page-heading">
        <span className="eyebrow">{t("tagline")}</span>
        <h1>{t("users")}</h1>
        <p>{t("userDescription")}</p>
      </div>
      <MinePanel>
        <div className="section-heading">
          <h2>{t("users")}</h2>
          <MineButton
            onClick={() => {
              setSelected(null);
              setUsername("");
              setPassword("");
              setRole("member");
              setEnabled(true);
              setOpen(true);
            }}
          >
            {t("userCreate")}
          </MineButton>
        </div>
        <ErrorNotice error={q.error ?? action.error} />
        {!q.data?.length ? (
          <MineEmpty
            icon="creeper"
            title={t("userEmpty")}
            description={t("userDescription")}
          />
        ) : (
          <div className="user-grid">
            {q.data.map((u) => (
              <article className="user-card" key={u.id}>
                <Asset
                  name={u.role === "owner" ? "diamond" : "creeper"}
                  size={46}
                />
                <h3>{u.username}</h3>
                <MineBadge tone={u.enabled ? "grass" : "stone"}>
                  {t(
                    u.role === "member"
                      ? "member"
                      : u.role === "owner"
                        ? "owner"
                        : "admin",
                  )}
                </MineBadge>
                <MineButton
                  variant="secondary"
                  onClick={() => {
                    setSelected(u);
                    setUsername(u.username);
                    setPassword("");
                    setRole(u.role === "admin" ? "admin" : "member");
                    setEnabled(u.enabled);
                    setOpen(true);
                  }}
                >
                  {t("edit")}
                </MineButton>
              </article>
            ))}
          </div>
        )}
      </MinePanel>
      <MineModal
        open={open}
        onOpenChange={setOpen}
        title={t(selected ? "edit" : "userCreate")}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action.mutate(
              {
                path: selected ? "/users/" + selected.id : "/users",
                method: selected ? "PATCH" : "POST",
                body: selected
                  ? {
                      ...(selected.role !== "owner" ? { role, enabled } : {}),
                      ...(password ? { password } : {}),
                    }
                  : { username, password, role },
              },
              { onSuccess: () => setOpen(false) },
            );
          }}
        >
          {!selected && (
            <MineInput
              label={t("username")}
              value={username}
              minLength={3}
              maxLength={48}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          )}
          <MineInput
            label={t(selected ? "passwordReset" : "password")}
            type="password"
            value={password}
            minLength={12}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required={!selected}
          />
          {selected?.role !== "owner" && (
            <>
              <label className="field">
                <span>{t("role")}</span>
                <select
                  value={role}
                  onChange={(e) =>
                    setRole(e.target.value as "admin" | "member")
                  }
                >
                  <option value="member">{t("member")}</option>
                  <option value="admin">{t("admin")}</option>
                </select>
              </label>
              {selected && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  {t("enabled")}
                </label>
              )}
            </>
          )}
          <MineButton type="submit" disabled={action.isPending}>
            {t("save")}
          </MineButton>
          <ErrorNotice error={action.error} />
        </form>
      </MineModal>
    </div>
  );
}
