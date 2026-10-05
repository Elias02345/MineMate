import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, mutate } from "../api.ts";
import { useI18n } from "../i18n.tsx";
import { ErrorNotice, useAction } from "../hooks.tsx";
import {
  MinePanel,
  MineButton,
  MineEmpty,
  MineProgress,
  MineInput,
  MineBadge,
  MineModal,
  MineNotice,
  Asset,
  MineItemSlot,
} from "../../../../packages/ui/src/index.tsx";
import type {
  Server,
  InstalledContent,
} from "../../../../packages/shared/src/index.ts";
import type {
  Project,
  InstallPlan,
  ContentVersion,
} from "../../../../packages/mod-platforms/src/index.ts";
export default function ContentPanel({ server: s }: { server: Server }) {
  const { t } = useI18n(),
    client = useQueryClient(),
    action = useAction(),
    [kind, setKind] = useState(
      ["PAPER", "PURPUR"].includes(s.config.software)
        ? "plugin"
        : s.config.software === "VANILLA"
          ? "datapack"
          : "mod",
    ),
    [versionId, setVersionId] = useState(""),
    [query, setQuery] = useState(""),
    [source, setSource] = useState("modrinth"),
    [search, setSearch] = useState(""),
    [project, setProject] = useState<Project | null>(null),
    [plan, setPlan] = useState<InstallPlan | null>(null),
    [upload, setUpload] = useState(false);
  const installed = useQuery({
      queryKey: ["content", s.id],
      queryFn: () => api<InstalledContent[]>(`/servers/${s.id}/content`),
    }),
    market = useQuery({
      queryKey: ["market", s.id, source, search, kind],
      queryFn: () =>
        api<Project[]>(
          `/marketplace?serverId=${s.id}&source=${source}&kind=${kind}&q=${encodeURIComponent(search)}`,
        ),
      enabled: s.config.edition === "JAVA",
    });
  const details = useQuery({
    queryKey: ["project", project?.source, project?.id, s.id],
    queryFn: () =>
      api<{ project: Project; versions: ContentVersion[] }>(
        `/marketplace/${project!.source}/${project!.id}?serverId=${s.id}`,
      ),
    enabled: !!project,
  });
  const resolve = useMutation({
    mutationFn: ({ p, versionId }: { p: Project; versionId?: string }) =>
      mutate<InstallPlan>(`/servers/${s.id}/content/plan`, {
        source: p.source,
        projectId: p.id,
        versionId,
      }),
    onSuccess: (p) => setPlan(p),
  });
  return (
    <>
      {s.config.edition === "JAVA" && (
        <MinePanel>
          <div className="section-heading">
            <div>
              <h2>
                <Asset name="enderPearl" size={28} />
                {t("browse")}
              </h2>
              <p>
                {t("marketplaceHint")} · {s.config.version} /{" "}
                {s.config.software}
              </p>
            </div>
            <MineButton variant="secondary" onClick={() => setUpload(true)}>
              {t("contentUpload")}
            </MineButton>
          </div>
          <form
            className="market-search"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(query);
            }}
          >
            <MineInput
              label={t("search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="field">
              <span>{t("source")}</span>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="modrinth">Modrinth</option>
                <option value="curseforge">CurseForge</option>
              </select>
            </label>
            <label className="field">
              <span>{t("contentKind")}</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {["mod", "plugin", "datapack", "modpack"].map((k) => (
                  <option key={k} value={k}>
                    {t(k as "mod" | "plugin" | "datapack" | "modpack")}
                  </option>
                ))}
              </select>
            </label>
            <MineButton type="submit">{t("search")}</MineButton>
          </form>
          {market.isPending ? (
            <MineProgress message={t("loading")} />
          ) : market.error ? (
            <>
              <MineNotice>{t("marketplaceUnavailable")}</MineNotice>
              <ErrorNotice error={market.error} />
            </>
          ) : (
            <div className="market-grid">
              {market.data?.map((p) => (
                <button
                  className="market-item"
                  key={p.id}
                  onClick={() => {
                    setProject(p);
                    setPlan(null);
                    setVersionId("");
                    resolve.mutate({ p });
                  }}
                >
                  <MineItemSlot>
                    {p.icon ? (
                      <img src={p.icon} alt="" loading="lazy" />
                    ) : (
                      <Asset name="diamond" size={45} />
                    )}
                  </MineItemSlot>
                  <h3>{p.title}</h3>
                  <p>{p.description}</p>
                  <small>
                    {p.author} · {p.downloads.toLocaleString()}
                  </small>
                </button>
              ))}
            </div>
          )}
        </MinePanel>
      )}
      <MinePanel>
        <div className="section-heading">
          <h2>{t("installed")}</h2>
          {s.config.edition === "JAVA" && (
            <MineButton variant="secondary" onClick={() => setUpload(true)}>
              {t("packUpload")}
            </MineButton>
          )}
        </div>
        <ErrorNotice error={installed.error ?? action.error} />
        {!installed.data?.length ? (
          <MineEmpty
            icon="enderPearl"
            title={t("inventoryEmpty")}
            description={t("inventoryEmptyBody")}
          />
        ) : (
          <div className="inventory-list">
            {installed.data.map((i) => (
              <div key={i.id}>
                <MineItemSlot>
                  <Asset name={i.managed ? "diamond" : "pickaxe"} />
                </MineItemSlot>
                <span>
                  <b>{i.filename.split("/").at(-1)}</b>
                  <small>
                    {i.managed ? `${i.source} · ${i.versionId}` : t("manual")}
                  </small>
                </span>
                <MineButton
                  variant="ghost"
                  onClick={() => {
                    if (window.confirm(t("remove") + " " + i.filename + "?"))
                      action.mutate({
                        path: `/servers/${s.id}/content/${i.id}`,
                        method: "DELETE",
                        body: { confirm: true },
                      });
                  }}
                >
                  {t("remove")}
                </MineButton>
              </div>
            ))}
          </div>
        )}
      </MinePanel>
      <MineModal
        open={!!project}
        onOpenChange={(open) => {
          if (!open) setProject(null);
        }}
        title={project?.title ?? t("installPlan")}
        description={project?.description}
      >
        {details.data && (
          <>
            <div className="project-gallery">
              {details.data.project.gallery.slice(0, 5).map((src) => (
                <img
                  key={src}
                  src={src}
                  alt={details.data.project.title}
                  loading="lazy"
                />
              ))}
            </div>
            <label className="field">
              <span>{t("versionHistory")}</span>
              <select
                value={versionId}
                onChange={(e) => {
                  setVersionId(e.target.value);
                  resolve.mutate({
                    p: project!,
                    versionId: e.target.value || undefined,
                  });
                }}
              >
                <option value="">{t("recommended")}</option>
                {details.data.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {new Date(v.published).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <h3>{t("installPlan")}</h3>
        <p>{t("planHint")}</p>
        {resolve.isPending ? (
          <MineProgress message={t("loading")} />
        ) : (
          plan && (
            <>
              <div className="recipe-list">
                {plan.versions.map((v) => (
                  <div key={v.id}>
                    <Asset name="diamond" size={22} />
                    <span>
                      <b>{v.name}</b>
                      <small>{v.filename}</small>
                    </span>
                    <MineBadge>{v.gameVersions.join(", ")}</MineBadge>
                  </div>
                ))}
              </div>
              {plan.warnings.map((w) => (
                <MineNotice key={w}>{w}</MineNotice>
              ))}
              <MineButton
                disabled={action.isPending}
                onClick={() =>
                  action.mutate(
                    {
                      path: `/servers/${s.id}/content/install`,
                      body: {
                        source: project!.source,
                        projectId: project!.id,
                        versionId: versionId || undefined,
                        confirm: true,
                      },
                    },
                    {
                      onSuccess: () => {
                        setProject(null);
                        void client.invalidateQueries();
                      },
                    },
                  )
                }
              >
                {t("install")}
              </MineButton>
            </>
          )
        )}
        <ErrorNotice error={details.error ?? resolve.error ?? action.error} />
      </MineModal>
      <UploadDialog server={s} open={upload} onOpenChange={setUpload} />
    </>
  );
}
export function UploadDialog({
  server: s,
  open,
  onOpenChange,
  defaultKind = "jar",
  directory = "",
}: {
  server: Server;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultKind?: string;
  directory?: string;
}) {
  const { t } = useI18n(),
    client = useQueryClient(),
    [kind, setKind] = useState(defaultKind),
    [files, setFiles] = useState<File[]>([]),
    [confirmed, setConfirmed] = useState(false);
  const upload = useMutation({
    mutationFn: () => {
      const body = new FormData();
      for (const file of files) body.append("file", file);
      return api(
        `/servers/${s.id}/uploads?kind=${kind}&directory=${encodeURIComponent(directory)}&confirm=true`,
        { method: "POST", body },
      );
    },
    onSuccess: () => {
      onOpenChange(false);
      void client.invalidateQueries();
    },
  });
  return (
    <MineModal open={open} onOpenChange={onOpenChange} title={t("upload")}>
      <label className="field">
        <span>{t("upload")}</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {defaultKind === "file" && <option value="file">{t("files")}</option>}
          {s.config.edition === "JAVA" && (
            <>
              <option value="jar">{t("contentUpload")}</option>
              <option value="custom">{t("customJar")}</option>
              <option value="modpack">{t("packUpload")}</option>
            </>
          )}
          <option value="world">{t("worldImport")}</option>
          <option value="server">{t("serverImport")}</option>
        </select>
      </label>
      <label className="drop-zone">
        <Asset name="chest" size={50} />
        <b>{t("chooseArchive")}</b>
        <small>{t("archiveHint")}</small>
        <input
          type="file"
          multiple={kind === "jar" || kind === "file"}
          accept={
            kind === "file"
              ? undefined
              : kind === "jar" || kind === "custom"
                ? ".jar"
                : ".zip,.mrpack"
          }
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
        {files.map((f) => (
          <span key={f.name}>{f.name}</span>
        ))}
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        {t("uploadConfirm")}
      </label>
      {(kind === "jar" || kind === "custom") && (
        <MineNotice>{t("customWarning")}</MineNotice>
      )}
      <MineButton
        disabled={!files.length || !confirmed || upload.isPending}
        onClick={() => upload.mutate()}
      >
        {t(upload.isPending ? "loading" : "upload")}
      </MineButton>
      <ErrorNotice error={upload.error} />
    </MineModal>
  );
}
