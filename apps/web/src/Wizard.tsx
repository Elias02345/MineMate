import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, ArrowLeft, Check } from "lucide-react";
import { useI18n, type TranslationKey } from "./i18n.tsx";
import { api, mutate } from "./api.ts";
import { ErrorNotice } from "./hooks.tsx";
import { UploadPicker } from "./UploadPicker.tsx";
import {
  uploadSelection,
  waitForOperation,
  selectionError,
} from "./uploads.ts";
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
    [files, setFiles] = useState<File[]>([]),
    [folderWorld, setFolderWorld] = useState(false),
    [serverSource, setServerSource] =
      useState<ServerConfig["serverSource"]>("download"),
    [serverJar, setServerJar] = useState<File | null>(null),
    [contentJars, setContentJars] = useState<File[]>([]),
    [percent, setPercent] = useState(0),
    created = useRef<{ server: Server; operation: Operation } | null>(null),
    completedUploads = useRef(new Set<string>()),
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
  const atm = edition === "JAVA" && style === "atm",
    atmZipReady =
      files.length === 1 &&
      /\.zip$/i.test(files[0]!.name) &&
      !selectionError(files, false),
    supportsContent = edition === "JAVA" && !atm && software !== "VANILLA",
    plugins = ["PAPER", "PURPUR"].includes(software),
    contentStep: TranslationKey = plugins ? "wizardPlugins" : "wizardMods",
    contentLabel = t(plugins ? "pluginJarUpload" : "modJarUpload"),
    contentError =
      selectionError(contentJars, false) ??
      (contentJars.some((file) => !/\.jar$/i.test(file.name))
        ? "uploadJarTypeError"
        : null),
    stepKeys = [
      "wizardEdition",
      "wizardStyle",
      ...(atm ? ["wizardAtm"] : ["wizardVersion"]),
      ...(supportsContent ? [contentStep] : []),
      "wizardResources",
      ...(atm ? [] : ["wizardWorld"]),
      "wizardEula",
      "wizardReview",
    ] as TranslationKey[],
    currentStep = stepKeys[step];
  const config: ServerConfig = {
    name: name || t("worldDefault"),
    edition,
    software: edition === "BEDROCK" ? "BEDROCK" : atm ? "NEOFORGE" : software,
    // The provisional version never starts a Minecraft container. The server
    // ZIP's installer supplies the actual version and loader on import.
    version:
      edition === "BEDROCK"
        ? version || "LATEST"
        : atm
          ? version || "1.21.1"
          : version,
    serverSource:
      edition === "BEDROCK" ? "download" : atm ? "upload" : serverSource,
    loaderVersion: atm ? "" : loader,
    memoryMb: memory,
    cpu,
    maxPlayers,
    java: atm ? "auto" : java,
    jvmFlags: "",
    seed: atm ? "" : seed,
    sleepMinutes: 0,
    eula: true,
    ...(port ? { port: Number(port) } : {}),
  };
  const create = useMutation({
    mutationFn: async () => {
      setPhase(t("createProgress"));
      const result =
        created.current ??
        (await mutate<{ server: Server; operation: Operation }>(
          "/servers",
          config,
        ));
      created.current = result;
      await client.invalidateQueries();
      if (serverJar || files.length || contentJars.length) {
        await waitForOperation(result.operation, result.server.id, setPhase);
        if (serverJar && !atm && !completedUploads.current.has("server")) {
          setPhase(t("uploadTransferring"));
          setPercent(0);
          const uploaded = await uploadSelection(
            result.server.id,
            "custom",
            [serverJar],
            setPercent,
            software,
            "",
            setPhase,
          );
          await waitForOperation(
            uploaded.operation,
            result.server.id,
            setPhase,
          );
          completedUploads.current.add("server");
        }
        if (files.length && !completedUploads.current.has("world")) {
          const kind =
            worldKind === "atm"
              ? "atm"
              : worldKind === "pack"
                ? "modpack"
                : worldKind === "server"
                  ? "server"
                  : folderWorld
                    ? "world-folder"
                    : "world";
          setPhase(t("uploadTransferring"));
          setPercent(0);
          const uploaded = await uploadSelection(
            result.server.id,
            kind,
            files,
            setPercent,
            undefined,
            "",
            setPhase,
          );
          await waitForOperation(
            uploaded.operation,
            result.server.id,
            setPhase,
          );
          completedUploads.current.add("world");
        }
        // Import archives first so their content cannot overwrite this selection.
        if (contentJars.length && !completedUploads.current.has("content")) {
          setPhase(contentLabel);
          setPercent(0);
          const uploaded = await uploadSelection(
            result.server.id,
            "jar",
            contentJars,
            setPercent,
            undefined,
            "",
            setPhase,
          );
          await waitForOperation(
            uploaded.operation,
            result.server.id,
            setPhase,
          );
          completedUploads.current.add("content");
        }
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
        : value === "atm"
          ? "NEOFORGE"
          : value === "mods" || value === "modpack"
            ? "FABRIC"
            : value === "custom"
              ? "CUSTOM"
              : "VANILLA",
    );
    setWorldKind(
      value === "atm" ? "atm" : value === "modpack" ? "pack" : "new",
    );
    setServerSource(
      value === "custom" || value === "atm" ? "upload" : "download",
    );
    if (value === "atm") {
      setMemory(8192);
      setCpu(4);
      setJava("auto");
      setLoader("");
    }
    setServerJar(null);
    setContentJars([]);
    setFiles([]);
    setFolderWorld(false);
  }
  const ready =
    currentStep === "wizardAtm"
      ? atmZipReady
      : currentStep === "wizardVersion"
        ? edition === "BEDROCK" ||
          (!!version && (serverSource !== "upload" || !!serverJar))
        : currentStep === contentStep
          ? !contentError
          : currentStep === "wizardWorld"
            ? worldKind === "new" ||
              (files.length > 0 && !selectionError(files, folderWorld))
            : currentStep === "wizardEula"
              ? eula
              : currentStep === "wizardReview"
                ? eula &&
                  !!(name || t("worldDefault")) &&
                  (atm ||
                    serverSource !== "upload" ||
                    !!serverJar ||
                    completedUploads.current.has("server")) &&
                  (atm
                    ? atmZipReady || completedUploads.current.has("world")
                    : worldKind === "new" ||
                      completedUploads.current.has("world") ||
                      (files.length > 0 &&
                        !selectionError(files, folderWorld))) &&
                  (completedUploads.current.has("content") || !contentError)
                : true;
  return (
    <MineModal
      open={open}
      onOpenChange={(value) => {
        if (!create.isPending) onOpenChange(value);
      }}
      title={t("wizardTitle")}
      footer={
        !create.isPending ? (
          <div className="wizard-controls">
            <MineButton
              variant="secondary"
              disabled={!!created.current}
              onClick={() =>
                step === 0 ? onOpenChange(false) : setStep(step - 1)
              }
            >
              <ArrowLeft size={17} />
              {t(step === 0 ? "cancel" : "back")}
            </MineButton>
            {step < stepKeys.length - 1 ? (
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
        ) : undefined
      }
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
        <div className="upload-progress" role="status">
          {percent > 0 && (
            <>
              <b>{percent}%</b>
              <progress
                value={percent}
                max={100}
                aria-label={t("uploadTransferring")}
              />
            </>
          )}
          <MineProgress message={phase || t("createProgress")} />
        </div>
      ) : (
        <>
          <h2 className="wizard-step-heading">{t(stepKeys[step]!)}</h2>
          {currentStep === "wizardEdition" && (
            <div className="choice-grid">
              <Choice
                selected={edition === "JAVA"}
                icon="grassBlock"
                title={t("edition") + " · Java"}
                hint={t("javaHint")}
                onClick={() => {
                  setEdition("JAVA");
                  pickStyle("vanilla");
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
                  pickStyle("vanilla");
                  setVersion("LATEST");
                }}
              />
            </div>
          )}
          {currentStep === "wizardStyle" &&
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
                      id: "atm",
                      icon: "chest",
                      title: "atmStyle",
                      hint: "atmStyleHint",
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
          {currentStep === "wizardAtm" && (
            <>
              <MineNotice>{t("atmUploadHint")}</MineNotice>
              <UploadPicker
                files={files}
                onChange={setFiles}
                accept=".zip"
                label={t("atmZipUpload")}
              />
              {files.length > 0 && !atmZipReady && (
                <MineNotice>
                  {t(selectionError(files, false) ?? "atmZipOnly")}
                </MineNotice>
              )}
            </>
          )}
          {currentStep === "wizardVersion" && (
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
              {edition === "JAVA" && (
                <>
                  <label className="field">
                    <span>{t("software")}</span>
                    <select
                      value={software}
                      onChange={(e) => {
                        const value = e.target
                          .value as ServerConfig["software"];
                        setSoftware(value);
                        setContentJars([]);
                        if (value === "CUSTOM") setServerSource("upload");
                        setServerJar(null);
                      }}
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

                  <label className="field">
                    <span>{t("serverSource")}</span>
                    <select
                      value={serverSource}
                      onChange={(event) => {
                        setServerSource(
                          event.target.value as typeof serverSource,
                        );
                        setServerJar(null);
                      }}
                    >
                      {software !== "CUSTOM" && (
                        <option value="download">
                          {t("automaticDownload")}
                        </option>
                      )}
                      <option value="upload">{t("uploadServerJar")}</option>
                    </select>
                  </label>
                  {serverSource === "upload" && (
                    <>
                      <MineNotice>
                        {t(
                          ["FORGE", "NEOFORGE"].includes(software)
                            ? "installerUploadHint"
                            : "serverJarUploadHint",
                        )}
                      </MineNotice>
                      <UploadPicker
                        files={serverJar ? [serverJar] : []}
                        onChange={(values) => setServerJar(values[0] ?? null)}
                        accept=".jar"
                        label={t("serverJarUpload")}
                      />
                    </>
                  )}
                </>
              )}

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
          {currentStep === contentStep && (
            <>
              <MineNotice>
                {t(plugins ? "pluginUploadHint" : "modUploadHint")}
              </MineNotice>
              <p className="muted">{t("wizardContentOptional")}</p>
              <UploadPicker
                files={contentJars}
                onChange={setContentJars}
                accept=".jar"
                multiple
                label={contentLabel}
              />
              {contentError && <MineNotice>{t(contentError)}</MineNotice>}
            </>
          )}
          {currentStep === "wizardResources" && (
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
          {currentStep === "wizardWorld" && (
            <>
              <label className="field">
                <span>{t("wizardWorld")}</span>
                <select
                  value={worldKind}
                  onChange={(e) => {
                    setWorldKind(e.target.value);
                    setFiles([]);
                    setFolderWorld(false);
                  }}
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
              {worldKind !== "new" && (
                <>
                  {worldKind === "world" && (
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={folderWorld}
                        onChange={(event) => {
                          setFolderWorld(event.target.checked);
                          setFiles([]);
                        }}
                      />
                      {t("worldFolderUpload")}
                    </label>
                  )}
                  <UploadPicker
                    files={files}
                    onChange={setFiles}
                    folder={folderWorld}
                    accept=".zip,.mrpack,.mcworld"
                    label={t(folderWorld ? "chooseFolder" : "chooseArchive")}
                  />
                  {selectionError(files, folderWorld) && (
                    <MineNotice>
                      {t(selectionError(files, folderWorld)!)}
                    </MineNotice>
                  )}
                  {worldKind === "world" && (
                    <MineNotice>{t("worldUploadHint")}</MineNotice>
                  )}
                  {worldKind === "pack" && (
                    <MineNotice>{t("packImportHint")}</MineNotice>
                  )}
                </>
              )}
            </>
          )}
          {currentStep === "wizardEula" && (
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
          {currentStep === "wizardReview" && (
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
                  [t("version"), atm ? t("atmAutoDetected") : config.version],
                  [t("software"), atm ? t("atmAutoDetected") : config.software],
                  [t("memory"), `${memory} MB`],
                  [t("cpu"), String(cpu)],
                  [t("maxPlayers"), String(maxPlayers)],
                  [
                    atm ? t("atmZipUpload") : t("worlds"),
                    files.length
                      ? files[0]!.webkitRelativePath.split("/")[0] ||
                        files[0]!.name
                      : t("newWorld"),
                  ],
                  ...(contentJars.length
                    ? [
                        [
                          contentLabel,
                          contentJars.map((file) => file.name).join(", "),
                        ],
                      ]
                    : []),
                  ...(serverJar
                    ? [[t("serverJarUpload"), serverJar.name]]
                    : []),
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
          {create.error && created.current && (
            <>
              <MineNotice>{t("createdWorldRetained")}</MineNotice>
              {serverSource === "upload" &&
                !atm &&
                !completedUploads.current.has("server") && (
                  <UploadPicker
                    files={serverJar ? [serverJar] : []}
                    onChange={(values) => setServerJar(values[0] ?? null)}
                    accept=".jar"
                    label={t("serverJarUpload")}
                  />
                )}
              {worldKind !== "new" &&
                !completedUploads.current.has("world") && (
                  <UploadPicker
                    files={files}
                    onChange={setFiles}
                    folder={folderWorld}
                    accept={atm ? ".zip" : ".zip,.mrpack,.mcworld"}
                    label={t(
                      atm
                        ? "atmZipUpload"
                        : folderWorld
                          ? "chooseFolder"
                          : "chooseArchive",
                    )}
                  />
                )}
              {supportsContent && !completedUploads.current.has("content") && (
                <>
                  <UploadPicker
                    files={contentJars}
                    onChange={setContentJars}
                    accept=".jar"
                    multiple
                    label={contentLabel}
                  />
                  {contentError && <MineNotice>{t(contentError)}</MineNotice>}
                </>
              )}
              <MineButton
                variant="secondary"
                onClick={() => {
                  onOpenChange(false);
                  void navigate({
                    to: "/servers/$serverId",
                    params: { serverId: created.current!.server.id },
                  });
                }}
              >
                {t("openCreatedWorld")}
              </MineButton>
            </>
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
