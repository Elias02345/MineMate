import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api.ts";
import {
  useI18n,
  settingKeys,
  settingDescription,
  type TranslationKey,
} from "../i18n.tsx";
import { ErrorNotice, useAction } from "../hooks.tsx";
import {
  MinePanel,
  MineButton,
  MineToggle,
  MineProgress,
  MineInput,
  MineBadge,
  MineNotice,
} from "../../../../packages/ui/src/index.tsx";
import type { Server } from "../../../../packages/shared/src/index.ts";
import type { SettingDefinition } from "../../../../packages/settings-schema/src/index.ts";
export default function SettingsPanel({
  server: s,
  advanced,
}: {
  server: Server;
  advanced: boolean;
}) {
  const { t, language } = useI18n(),
    action = useAction(),
    [search, setSearch] = useState(""),
    [changes, setChanges] = useState<Record<string, string>>({}),
    [restart, setRestart] = useState(true);
  const q = useQuery({
    queryKey: ["settings", s.id],
    queryFn: () =>
      api<{
        values: Record<string, string>;
        revision: string;
        schema: SettingDefinition[];
      }>(`/servers/${s.id}/settings`),
  });
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (Object.keys(changes).length) e.preventDefault();
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [changes]);
  if (q.isPending) return <MineProgress message={t("loading")} />;
  if (!q.data) return <ErrorNotice error={q.error} />;
  const data = q.data,
    schema = data.schema.filter(
      (d) =>
        (advanced || !d.advanced) &&
        (t(settingKeys[d.key] ?? "settings")
          .toLowerCase()
          .includes(search.toLowerCase()) ||
          d.key.includes(search)),
    ),
    categories = [...new Set(schema.map((d) => d.category))];
  return (
    <div className="settings-layout">
      <MinePanel className="settings-toolbar">
        <div>
          <h2>{t("settings")}</h2>
          <p>{t("settingsHint")}</p>
        </div>
        <MineInput
          label={t("search")}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </MinePanel>
      {Object.keys(changes).length > 0 && (
        <MineNotice>
          {t("unsaved")} · {Object.keys(changes).length}
        </MineNotice>
      )}
      {categories.map((category) => (
        <MinePanel className="mine-book" key={category}>
          <div className="section-heading">
            <h3>{t(category as TranslationKey)}</h3>
            <MineButton
              variant="ghost"
              onClick={() =>
                setChanges({
                  ...changes,
                  ...Object.fromEntries(
                    schema
                      .filter((d) => d.category === category)
                      .map((d) => [d.key, d.default]),
                  ),
                })
              }
            >
              {t("reset")}
            </MineButton>
          </div>
          {schema
            .filter((d) => d.category === category)
            .map((d) => {
              const value = changes[d.key] ?? data.values[d.key] ?? d.default,
                label = t(settingKeys[d.key] ?? "settings");
              return (
                <div className="setting-row" key={d.key}>
                  <div>
                    <label htmlFor={"setting-" + d.key}>
                      <b>{label}</b>
                    </label>
                    <p className="setting-help">
                      {settingDescription(d.key, language)}
                    </p>
                    <small>
                      {advanced ? d.key : d.restart ? t("restartRequired") : ""}
                    </small>
                    {value !== d.default && (
                      <MineBadge tone="grass">{t("changed")}</MineBadge>
                    )}
                  </div>
                  <div className="setting-control">
                    {d.type === "boolean" ? (
                      <MineToggle
                        label={label}
                        checked={value === "true"}
                        onChange={(v) =>
                          setChanges({ ...changes, [d.key]: String(v) })
                        }
                      />
                    ) : d.type === "select" ? (
                      <select
                        id={"setting-" + d.key}
                        value={value}
                        onChange={(e) =>
                          setChanges({ ...changes, [d.key]: e.target.value })
                        }
                      >
                        {d.options
                          ?.filter(
                            (v) =>
                              s.config.edition !== "BEDROCK" ||
                              v !== "spectator",
                          )
                          .map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                      </select>
                    ) : (
                      <input
                        id={"setting-" + d.key}
                        type={d.type === "number" ? "number" : "text"}
                        min={d.min}
                        max={d.max}
                        value={value}
                        onChange={(e) =>
                          setChanges({ ...changes, [d.key]: e.target.value })
                        }
                      />
                    )}
                    <button
                      className="reset-button"
                      aria-label={t("reset") + " " + label}
                      onClick={() =>
                        setChanges({ ...changes, [d.key]: d.default })
                      }
                    >
                      ↺
                    </button>
                  </div>
                </div>
              );
            })}
        </MinePanel>
      ))}
      <MinePanel className="sticky-actions">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={restart}
            onChange={(e) => setRestart(e.target.checked)}
          />
          {t("restartAfter")}
        </label>
        <MineButton
          disabled={!Object.keys(changes).length || action.isPending}
          onClick={() =>
            action.mutate(
              {
                path: `/servers/${s.id}/settings`,
                method: "PUT",
                body: { values: changes, revision: data.revision, restart },
              },
              { onSuccess: () => setChanges({}) },
            )
          }
        >
          {t("save")}
        </MineButton>
        <ErrorNotice error={action.error} />
      </MinePanel>
      <RuntimeSettings server={s} advanced={advanced} />
    </div>
  );
}
function RuntimeSettings({
  server: s,
  advanced,
}: {
  server: Server;
  advanced: boolean;
}) {
  const { t } = useI18n(),
    action = useAction(),
    [memory, setMemory] = useState(s.config.memoryMb),
    [cpu, setCpu] = useState(s.config.cpu),
    [sleep, setSleep] = useState(s.config.sleepMinutes),
    [name, setName] = useState(s.name),
    [jvm, setJvm] = useState(s.config.jvmFlags);
  return (
    <MinePanel>
      <h3>
        {t("memory")} & {t("cpu")}
      </h3>
      <div className="form-grid">
        <MineInput
          label={t("name")}
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
        />
        <MineInput
          label={t("memoryMb")}
          type="number"
          min={512}
          value={memory}
          onChange={(e) => setMemory(Number(e.target.value))}
        />
        <MineInput
          label={t("cpus")}
          type="number"
          min={0.25}
          step={0.25}
          value={cpu}
          onChange={(e) => setCpu(Number(e.target.value))}
        />
        <MineInput
          label={t("sleepMinutes")}
          type="number"
          min={0}
          value={sleep}
          onChange={(e) => setSleep(Number(e.target.value))}
        />
        {advanced && s.config.edition === "JAVA" && (
          <MineInput
            label={t("jvm")}
            value={jvm}
            onChange={(e) => setJvm(e.target.value)}
          />
        )}
      </div>
      <MineButton
        disabled={action.isPending}
        onClick={() =>
          action.mutate({
            path: `/servers/${s.id}/runtime`,
            method: "PUT",
            body: {
              config: {
                ...s.config,
                name,
                memoryMb: memory,
                cpu,
                sleepMinutes: sleep,
                jvmFlags: jvm,
              },
              confirm: true,
            },
          })
        }
      >
        {t("save")}
      </MineButton>
      <ErrorNotice error={action.error} />
    </MinePanel>
  );
}
