import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api.ts";
import { useI18n, type TranslationKey } from "../i18n.tsx";
import { ErrorNotice, useAction } from "../hooks.tsx";
import {
  MinePanel,
  MineButton,
  MineEmpty,
  MineInput,
  MineBadge,
  MineModal,
  Asset,
} from "../../../../packages/ui/src/index.tsx";
import type { Server } from "../../../../packages/shared/src/index.ts";
export default function PlayerPanel({ server: s }: { server: Server }) {
  const { t } = useI18n(),
    action = useAction(),
    [name, setName] = useState(""),
    [verb, setVerb] = useState("kick"),
    [confirm, setConfirm] = useState(false);
  const q = useQuery({
    queryKey: ["players", s.id],
    queryFn: () =>
      api<{
        online: string[];
        count: number | null;
        lists: Record<string, unknown>;
      }>(`/servers/${s.id}/players`),
  });
  const actions: TranslationKey[] =
    s.config.edition === "JAVA"
      ? ["kick", "op", "deop", "whitelist", "unwhitelist", "ban", "pardon"]
      : ["kick", "op", "deop"];
  return (
    <>
      <MinePanel>
        <div className="section-heading">
          <h2>{t("players")}</h2>
          <MineBadge>
            {q.data?.count ?? "—"} / {s.config.maxPlayers}
          </MineBadge>
        </div>
        <ErrorNotice error={q.error ?? action.error} />
        {!q.data?.online.length ? (
          <MineEmpty
            icon="creeper"
            title={t("playerEmpty")}
            description={t("playerEmptyBody")}
          />
        ) : (
          <div className="player-grid">
            {q.data.online.map((p) => (
              <div key={p} className="player-card">
                <Asset name="creeper" size={42} />
                <b>{p}</b>
                <MineBadge tone="grass">{t("online")}</MineBadge>
                <MineButton variant="secondary" onClick={() => setName(p)}>
                  {t("moderation")}
                </MineButton>
              </div>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setConfirm(true);
          }}
          className="form-grid"
        >
          <MineInput
            label={t("playerName")}
            value={name}
            maxLength={32}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <label className="field">
            <span>{t("moderation")}</span>
            <select value={verb} onChange={(e) => setVerb(e.target.value)}>
              {actions.map((a) => (
                <option value={a} key={a}>
                  {t(a)}
                </option>
              ))}
            </select>
          </label>
          <MineButton type="submit" disabled={!name || s.state !== "RUNNING"}>
            {t("confirm")}
          </MineButton>
        </form>
        <details>
          <summary>{t("details")}</summary>
          <pre>{JSON.stringify(q.data?.lists, null, 2)}</pre>
        </details>
      </MinePanel>
      <MineModal
        open={confirm}
        onOpenChange={setConfirm}
        title={t("moderationConfirm")}
      >
        <p>
          {name} · {t(verb as TranslationKey)}
        </p>
        <MineButton
          variant="danger"
          disabled={action.isPending}
          onClick={() =>
            action.mutate(
              {
                path: `/servers/${s.id}/players`,
                body: { action: verb, name, confirm: true },
              },
              { onSuccess: () => setConfirm(false) },
            )
          }
        >
          {t("confirm")}
        </MineButton>
        <ErrorNotice error={action.error} />
      </MineModal>
    </>
  );
}
