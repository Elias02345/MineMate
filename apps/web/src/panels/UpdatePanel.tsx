import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api.ts";
import { useI18n } from "../i18n.tsx";
import { ErrorNotice, useAction } from "../hooks.tsx";
import {
  MinePanel,
  MineButton,
  MineInput,
  MineNotice,
  MineProgress,
  MineBadge,
  Asset,
} from "../../../../packages/ui/src/index.tsx";
import type {
  Server,
  ServerConfig,
} from "../../../../packages/shared/src/index.ts";
interface Check {
  compatible: boolean;
  blocked: string[];
  items: { filename: string; state: string; message: string }[];
}
export default function UpdatePanel({
  server: s,
  advanced,
}: {
  server: Server;
  advanced: boolean;
}) {
  const { t } = useI18n(),
    action = useAction(),
    [version, setVersion] = useState(s.config.version),
    [target, setTarget] = useState(""),
    [override, setOverride] = useState(false),
    [software, setSoftware] = useState(s.config.software),
    [loader, setLoader] = useState(s.config.loaderVersion);
  const check = useQuery({
      queryKey: ["updates", s.id, target, software],
      queryFn: () =>
        api<Check>(
          `/servers/${s.id}/updates?version=${encodeURIComponent(target)}&software=${software}`,
        ),
      enabled: !!target,
    }),
    history = useQuery({
      queryKey: ["update-history", s.id],
      queryFn: () =>
        api<
          {
            id: string;
            target_config: string;
            status: string;
            created_at: string;
            backup_id: string;
          }[]
        >(`/servers/${s.id}/updates/history`),
    });
  return (
    <>
      <MinePanel className="mine-book">
        <h2>
          <Asset name="enderPearl" size={30} />
          {t("updateTitle")}
        </h2>
        <p>{t("updateHint")}</p>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            setTarget(version);
          }}
        >
          <MineInput
            label={t("version")}
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            required
          />
          {advanced && s.config.edition === "JAVA" && (
            <>
              <label className="field">
                <span>{t("software")}</span>
                <select
                  value={software}
                  onChange={(e) =>
                    setSoftware(e.target.value as ServerConfig["software"])
                  }
                >
                  {[
                    "VANILLA",
                    "PAPER",
                    "PURPUR",
                    "FABRIC",
                    "FORGE",
                    "NEOFORGE",
                    "CUSTOM",
                  ].map((soft) => (
                    <option key={soft}>{soft}</option>
                  ))}
                </select>
              </label>
              <MineInput
                label={t("loader")}
                value={loader}
                onChange={(e) => setLoader(e.target.value)}
              />
            </>
          )}
          <MineButton type="submit">{t("checkCompatibility")}</MineButton>
        </form>
        {target &&
          (check.isPending ? (
            <MineProgress message={t("loading")} />
          ) : (
            check.data && (
              <>
                <MineNotice
                  tone={check.data.compatible ? "success" : "warning"}
                >
                  {t(
                    check.data.compatible
                      ? "updateCompatible"
                      : "updateBlocked",
                  )}
                </MineNotice>
                <div className="compatibility-list">
                  {check.data.items.map((i) => (
                    <div key={i.filename}>
                      <b>{i.filename}</b>
                      <MineBadge
                        tone={i.state === "BLOCKED" ? "redstone" : "grass"}
                      >
                        {i.state}
                      </MineBadge>
                      <small>{i.message}</small>
                    </div>
                  ))}
                </div>
                {advanced && !check.data.compatible && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={override}
                      onChange={(e) => setOverride(e.target.checked)}
                    />
                    {t("override")}
                  </label>
                )}
                <MineButton
                  disabled={
                    action.isPending || (!check.data.compatible && !override)
                  }
                  onClick={() =>
                    action.mutate({
                      path: `/servers/${s.id}/updates`,
                      body: {
                        config: {
                          ...s.config,
                          version: target,
                          software,
                          loaderVersion: loader,
                        },
                        override,
                        confirm: true,
                      },
                    })
                  }
                >
                  {t("updateApply")}
                </MineButton>
              </>
            )
          ))}
        <ErrorNotice error={check.error ?? action.error} />
      </MinePanel>
      <MinePanel>
        <h3>{t("history")}</h3>
        {history.data?.map((h) => (
          <div className="history-row" key={h.id}>
            <Asset name="diamond" size={24} />
            <b>{(JSON.parse(h.target_config) as ServerConfig).version}</b>
            <MineBadge>{h.status}</MineBadge>
            <small>{new Date(h.created_at).toLocaleString()}</small>
            <span>{t("rollback")}</span>
          </div>
        ))}
      </MinePanel>
    </>
  );
}
