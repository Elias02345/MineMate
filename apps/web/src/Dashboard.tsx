import { useScene } from "./Experience.tsx";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  Plus,
  ArrowRight,
  Copy,
  Check,
  HardDrive,
  Users,
  Activity,
} from "lucide-react";
import { useI18n } from "./i18n.tsx";
import { useUser } from "./Auth.tsx";
import { api } from "./api.ts";
import { ErrorNotice, useAction } from "./hooks.tsx";
import { Wizard } from "./Wizard.tsx";
import {
  MineButton,
  MinePanel,
  MineBadge,
  MineEmpty,
  MineProgress,
  Landscape,
  Asset,
} from "../../../packages/ui/src/index.tsx";
import type { Server, HostStatus } from "../../../packages/shared/src/index.ts";
export const bytes = (value: number | null | undefined) =>
  value == null
    ? "—"
    : value >= 1024 ** 3
      ? `${(value / 1024 ** 3).toFixed(1)} GB`
      : value >= 1024 ** 2
        ? `${(value / 1024 ** 2).toFixed(1)} MB`
        : value >= 1024
          ? `${Math.round(value / 1024)} KB`
          : `${value} B`;
export function CopyButton({
  value,
  label,
}: {
  value: string;
  label?: string;
}) {
  const { t } = useI18n(),
    [copied, setCopied] = useState(false),
    [failed, setFailed] = useState(false);
  async function copy() {
    setFailed(false);
    try {
      let success = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(value);
          success = true;
        } catch {
          /* HTTP LAN deployments use the selection fallback. */
        }
      }
      if (!success) {
        const previous = document.activeElement,
          field = document.createElement("textarea");
        field.value = value;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.append(field);
        try {
          field.select();
          success = document.execCommand("copy");
        } finally {
          field.remove();
          if (previous instanceof HTMLElement) previous.focus();
        }
      }
      if (!success) throw new Error("Copy unavailable");
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setFailed(true);
    }
  }
  return (
    <>
      <button
        className="copy-button"
        aria-label={label ?? t("copy")}
        onClick={() => void copy()}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
        <span>{copied ? t("copied") : (label ?? t("copy"))}</span>
      </button>
      {failed && <span role="status">{t("copyManually")}</span>}
    </>
  );
}
export function Dashboard() {
  useScene("overworld");
  const { t } = useI18n(),
    user = useUser(),
    [wizard, setWizard] = useState(false),
    [showHost, setShowHost] = useState(false),
    worlds = useQuery({
      queryKey: ["servers"],
      queryFn: () => api<Server[]>("/servers"),
    }),
    host = useQuery({
      queryKey: ["host"],
      queryFn: () => api<HostStatus>("/system/checks"),
      enabled: showHost && user.role !== "member",
      staleTime: 60000,
    });
  const visible = worlds.data?.filter((s) => !s.archived) ?? [];
  return (
    <div className="page dashboard-page">
      <div className="world-breadcrumb">
        <span>
          <Asset name="compass" size={20} />
          {t("homeCamp")}
        </span>
        <small>
          {t("overworld")} <i />
        </small>
      </div>
      <section className="world-hero">
        <Landscape />
        <div className="hero-content">
          <span className="eyebrow">MineMate · {user.username}</span>
          <h1>{t("hello")}</h1>
          <p>{t("helloBody")}</p>
          {user.role !== "member" && (
            <MineButton onClick={() => setWizard(true)}>
              <Plus size={19} />
              {t("create")}
            </MineButton>
          )}
        </div>
        <div className="hero-sign">
          <Asset name="grassBlock" size={25} />
          <b>{visible.length}</b> {t("worldCount")}
        </div>
        <div className="hero-loot" aria-hidden="true">
          <Asset name="diamond" size={48} />
          <Asset name="pickaxe" size={68} />
          <Asset name="grassBlock" size={95} />
        </div>
      </section>
      <div className="dashboard-stats">
        <div>
          <Asset name="grassBlock" />
          <span>
            <b>{visible.length}</b>
            {t("worldCount")}
          </span>
        </div>
        <div>
          <Asset name="enderPearl" />
          <span>
            <b>{visible.filter((s) => s.state === "RUNNING").length}</b>
            {t("online")}
          </span>
        </div>
        <div>
          <Asset name="creeper" />
          <span>
            <b>
              {visible.every((s) => s.metrics?.players != null)
                ? visible.reduce((sum, s) => sum + (s.metrics?.players ?? 0), 0)
                : "—"}
            </b>
            {t("players")}
          </span>
        </div>
        {user.role !== "member" && (
          <button onClick={() => setShowHost(!showHost)}>
            <HardDrive size={25} />
            <span>
              {t("hostCheck")}
              <ArrowRight size={15} />
            </span>
          </button>
        )}
      </div>
      {showHost && (
        <MinePanel>
          <h2>{t("host")}</h2>
          {host.isPending ? (
            <MineProgress message={t("loading")} />
          ) : host.data ? (
            <div className="host-checks">
              {host.data.checks.map((c) => (
                <div key={c.key} className={c.ok ? "check-ok" : "check-fail"}>
                  <span>{c.ok ? "✓" : "!"}</span>
                  <b>{c.message}</b>
                  {c.detail && <small>{c.detail}</small>}
                </div>
              ))}
            </div>
          ) : null}
          <ErrorNotice error={host.error} />
        </MinePanel>
      )}
      <div className="section-heading">
        <div>
          <span className="eyebrow">{t("tagline")}</span>
          <h2>{t("dashboard")}</h2>
        </div>
        {user.role !== "member" && (
          <MineButton variant="secondary" onClick={() => setWizard(true)}>
            <Plus size={17} />
            {t("create")}
          </MineButton>
        )}
      </div>
      <ErrorNotice error={worlds.error} />
      {worlds.isPending ? (
        <MineProgress message={t("loading")} />
      ) : visible.length ? (
        <div className="world-grid">
          {visible.map((s, i) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <WorldCard server={s} />
            </motion.div>
          ))}
        </div>
      ) : (
        <MinePanel>
          <MineEmpty
            title={t("emptyWorlds")}
            description={t("emptyWorldsBody")}
          >
            {user.role !== "member" && (
              <MineButton onClick={() => setWizard(true)}>
                {t("create")}
                <ArrowRight size={17} />
              </MineButton>
            )}
          </MineEmpty>
        </MinePanel>
      )}
      {worlds.data?.some((s) => s.archived) && (
        <MinePanel>
          <h3>{t("archive")}</h3>
          {worlds.data
            .filter((s) => s.archived)
            .map((s) => (
              <Link
                to="/servers/$serverId"
                params={{ serverId: s.id }}
                key={s.id}
              >
                {s.name} →{" "}
              </Link>
            ))}
        </MinePanel>
      )}
      {wizard && <Wizard open={wizard} onOpenChange={setWizard} />}
    </div>
  );
}
function WorldCard({ server: s }: { server: Server }) {
  const { t } = useI18n(),
    action = useAction(),
    busy = [
      "CREATING",
      "STARTING",
      "STOPPING",
      "RESTORING",
      "UPDATING",
      "DELETING",
    ].includes(s.state);
  return (
    <article className={"world-card state-" + s.state.toLowerCase()}>
      <Link
        to="/servers/$serverId"
        params={{ serverId: s.id }}
        className="card-landscape"
      >
        <Landscape
          compact
          night={s.state === "SLEEPING" || s.state === "STOPPED"}
        />
        <div className="card-icon">
          <Asset
            name={
              s.config.edition === "BEDROCK"
                ? "diamond"
                : s.config.software === "VANILLA"
                  ? "grassBlock"
                  : ["PAPER", "PURPUR"].includes(s.config.software)
                    ? "book"
                    : "enderPearl"
            }
            size={43}
          />
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
      </Link>
      <div className="card-body">
        <Link to="/servers/$serverId" params={{ serverId: s.id }}>
          <h3>{s.name}</h3>
        </Link>
        <p className="card-subtitle">
          {s.config.edition === "JAVA" ? "Java" : "Bedrock"} ·{" "}
          {s.config.version} · {s.config.software}
        </p>
        <div className="card-metrics">
          <span>
            <Users size={15} />
            <b>{s.metrics?.players ?? "—"}</b> / {s.config.maxPlayers}
          </span>
          <span>
            <HardDrive size={15} />
            {bytes(s.metrics?.memoryBytes)}
          </span>
          <span>
            <Activity size={15} />
            {s.metrics?.cpuPercent == null
              ? "—"
              : s.metrics.cpuPercent.toFixed(1) + "%"}
          </span>
        </div>
        <div className="card-address">
          <code>
            {s.endpoint.host}:{s.port}
          </code>
          <CopyButton value={`${s.endpoint.host}:${s.port}`} />
        </div>
        <div className="card-actions">
          {s.permissions.includes(s.state === "RUNNING" ? "stop" : "start") && (
            <MineButton
              variant={s.state === "RUNNING" ? "secondary" : "primary"}
              disabled={busy || action.isPending}
              onClick={() =>
                action.mutate({
                  path: `/servers/${s.id}/lifecycle`,
                  body: { action: s.state === "RUNNING" ? "stop" : "start" },
                })
              }
            >
              {t(s.state === "RUNNING" ? "stop" : "start")}
            </MineButton>
          )}
          <Link
            to="/servers/$serverId"
            params={{ serverId: s.id }}
            className="card-open"
            aria-label={s.name}
          >
            <ArrowRight size={20} />
          </Link>
        </div>
        <ErrorNotice error={action.error} />
      </div>
    </article>
  );
}
