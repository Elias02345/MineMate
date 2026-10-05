import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api.ts";
import { useI18n } from "../i18n.tsx";
import { useUser } from "../Auth.tsx";
import { ErrorNotice, useAction, useServerBusy } from "../hooks.tsx";
import { bytes } from "../Dashboard.tsx";
import {
  MineButton,
  MinePanel,
  MineEmpty,
  MineBadge,
  MineModal,
  MineInput,
  MineProgress,
  Asset,
  MineNotice,
} from "../../../../packages/ui/src/index.tsx";
import type { Server, Backup } from "../../../../packages/shared/src/index.ts";
interface Policy {
  keepLast: number;
  daily: number;
  weekly: number;
  maxBytes: number;
  intervalMinutes: number;
}
export default function BackupPanel({ server: s }: { server: Server }) {
  const { t } = useI18n(),
    user = useUser(),
    system = useQuery({
      queryKey: ["system"],
      queryFn: () => api<{ s3Configured: boolean }>("/system"),
      enabled: user.role !== "member",
    }),
    action = useAction(),
    busy = useServerBusy(s.id),
    [restore, setRestore] = useState<Backup | null>(null),
    [confirm, setConfirm] = useState(""),
    [policy, setPolicy] = useState<Policy>({
      keepLast: 20,
      daily: 7,
      weekly: 4,
      maxBytes: 0,
      intervalMinutes: 0,
    });
  const q = useQuery({
      queryKey: ["backups", s.id],
      queryFn: () => api<Backup[]>(`/servers/${s.id}/backups`),
    }),
    p = useQuery({
      queryKey: ["backup-policy", s.id],
      queryFn: () => api<Policy>(`/servers/${s.id}/backups/policy`),
    });
  useEffect(() => {
    if (p.data) setPolicy(p.data);
  }, [p.data]);
  return (
    <>
      <MinePanel className="mine-chest">
        <div className="section-heading">
          <div>
            <h2>
              <Asset name="chest" size={30} />
              {t("backups")}
            </h2>
            <p>{t("backupHint")}</p>
          </div>
          <MineButton
            disabled={action.isPending || busy}
            onClick={() => action.mutate({ path: `/servers/${s.id}/backups` })}
          >
            <Asset name="chest" size={22} />
            {t("backupCreate")}
          </MineButton>
        </div>
        <ErrorNotice error={q.error ?? action.error} />
        {q.isPending ? (
          <MineProgress message={t("loading")} />
        ) : !q.data?.length ? (
          <MineEmpty
            icon="chest"
            title={t("chestEmpty")}
            description={t("chestEmptyBody")}
          />
        ) : (
          <div className="backup-grid">
            {q.data.map((b) => (
              <article className="backup-card" key={b.id}>
                <Asset name="chest" size={48} />
                <div>
                  <h3>{new Date(b.createdAt).toLocaleString()}</h3>
                  <p>
                    {bytes(b.bytes)} · {b.config.version}
                  </p>
                  <MineBadge
                    tone={b.integrity === "verified" ? "grass" : "redstone"}
                  >
                    {b.integrity === "verified" ? t("verified") : b.integrity}
                  </MineBadge>
                  <small>{b.reason}</small>
                </div>
                <div className="button-row">
                  <MineButton
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setRestore(b);
                      setConfirm("");
                    }}
                  >
                    {t("restore")}
                  </MineButton>
                  <a
                    className="text-link"
                    href={`/api/v1/servers/${s.id}/backups/${b.id}/download`}
                  >
                    {t("download")}
                  </a>
                  {user.role !== "member" && system.data?.s3Configured && (
                    <MineButton
                      variant="ghost"
                      disabled={busy || action.isPending}
                      onClick={() =>
                        action.mutate({
                          path: `/servers/${s.id}/backups/${b.id}/remote`,
                        })
                      }
                    >
                      {t("remoteBackup")}
                    </MineButton>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </MinePanel>
      <MinePanel>
        <h3>{t("retention")}</h3>
        <div className="form-grid">
          {(
            [
              "keepLast",
              "daily",
              "weekly",
              "intervalMinutes",
              "maxBytes",
            ] as const
          ).map((key) => (
            <MineInput
              key={key}
              label={t(
                key === "intervalMinutes"
                  ? "interval"
                  : key === "maxBytes"
                    ? "maxStorage"
                    : key,
              )}
              type="number"
              min={key === "keepLast" ? 1 : 0}
              value={key === "maxBytes" ? policy[key] / 1024 ** 3 : policy[key]}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  [key]:
                    Number(e.target.value) *
                    (key === "maxBytes" ? 1024 ** 3 : 1),
                })
              }
            />
          ))}
        </div>
        <MineButton
          onClick={() =>
            action.mutate({
              path: `/servers/${s.id}/backups/policy`,
              method: "PUT",
              body: policy,
            })
          }
        >
          {t("save")}
        </MineButton>
      </MinePanel>
      <MineModal
        open={!!restore}
        onOpenChange={(open) => {
          if (!open) setRestore(null);
        }}
        title={t("restore")}
        description={t("restoreHint")}
      >
        <MineNotice>
          {restore && new Date(restore.createdAt).toLocaleString()} ·{" "}
          {restore && bytes(restore.bytes)}
        </MineNotice>
        <MineInput
          label={t("confirmName") + " · " + s.name}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <MineButton
          variant="danger"
          disabled={confirm !== s.name || action.isPending}
          onClick={() =>
            action.mutate(
              {
                path: `/servers/${s.id}/backups/${restore!.id}/restore`,
                body: { confirm },
              },
              { onSuccess: () => setRestore(null) },
            )
          }
        >
          {t("restore")}
        </MineButton>
        <ErrorNotice error={action.error} />
      </MineModal>
    </>
  );
}
