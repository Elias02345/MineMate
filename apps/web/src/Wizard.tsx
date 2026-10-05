import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, ArrowLeft, Check } from "lucide-react";
import { useI18n, type TranslationKey } from "./i18n.tsx";
import { api, mutate } from "./api.ts";
import { ErrorNotice } from "./hooks.tsx";
import {
  MineButton,
  MineModal,
  MineInput,
  MineNotice,
  MineProgress,
  Asset,
  MineBadge,
} from "../../../packages/ui/src/index.tsx";
import type { AssetName } from "../../../packages/ui/src/assets.tsx";
import type {
  ServerConfig,
  Server,
  Operation,
  HostStatus,
} from "../../../packages/shared/src/index.ts";
const stepKeys: TranslationKey[] = [
  "wizardEdition",
  "wizardStyle",
  "wizardVersion",
  "wizardResources",
  "wizardWorld",
  "wizardEula",
  "wizardReview",
];
export function Wizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const { t } = useI18n(),
    navigate = useNavigate(),
    client = useQueryClient(),
    [step, setStep] = useState(0),
    [edition, setEdition] = useState<"JAVA" | "BEDROCK">("JAVA"),
    [style, setStyle] = useState("vanilla"),
    [version, setVersion] = useState(""),
    [name, setName] = useState(""),
    [memory, setMemory] = useState(2048),
    [cpu, setCpu] = useState(2),
    [maxPlayers, setMaxPlayers] = useState(20),
    [software, setSoftware] = useState<ServerConfig["software"]>("VANILLA"),
    [loader, setLoader] = useState(""),
    [advanced, setAdvanced] = useState(false),
    [port, setPort] = useState(""),
    [java, setJava] = useState<ServerConfig["java"]>("auto"),
    [seed, setSeed] = useState(""),
    [worldKind, setWorldKind] = useState("new"),
    [file, setFile] = useState<File | null>(null),
    [eula, setEula] = useState(false),
    [phase, setPhase] = useState("");
  const versions = useQuery({
      queryKey: ["versions"],
      queryFn: () =>
        api<{ recommended: string; versions: string[] }>("/versions"),
      enabled: open,
    }),
    host = useQuery({
      queryKey: ["host"],
      queryFn: () => api<HostStatus>("/system/checks"),
      enabled: open,
      staleTime: 60000,
    });
  useEffect(() => {
    if (!version && versions.data) setVersion(versions.data.recommended);
  }, [versions.data, version]);
  const config: ServerConfig = {
    name: name || t("worldDefault"),
    edition,
    software: edition === "BEDROCK" ? "BEDROCK" : software,
    version: edition === "BEDROCK" ? version || "LATEST" : version,
    loaderVersion: loader,
    memoryMb: memory,
    cpu,
    maxPlayers,
    java,
    jvmFlags: "",
    seed,
    sleepMinutes: 0,
    eula: true,
    ...(port ? { port: Number(port) } : {}),
  };
  const create = useMutation({
    mutationFn: async () => {
      setPhase(t("createProgress"));
      const result = await mutate<{ server: Server; operation: Operation }>(
        "/servers",
        config,
      );
      await client.invalidateQueries();
      if (file) {
        let done = false;
        for (let i = 0; i < 300; i++) {
          const operations = await api<Operation[]>(
              `/operations?serverId=${result.server.id}`,
            ),
            op = operations.find((o) => o.id === result.operation.id);
          setPhase(op?.phase ?? t("createProgress"));
          if (op?.status === "FAILED")
            throw new Error(op.error ?? "Creation failed");
          if (op?.status === "SUCCEEDED") {
            done = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (!done)
          throw new Error(
            "Creation is still in progress. Open the world to follow it.",
          );
        const form = new FormData();
        form.append("file", file);
        const kind =
          style === "custom"
            ? "custom"
            : style === "modpack"
              ? "modpack"
              : worldKind === "server"
                ? "server"
                : worldKind === "pack"
                  ? "modpack"
                  : "world";
        await api(
          `/servers/${result.server.id}/uploads?kind=${kind}&confirm=true`,
          { method: "POST", body: form },
        );
      }
      return result;
    },
    onSuccess: (result) => {
      onOpenChange(false);
      void client.invalidateQueries();
      void navigate({
        to: "/servers/$serverId",
        params: { serverId: result.server.id },
      });
    },
  });
  function pickStyle(value: string) {
    setStyle(value);
    setSoftware(
      value === "plugins"
        ? "PAPER"
        : value === "mods" || value === "modpack"
          ? "FABRIC"
          : value === "custom"
            ? "CUSTOM"
            : "VANILLA",
    );
    if (value === "modpack") setWorldKind("pack");
  }
  const ready =
    step === 2
      ? edition === "BEDROCK" || !!version
      : step === 4
        ? (worldKind === "new" && style !== "custom") || !!file
        : step === 5
          ? eula
          : step === 6
            ? eula && !!(name || t("worldDefault"))
            : true;
  return (
    <MineModal
      open={open}
      onOpenChange={(value) => {
        if (!create.isPending) onOpenChange(value);
      }}
      title={t("wizardTitle")}
    >
      <div className="wizard-progress" aria-label={t("create")}>
        {stepKeys.map((key, i) => (
          <div key={key} className={i <= step ? "complete" : ""}>
            <b>{i < step ? <Check size={13} /> : i + 1}</b>
            <span>{t(key)}</span>
          </div>
        ))}
      </div>
      {create.isPending ? (
        <MineProgress message={phase || t("createProgress")} />
      ) : (
        <>
          <h2 className="wizard-step-heading">{t(stepKeys[step]!)}</h2>
          {step === 0 && (
            <div className="choice-grid">
              <Choice
                selected={edition === "JAVA"}
                icon="grassBlock"
                title={t("edition") + " · Java"}
                hint={t("javaHint")}
                onClick={() => {
                  setEdition("JAVA");
                  setVersion(versions.data?.recommended ?? "");
                }}
              />
              <Choice
                selected={edition === "BEDROCK"}
                icon="diamond"
                title={t("edition") + " · Bedrock"}
                hint={t("bedrockHint")}
                onClick={() => {
                  setEdition("BEDROCK");
                  setVersion("LATEST");
                }}
              />
            </div>
          )}
          {step === 1 &&
            (edition === "BEDROCK" ? (
              <MineNotice>{t("bedrockHint")}</MineNotice>
            ) : (
              <div className="choice-grid">
                {(
                  [
                    {
                      id: "vanilla",
                      icon: "grassBlock",
                      title: "vanilla",
                      hint: "vanillaHint",
                    },
                    {
                      id: "plugins",
                      icon: "book",
                      title: "plugins",
                      hint: "pluginsHint",
                    },
                    {
                      id: "mods",
                      icon: "enderPearl",
                      title: "mods",
                      hint: "modsHint",
                    },
                    {
                      id: "modpack",
                      icon: "chest",
                      title: "modpack",
                      hint: "modpackHint",
                    },
                    {
                      id: "custom",
                      icon: "pickaxe",
                      title: "customJar",
                      hint: "customJarHint",
                    },
                  ] as {
                    id: string;
                    icon: AssetName;
                    title: TranslationKey;
                    hint: TranslationKey;
                  }[]
                ).map((c) => (
                  <Choice
                    key={c.id}
                    selected={style === c.id}
                    icon={c.icon}
                    title={t(c.title)}
                    hint={t(c.hint)}
                    onClick={() => pickStyle(c.id)}
                  />
                ))}
              </div>
            ))}
          {step === 2 && (
            <>
              <MineBadge tone="grass">{t("recommended")}</MineBadge>
              <label className="field">
                <span>{t("version")}</span>
                <select
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                >
                  {edition === "BEDROCK" ? (
                    <option value="LATEST">LATEST</option>
                  ) : (
                    versions.data?.versions.map((v) => (
                      <option key={v}>{v}</option>
                    ))
                  )}
                </select>
              </label>
              <MineInput
                label={t("manualVersion")}
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                required
              />
              <ErrorNotice error={versions.error} />
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={advanced}
                  onChange={(e) => setAdvanced(e.target.checked)}
                />
                {t("advanced")}
              </label>
              {advanced && edition === "JAVA" && (
                <div className="form-grid">
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
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <MineInput
                    label={t("loader")}
                    value={loader}
                    onChange={(e) => setLoader(e.target.value)}
                  />
                  <label className="field">
                    <span>{t("javaRuntime")}</span>
                    <select
                      value={java}
                      onChange={(e) =>
                        setJava(e.target.value as ServerConfig["java"])
                      }
                    >
                      {["auto", "8", "11", "16", "17", "21", "25"].map((j) => (
                        <option key={j} value={j}>
                          {j === "auto" ? t("auto") : j}
                        </option>
                      ))}
                    </select>
                  </label>
                  <MineInput
                    label={t("port")}
                    type="number"
                    min={1024}
                    max={65535}
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                  />
                </div>
              )}
            </>
          )}
          {step === 3 && (
            <>
              <div className="choice-grid resources">
                {(
                  [
                    { m: 2048, c: 2, k: "small", h: "smallHint" },
                    { m: 4096, c: 3, k: "medium", h: "mediumHint" },
                    { m: 8192, c: 4, k: "large", h: "largeHint" },
                  ] as {
                    m: number;
                    c: number;
                    k: TranslationKey;
                    h: TranslationKey;
                  }[]
                ).map((p) => (
                  <Choice
                    key={p.k}
                    selected={memory === p.m}
                    icon="grassBlock"
                    title={t(p.k)}
                    hint={t(p.h)}
                    onClick={() => {
                      setMemory(p.m);
                      setCpu(p.c);
                    }}
                  />
                ))}
              </div>
              <div className="form-grid">
                <MineInput
                  label={t("memoryMb")}
                  type="number"
                  min={512}
                  max={262144}
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
                  label={t("maxPlayers")}
                  type="number"
                  min={1}
                  value={maxPlayers}
                  onChange={(e) => setMaxPlayers(Number(e.target.value))}
                />
              </div>
              <p className="muted">
                {host.data
                  ? `${host.data.memoryMb} MB · ${host.data.cpus} CPU`
                  : t("hostHint")}
              </p>
              <MineNotice>{t("resourceWarning")}</MineNotice>
            </>
          )}
          {step === 4 && (
            <>
              <label className="field">
                <span>{t("wizardWorld")}</span>
                <select
                  value={worldKind}
                  onChange={(e) => setWorldKind(e.target.value)}
                >
                  <option value="new">{t("newWorld")}</option>
                  <option value="world">{t("worldImport")}</option>
                  <option value="server">{t("serverImport")}</option>
                  <option value="pack">{t("packImport")}</option>
                </select>
              </label>
              <MineInput
                label={t("seed")}
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
              />
              {(worldKind !== "new" || style === "custom") && (
                <label className="drop-zone">
                  <Asset name="chest" size={44} />
                  <b>{t("chooseArchive")}</b>
                  <span>{file?.name ?? t("archiveHint")}</span>
                  <input
                    type="file"
                    accept={style === "custom" ? ".jar" : ".zip,.mrpack"}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              )}
              {style === "custom" && (
                <MineNotice>{t("customWarning")}</MineNotice>
              )}
            </>
          )}
          {step === 5 && (
            <div className="eula-book">
              <Asset name="book" size={60} />
              <p>{t("eulaText")}</p>
              <a
                href="https://www.minecraft.net/eula"
                target="_blank"
                rel="noreferrer"
              >
                {t("eulaLink")} ↗
              </a>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={eula}
                  onChange={(e) => setEula(e.target.checked)}
                />
                {t("eulaAccept")}
              </label>
            </div>
          )}
          {step === 6 && (
            <>
              <MineInput
                label={t("worldName")}
                value={name}
                placeholder={t("worldDefault")}
                maxLength={64}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="review-grid">
                {[
                  [t("edition"), config.edition],
                  [t("version"), config.version],
                  [t("software"), config.software],
                  [t("memory"), `${memory} MB`],
                  [t("cpu"), String(cpu)],
                  [t("maxPlayers"), String(maxPlayers)],
                  [t("worlds"), file?.name ?? t("newWorld")],
                ].map(([k, v]) => (
                  <div key={k}>
                    <small>{k}</small>
                    <b>{v}</b>
                  </div>
                ))}
              </div>
              {host.data && !host.data.ready && (
                <MineNotice>
                  {host.data.checks
                    .filter((c) => !c.ok)
                    .map((c) => (
                      <p key={c.key}>{c.message}</p>
                    ))}
                </MineNotice>
              )}
            </>
          )}
          <ErrorNotice error={create.error} />
          {!create.isPending && (
            <div className="wizard-controls">
              <MineButton
                variant="secondary"
                onClick={() =>
                  step === 0 ? onOpenChange(false) : setStep(step - 1)
                }
              >
                <ArrowLeft size={17} />
                {t(step === 0 ? "cancel" : "back")}
              </MineButton>
              {step < 6 ? (
                <MineButton disabled={!ready} onClick={() => setStep(step + 1)}>
                  {t("next")}
                  <ArrowRight size={17} />
                </MineButton>
              ) : (
                <MineButton
                  disabled={!ready || create.isPending}
                  onClick={() => create.mutate()}
                >
                  <Asset name="grassBlock" size={20} />
                  {t("createNow")}
                </MineButton>
              )}
            </div>
          )}
        </>
      )}
    </MineModal>
  );
}
function Choice({
  selected,
  icon,
  title,
  hint,
  onClick,
}: {
  selected: boolean;
  icon: AssetName;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={"choice-card " + (selected ? "selected" : "")}
      aria-pressed={selected}
      onClick={onClick}
    >
      <Asset name={icon} size={48} />
      <b>{title}</b>
      <span>{hint}</span>
      {selected && <Check size={17} className="choice-check" />}
    </button>
  );
}
