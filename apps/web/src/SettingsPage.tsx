import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";
import { useI18n } from "./i18n.tsx";
import { useUser } from "./Auth.tsx";
import { savePreferences } from "../../../packages/ui/src/preferences.ts";
import { sound } from "../../../packages/ui/src/sound.ts";
import { useExperience, useScene } from "./Experience.tsx";
import { ErrorNotice, useAction } from "./hooks.tsx";
import {
  MinePanel,
  MineButton,
  MineInput,
  MineToggle,
  MineNotice,
  Asset,
} from "../../../packages/ui/src/index.tsx";
export function SettingsPage() {
  const { t, language, setLanguage } = useI18n(),
    user = useUser(),
    action = useAction(),
    { preferences } = useExperience(),
    [key, setKey] = useState(""),
    [s3, setS3] = useState({
      endpoint: "",
      region: "us-east-1",
      bucket: "",
      accessKey: "",
      secretKey: "",
      prefix: "minemate",
    });
  useScene("preferences");
  const system = useQuery({
      queryKey: ["system"],
      queryFn: () =>
        api<{
          version: string;
          curseforgeConfigured: boolean;
          s3Configured: boolean;
          audit: {
            id: string;
            action: string;
            created_at: string;
            actor: string;
          }[];
        }>("/system"),
      enabled: user.role !== "member",
    }),
    sessions = useQuery({
      queryKey: ["sessions"],
      queryFn: () =>
        api<{ id: string; created_at: string; expires_at: string }[]>(
          "/auth/sessions",
        ),
    });
  return (
    <div className="page">
      <div className="page-heading">
        <span className="eyebrow">{t("tagline")}</span>
        <h1>{t("preferences")}</h1>
      </div>
      <MinePanel>
        <h2>
          <Asset name="book" size={28} />
          {t("preferences")}
        </h2>
        <label className="field">
          <span>{t("language")}</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as "en" | "de")}
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </label>
        <MineToggle
          label={t("sounds")}
          hint={t("soundHint")}
          checked={preferences.enabled}
          onChange={(v) => {
            const p = { ...preferences, enabled: v };
            savePreferences(p);
          }}
        />
        {(["uiVolume", "ambientVolume"] as const).map((k) => (
          <label className="slider-field" key={k}>
            <span>{t(k)}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={preferences[k]}
              onChange={(e) => {
                const p = { ...preferences, [k]: Number(e.target.value) };
                savePreferences(p);
              }}
            />
            <output>{Math.round(preferences[k] * 100)}%</output>
          </label>
        ))}
        <MineToggle
          label={t("reduced")}
          checked={preferences.reduced}
          onChange={(v) => {
            const p = { ...preferences, reduced: v };
            savePreferences(p);
          }}
        />
        <MineToggle
          label={t("companions")}
          hint={t("companionsHint")}
          checked={preferences.companions}
          onChange={(companions) =>
            savePreferences({ ...preferences, companions })
          }
        />
        <div className="sound-playground">
          <div>
            <Asset name="jukebox" size={52} />
            <span>
              <b>{t("previewSound")}</b>
              <small>{t("soundHint")}</small>
            </span>
          </div>
          <div className="button-row">
            {(
              [
                ["chest", "soundChest", "chest"],
                ["portal", "soundPortal", "portal"],
                ["success", "soundSuccess", "diamond"],
              ] as const
            ).map(([kind, label, icon]) => (
              <MineButton
                key={kind}
                variant="secondary"
                data-silent
                disabled={!preferences.enabled}
                onClick={() => void sound.play(kind)}
              >
                <Asset name={icon} size={22} />
                {t(label)}
              </MineButton>
            ))}
          </div>
        </div>
      </MinePanel>
      {user.role !== "member" && (
        <>
          <MinePanel>
            <h2>{t("integrations")}</h2>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                action.mutate(
                  { path: "/system/curseforge", body: { key } },
                  { onSuccess: () => setKey("") },
                );
              }}
            >
              <MineInput
                label={t("curseforgeKey")}
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
                required
              />
              <MineButton type="submit" disabled={!key || action.isPending}>
                {t("save")}
              </MineButton>
            </form>
            <p className="muted">{t("secretHint")}</p>
            {system.data?.curseforgeConfigured && (
              <MineNotice tone="success">CurseForge ✓</MineNotice>
            )}
            <ErrorNotice error={action.error} />
          </MinePanel>
          <MinePanel>
            <h2>
              <Asset name="chest" size={28} />
              {t("s3Title")}
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                action.mutate(
                  { path: "/system/s3", body: s3 },
                  {
                    onSuccess: () =>
                      setS3({ ...s3, accessKey: "", secretKey: "" }),
                  },
                );
              }}
            >
              <div className="form-grid">
                {(
                  [
                    "endpoint",
                    "region",
                    "bucket",
                    "accessKey",
                    "secretKey",
                    "prefix",
                  ] as const
                ).map((k) => (
                  <MineInput
                    key={k}
                    label={t(k)}
                    type={
                      k === "secretKey" || k === "accessKey"
                        ? "password"
                        : "text"
                    }
                    value={s3[k]}
                    onChange={(e) => setS3({ ...s3, [k]: e.target.value })}
                    required
                  />
                ))}
              </div>
              <div className="button-row">
                <MineButton type="submit" disabled={action.isPending}>
                  {t("save")}
                </MineButton>
                <MineButton
                  variant="secondary"
                  disabled={!system.data?.s3Configured || action.isPending}
                  onClick={() => action.mutate({ path: "/system/s3/test" })}
                >
                  {t("testConnection")}
                </MineButton>
              </div>
              <p className="muted">{t("secretHint")}</p>
              <ErrorNotice error={action.error} />
            </form>
          </MinePanel>
          <MinePanel>
            <h3>
              {t("appUpdate")} · {system.data?.version ?? "0.1.0"}
            </h3>
            <p>{t("appUpdateHint")}</p>
          </MinePanel>
          <MinePanel>
            <h3>{t("audit")}</h3>
            <div className="audit-list">
              {system.data?.audit.map((a) => (
                <div key={a.id}>
                  <code>{a.action}</code>
                  <time>{new Date(a.created_at).toLocaleString()}</time>
                </div>
              ))}
            </div>
            <ErrorNotice error={system.error} />
          </MinePanel>
        </>
      )}
      <MinePanel>
        <h3>{t("sessions")}</h3>
        {sessions.data?.map((s) => (
          <div className="session-row" key={s.id}>
            <time>{new Date(s.created_at).toLocaleString()}</time>
            <MineButton
              variant="secondary"
              onClick={() =>
                action.mutate({
                  path: "/auth/sessions/" + s.id,
                  method: "DELETE",
                })
              }
            >
              {t("revoke")}
            </MineButton>
          </div>
        ))}
      </MinePanel>
    </div>
  );
}
