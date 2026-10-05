import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api.ts";
import { useI18n } from "../i18n.tsx";
import { ErrorNotice, useAction } from "../hooks.tsx";
import { bytes } from "../Dashboard.tsx";
import { UploadDialog } from "./ContentPanel.tsx";
import {
  MinePanel,
  MineButton,
  MineEmpty,
  MineBadge,
  MineProgress,
  Asset,
  MineModal,
  MineInput,
} from "../../../../packages/ui/src/index.tsx";
import type { Server } from "../../../../packages/shared/src/index.ts";
interface World {
  name: string;
  path: string;
  bytes: number;
  active: boolean;
  seed: string | null;
  dimensions: boolean;
}
export default function WorldPanel({ server: s }: { server: Server }) {
  const { t } = useI18n(),
    action = useAction(),
    [upload, setUpload] = useState(false),
    [regenerate, setRegenerate] = useState<World | null>(null),
    [confirm, setConfirm] = useState("");
  const q = useQuery({
    queryKey: ["worlds", s.id],
    queryFn: () => api<World[]>(`/servers/${s.id}/worlds`),
  });
  return (
    <>
      <MinePanel>
        <div className="section-heading">
          <h2>
            <Asset name="grassBlock" size={30} />
            {t("worlds")}
          </h2>
          <MineButton onClick={() => setUpload(true)}>
            {t("worldUpload")}
          </MineButton>
        </div>
        <ErrorNotice error={q.error ?? action.error} />
        {q.isPending ? (
          <MineProgress message={t("loading")} />
        ) : !q.data?.length ? (
          <MineEmpty
            title={t("worldEmpty")}
            description={t("worldEmptyBody")}
          />
        ) : (
          <div className="world-manager-grid">
            {q.data.map((w) => (
              <article key={w.path}>
                <Asset name="grassBlock" size={60} />
                <h3>{w.name}</h3>
                <p>{bytes(w.bytes)}</p>
                {w.active && <MineBadge tone="grass">{t("active")}</MineBadge>}
                {w.seed && (
                  <p>
                    {t("seed")} · <code>{w.seed}</code>
                  </p>
                )}
                <div className="button-row">
                  {["STOPPED", "SLEEPING"].includes(s.state) ? (
                    <a
                      href={`/api/v1/servers/${s.id}/worlds/export?path=${encodeURIComponent(w.path)}`}
                      className="text-link"
                    >
                      {t("export")}
                    </a>
                  ) : (
                    <span className="muted">{t("stopForExport")}</span>
                  )}
                  <MineButton
                    variant="ghost"
                    onClick={() => {
                      setRegenerate(w);
                      setConfirm("");
                    }}
                  >
                    {t("regenerate")}
                  </MineButton>
                  <MineButton
                    variant="secondary"
                    onClick={() =>
                      action.mutate({ path: `/servers/${s.id}/backups` })
                    }
                  >
                    {t("backupCreate")}
                  </MineButton>
                </div>
              </article>
            ))}
          </div>
        )}
      </MinePanel>
      <UploadDialog
        server={s}
        open={upload}
        onOpenChange={setUpload}
        defaultKind="world"
      />
      <MineModal
        open={!!regenerate}
        onOpenChange={(v) => {
          if (!v) setRegenerate(null);
        }}
        title={t("regenerate")}
        description={t("backupHint")}
      >
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
                path: `/servers/${s.id}/worlds/regenerate`,
                body: { confirm, path: regenerate!.path },
              },
              { onSuccess: () => setRegenerate(null) },
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
