import { useScene } from "./Experience.tsx";
import { useState, lazy, Suspense } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Play, Square, RotateCw, ArrowLeft } from "lucide-react";
import { useUser } from "./Auth.tsx";
import { api } from "./api.ts";
import { useI18n, type TranslationKey } from "./i18n.tsx";
import { ErrorNotice, useAction } from "./hooks.tsx";
import { CopyButton, bytes } from "./Dashboard.tsx";
import {
  MineButton,
  MinePanel,
  MineBadge,
  MineTabs,
  MineProgress,
  Asset,
  Landscape,
  MineNotice,
  MineModal,
} from "../../../packages/ui/src/index.tsx";
import type {
  Server,
  Operation,
  Permission,
} from "../../../packages/shared/src/index.ts";
const SettingsPanel = lazy(() => import("./panels/SettingsPanel.tsx"));
const ConsolePanel = lazy(() => import("./panels/ConsolePanel.tsx"));
const BackupPanel = lazy(() => import("./panels/BackupPanel.tsx"));
const ContentPanel = lazy(() => import("./panels/ContentPanel.tsx"));
const FilePanel = lazy(() => import("./panels/FilePanel.tsx"));
const WorldPanel = lazy(() => import("./panels/WorldPanel.tsx"));
const PlayerPanel = lazy(() => import("./panels/PlayerPanel.tsx"));
const UpdatePanel = lazy(() => import("./panels/UpdatePanel.tsx"));
const NetworkPanel = lazy(() => import("./panels/NetworkPanel.tsx"));
const AccessPanel = lazy(() => import("./panels/AccessPanel.tsx"));
export function ServerPage() {
  const { serverId } = useParams({ from: "/servers/$serverId" }),
    { t } = useI18n(),
    user = useUser(),
    [tab, setTab] = useState("overview"),
    [advanced, setAdvanced] = useState(false),
    action = useAction();
  const query = useQuery({
    queryKey: ["server", serverId],
    queryFn: () => api<Server>("/servers/" + serverId),
  });
  useScene(tab);
  if (query.isPending) return <MineProgress message={t("loading")} />;
  if (!query.data) return <ErrorNotice error={query.error} />;
  const s = query.data,
    tabs: {
      id: string;
      key: TranslationKey;
      permission: Permission;
      advanced?: boolean;
    }[] = [
      { id: "overview", key: "overview", permission: "view" },
      { id: "console", key: "console", permission: "console" },
      { id: "settings", key: "settings", permission: "settings" },
      { id: "players", key: "players", permission: "players" },
      { id: "worlds", key: "worlds", permission: "files" },
      { id: "content", key: "content", permission: "content" },
      { id: "backups", key: "backups", permission: "backups" },
      { id: "updates", key: "updates", permission: "update" },
      { id: "network", key: "network", permission: "view" },
      { id: "files", key: "files", permission: "files", advanced: true },
      {
        id: "permissions",
        key: "permissions",
        permission: "settings",
      },
    ];
  const busy = [
    "CREATING",
    "STARTING",
    "STOPPING",
    "RESTARTING",
    "UPDATING",
    "RESTORING",
    "BACKING_UP",
    "DELETING",
  ].includes(s.state);
  return (
    <div className="page server-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} />
        {t("dashboard")}
      </Link>
      <div className="server-heading">
        <div className="server-title">
          <Asset
            name={s.config.edition === "JAVA" ? "grassBlock" : "diamond"}
            size={48}
          />
          <div>
            <h1>{s.name}</h1>
            <p>
              {s.config.edition === "JAVA" ? "Java" : "Bedrock"} ·{" "}
              {s.config.version} · {s.config.software}
            </p>
          </div>
          <MineBadge
            tone={
              s.state === "RUNNING"
                ? "grass"
                : s.state === "ERROR"
                  ? "redstone"
                  : "stone"
            }
          >
            {t(s.state)}
          </MineBadge>
        </div>
        <div className="server-controls">
          {s.permissions.includes("start") && (
            <MineButton
              disabled={busy || s.state === "RUNNING" || s.archived}
              onClick={() =>
                action.mutate({
                  path: `/servers/${s.id}/lifecycle`,
                  body: { action: "start" },
                })
              }
            >
              <Play size={16} />
              {t("start")}
            </MineButton>
          )}
          {s.permissions.includes("stop") && (
            <MineButton
              variant="secondary"
              disabled={busy || !["RUNNING", "STARTING"].includes(s.state)}
              onClick={() =>
                action.mutate({
                  path: `/servers/${s.id}/lifecycle`,
                  body: { action: "stop" },
                })
              }
            >
              <Square size={16} />
              {t("stop")}
            </MineButton>
          )}
          {s.permissions.includes("restart") && (
            <MineButton
              variant="secondary"
              disabled={busy || s.state !== "RUNNING"}
              onClick={() =>
                action.mutate({
                  path: `/servers/${s.id}/lifecycle`,
                  body: { action: "restart" },
                })
              }
              aria-label={t("restart")}
            >
              <RotateCw size={16} />
            </MineButton>
          )}
        </div>
      </div>
      <ErrorNotice error={action.error} />
      {s.error && <MineNotice tone="error">{s.error}</MineNotice>}
      <OperationList serverId={s.id} />
      <div className="tabs-toolbar">
        <MineTabs
          items={tabs
            .filter(
              (item) =>
                s.permissions.includes(item.permission) &&
                (item.id !== "permissions" || user.role !== "member") &&
                (!item.advanced || advanced),
            )
            .map((item) => ({ id: item.id, label: t(item.key) }))}
          active={tab}
          onChange={setTab}
        />
        <label className="checkbox compact-checkbox">
          <input
            type="checkbox"
            checked={advanced}
            onChange={(e) => {
              setAdvanced(e.target.checked);
              if (!e.target.checked && tab === "files") setTab("overview");
            }}
          />
          {t("advanced")}
        </label>
      </div>
      <div
        className="tab-scene"
        key={tab}
        role="tabpanel"
        aria-label={t(tabs.find((item) => item.id === tab)!.key)}
      >
        <Suspense fallback={<MineProgress message={t("loading")} />}>
          {tab === "overview" && <Overview server={s} />}{" "}
          {tab === "console" && <ConsolePanel server={s} />}{" "}
          {tab === "settings" && (
            <SettingsPanel server={s} advanced={advanced} />
          )}{" "}
          {tab === "players" && <PlayerPanel server={s} />}{" "}
          {tab === "worlds" && <WorldPanel server={s} />}{" "}
          {tab === "content" && <ContentPanel server={s} />}{" "}
          {tab === "backups" && <BackupPanel server={s} />}{" "}
          {tab === "updates" && <UpdatePanel server={s} advanced={advanced} />}{" "}
          {tab === "network" && (
            <NetworkPanel
              server={s}
              onManageAccess={
                user.role !== "member" && s.permissions.includes("settings")
                  ? () => setTab("permissions")
                  : undefined
              }
            />
          )}{" "}
          {tab === "files" && <FilePanel server={s} />}{" "}
          {tab === "permissions" && <AccessPanel server={s} />}
        </Suspense>
      </div>
    </div>
  );
}
export function OperationList({ serverId }: { serverId: string }) {
  const { t } = useI18n(),
    q = useQuery({
      queryKey: ["operations", serverId],
      queryFn: () => api<Operation[]>(`/operations?serverId=${serverId}`),
    }),
    ops =
      q.data
        ?.filter(
          (o) =>
            o.status === "QUEUED" ||
            o.status === "RUNNING" ||
            o.status === "FAILED" ||
            o.status === "INTERRUPTED",
        )
        .slice(0, 3) ?? [];
  return ops.length ? (
    <div className="operations">
      {ops.map((o) => (
        <MineNotice
          key={o.id}
          tone={
            o.status === "FAILED" || o.status === "INTERRUPTED"
              ? "error"
              : "warning"
          }
        >
          <div className="operation-line">
            <b>{o.kind}</b>
            <MineBadge>{t(o.status)}</MineBadge>
          </div>
          {o.status === "RUNNING" || o.status === "QUEUED" ? (
            <MineProgress message={o.phase} />
          ) : (
            <details>
              <summary>{t("operationFailed")}</summary>
              <pre>{o.error ?? o.phase}</pre>
              <code>{o.id}</code>
            </details>
          )}
        </MineNotice>
      ))}
    </div>
  ) : null;
}
function Overview({ server: s }: { server: Server }) {
  const { t } = useI18n(),
    action = useAction(),
    [danger, setDanger] = useState(false),
    [confirm, setConfirm] = useState(""),
    [mode, setMode] = useState("container"),
    [repair, setRepair] = useState(false),
    [accepted, setAccepted] = useState(false);
  const diagnostics = useQuery({
    queryKey: ["repair", s.id],
    queryFn: () =>
      api<{
        issues: { title: string; cause: string; action: string }[];
        technical: string;
        unknown: boolean;
      }>(`/servers/${s.id}/repair`),
    enabled: repair,
  });
  return (
    <>
      <div className="server-overview">
        <MinePanel className="world-window">
          <Landscape night={s.state === "SLEEPING" || s.state === "STOPPED"} />
          <div className="world-window-label">
            <Asset name={s.state === "SLEEPING" ? "moon" : "sun"} size={35} />
            <h2>{t(s.state)}</h2>
            <code>
              {s.endpoint.host}:{s.port}
            </code>
            <CopyButton value={`${s.endpoint.host}:${s.port}`} />
          </div>
        </MinePanel>
        <MinePanel>
          <h2>{t("overview")}</h2>
          <div className="metrics-list">
            {[
              [
                t("players"),
                s.metrics?.players == null
                  ? "—"
                  : `${s.metrics.players} / ${s.config.maxPlayers}`,
              ],
              [
                t("memory"),
                `${bytes(s.metrics?.memoryBytes)} / ${s.config.memoryMb} MB`,
              ],
              [
                t("cpu"),
                s.metrics?.cpuPercent == null
                  ? "—"
                  : s.metrics.cpuPercent.toFixed(1) + "%",
              ],
              [
                t("uptime"),
                s.metrics?.uptimeSeconds == null
                  ? "—"
                  : Math.floor(s.metrics.uptimeSeconds / 60) + " min",
              ],
              [t("disk"), bytes(s.metrics?.diskBytes)],
            ].map(([key, value]) => (
              <div key={key}>
                <span>{key}</span>
                <b>{value}</b>
              </div>
            ))}
          </div>
          {s.state === "RUNNING" && s.permissions.includes("stop") && (
            <MineButton
              variant="secondary"
              onClick={() =>
                action.mutate({
                  path: `/servers/${s.id}/lifecycle`,
                  body: { action: "sleep" },
                })
              }
            >
              <Asset name="moon" size={20} />
              {t("sleep")}
            </MineButton>
          )}
        </MinePanel>
      </div>
      <MinePanel>
        <div className="section-heading">
          <h2>{t("repair")}</h2>
          <MineButton variant="secondary" onClick={() => setRepair(!repair)}>
            {t("repair")}
          </MineButton>
        </div>
        {repair &&
          (diagnostics.isPending ? (
            <MineProgress message={t("loading")} />
          ) : (
            <>
              <ErrorNotice error={diagnostics.error} />
              {diagnostics.data?.issues.map((i) => (
                <MineNotice key={i.title}>
                  <b>{i.title}</b>
                  <p>{i.cause}</p>
                  <p>{i.action}</p>
                </MineNotice>
              ))}
              {diagnostics.data?.unknown && <p>{t("repairUnknown")}</p>}
              {s.permissions.includes("settings") && (
                <div className="eula-repair">
                  <p>{t("eulaText")}</p>
                  <a
                    href="https://www.minecraft.net/eula"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("eulaLink")}
                  </a>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={(e) => setAccepted(e.target.checked)}
                    />
                    {t("eulaAccept")}
                  </label>
                  <MineButton
                    disabled={!accepted || action.isPending}
                    onClick={() =>
                      action.mutate({
                        path: `/servers/${s.id}/eula`,
                        body: { accept: true },
                      })
                    }
                  >
                    {t("save")}
                  </MineButton>
                </div>
              )}
              <details>
                <summary>{t("details")}</summary>
                <pre>{diagnostics.data?.technical}</pre>
              </details>
            </>
          ))}
      </MinePanel>
      {s.permissions.includes("delete") && (
        <MinePanel className="danger-panel">
          <div className="section-heading">
            <div>
              <h3>{t("danger")}</h3>
              <p>{t("deleteHint")}</p>
            </div>
            {s.archived ? (
              <MineButton
                onClick={() =>
                  action.mutate({ path: `/servers/${s.id}/unarchive` })
                }
              >
                {t("unarchive")}
              </MineButton>
            ) : (
              <MineButton variant="danger" onClick={() => setDanger(true)}>
                {t("delete")}
              </MineButton>
            )}
          </div>
        </MinePanel>
      )}
      <ErrorNotice error={action.error} />
      <MineModal
        open={danger}
        onOpenChange={setDanger}
        title={t("danger")}
        description={t("deleteHint")}
      >
        <label className="field">
          <span>{t("delete")}</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="container">{t("deleteContainer")}</option>
            <option value="archive">{t("archive")}</option>
            <option value="data">{t("deleteData")}</option>
          </select>
        </label>
        <label className="field">
          <span>
            {t("confirmName")} · {s.name}
          </span>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        <MineButton
          variant="danger"
          disabled={confirm !== s.name || action.isPending}
          onClick={() =>
            action.mutate(
              {
                path: `/servers/${s.id}`,
                method: "DELETE",
                body: { mode, confirm },
              },
              { onSuccess: () => setDanger(false) },
            )
          }
        >
          {t("confirm")}
        </MineButton>
      </MineModal>
    </>
  );
}
