import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, mutate } from "../api.ts";
import { useI18n, type TranslationKey } from "../i18n.tsx";
import { ErrorNotice, useAction } from "../hooks.tsx";
import {
  MinePanel,
  MineButton,
  MineEmpty,
  MineInput,
  MineBadge,
  MineModal,
  MineNotice,
  MineProgress,
  Asset,
} from "../../../../packages/ui/src/index.tsx";
import { waitForOperation } from "../uploads.ts";
import type {
  Operation,
  Server,
} from "../../../../packages/shared/src/index.ts";
export default function PlayerPanel({ server: s }: { server: Server }) {
  const { t } = useI18n(),
    action = useAction(),
    client = useQueryClient(),
    [guestEnabled, setGuestEnabled] = useState<boolean | null>(null),
    [phase, setPhase] = useState(""),
    [output, setOutput] = useState(""),
    [name, setName] = useState(""),
    [verb, setVerb] = useState("kick"),
    [confirm, setConfirm] = useState(false);
  const q = useQuery({
    queryKey: ["players", s.id],
    refetchInterval: 10000,
    queryFn: () =>
      api<{
        online: string[];
        count: number | null;
        lists: Record<string, unknown>;
      }>(`/servers/${s.id}/players`),
  });
  const settings = useQuery({
    queryKey: ["settings", s.id],
    queryFn: () =>
      api<{ values: Record<string, string>; revision: string }>(
        `/servers/${s.id}/settings`,
      ),
    enabled: s.permissions.includes("settings"),
  });
  const guestKey = s.config.edition === "JAVA" ? "white-list" : "allow-list",
    currentEnabled = settings.data?.values[guestKey] === "true";
  const saveGuest = useMutation({
    mutationFn: async () => {
      const operation = await mutate<Operation>(
        `/servers/${s.id}/settings`,
        {
          values: { [guestKey]: String(guestEnabled) },
          revision: settings.data!.revision,
          restart: true,
        },
        "PUT",
      );
      await waitForOperation(operation, s.id, setPhase);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["settings", s.id] });
      await client.invalidateQueries({ queryKey: ["server", s.id] });
      setGuestEnabled(null);
    },
  });
  const entries = (file: string) => {
    const list = q.data?.lists[file];
    return Array.isArray(list)
      ? list.filter(
          (entry): entry is { name: string } =>
            entry && typeof entry.name === "string",
        )
      : [];
  };
  const lists: {
    file: string;
    label: TranslationKey;
    remove: TranslationKey;
  }[] = [
    {
      file: s.config.edition === "JAVA" ? "whitelist.json" : "allowlist.json",
      label: "guestListTitle",
      remove: s.config.edition === "JAVA" ? "unwhitelist" : "unallowlist",
    },
    ...(s.config.edition === "JAVA"
      ? [
          {
            file: "ops.json",
            label: "operators" as const,
            remove: "deop" as const,
          },
          {
            file: "banned-players.json",
            label: "bannedPlayers" as const,
            remove: "pardon" as const,
          },
        ]
      : []),
  ];
  const actions: TranslationKey[] =
    s.config.edition === "JAVA"
      ? ["kick", "op", "deop", "whitelist", "unwhitelist", "ban", "pardon"]
      : ["kick", "op", "deop", "allowlist", "unallowlist"];
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
            maxLength={s.config.edition === "JAVA" ? 16 : 32}
            pattern={
              s.config.edition === "JAVA" ? "[A-Za-z0-9_]{1,16}" : undefined
            }
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
          <MineButton
            type="submit"
            disabled={!name || s.state !== "RUNNING" || action.isPending}
          >
            {t("confirm")}
          </MineButton>
        </form>
        {output && <MineNotice>{output}</MineNotice>}
      </MinePanel>
      <MinePanel className="player-access-panel">
        <h2>{t("guestListTitle")}</h2>
        <p>{t("guestListHint")}</p>
        {settings.data && (
          <>
            <label className="checkbox">
              <input
                type="checkbox"
                role="switch"
                checked={guestEnabled ?? currentEnabled}
                disabled={saveGuest.isPending}
                onChange={(event) => setGuestEnabled(event.target.checked)}
              />
              {t("guestListEnabled")}
            </label>
            <p className="muted">{t("guestListRestart")}</p>
            <MineButton
              disabled={
                guestEnabled === null ||
                guestEnabled === currentEnabled ||
                saveGuest.isPending
              }
              onClick={() => saveGuest.mutate()}
            >
              {t("saveGuestList")}
            </MineButton>
          </>
        )}
        {saveGuest.isPending && (
          <MineProgress message={phase || t("loading")} />
        )}
        <ErrorNotice error={settings.error ?? saveGuest.error} />
        <div className="player-access-lists">
          {lists.map((list) => (
            <section key={list.file} className="player-access-list">
              <h3>
                {t(list.label)}{" "}
                <MineBadge>{entries(list.file).length}</MineBadge>
              </h3>
              {entries(list.file).length ? (
                <ul>
                  {entries(list.file).map((entry) => (
                    <li key={entry.name}>
                      <b>{entry.name}</b>
                      <MineButton
                        variant="ghost"
                        disabled={s.state !== "RUNNING" || action.isPending}
                        onClick={() => {
                          setName(entry.name);
                          setVerb(list.remove);
                          setConfirm(true);
                        }}
                      >
                        {t(list.remove)}
                      </MineButton>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  {t(
                    list.label === "guestListTitle"
                      ? "guestListEmpty"
                      : "noPlayerEntries",
                  )}
                </p>
              )}
            </section>
          ))}
        </div>
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
              {
                onSuccess: (result) => {
                  setOutput((result as { output: string }).output);
                  setConfirm(false);
                  void client.invalidateQueries({
                    queryKey: ["players", s.id],
                  });
                },
              },
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
