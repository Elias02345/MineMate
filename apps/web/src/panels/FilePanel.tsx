import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Folder, File, ChevronRight, ArrowUp } from "lucide-react";
import { api } from "../api.ts";
import { useI18n } from "../i18n.tsx";
import { ErrorNotice, useAction } from "../hooks.tsx";
import { UploadDialog } from "./ContentPanel.tsx";
import { CodeEditor } from "../CodeEditor.tsx";
import { bytes } from "../Dashboard.tsx";
import {
  MinePanel,
  MineButton,
  MineEmpty,
  MineInput,
  MineModal,
  MineNotice,
  MineProgress,
} from "../../../../packages/ui/src/index.tsx";
import type { Server } from "../../../../packages/shared/src/index.ts";
interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  bytes: number;
  modifiedAt: string;
}
export default function FilePanel({ server: s }: { server: Server }) {
  const { t } = useI18n(),
    action = useAction(),
    [upload, setUpload] = useState(false),
    [readError, setReadError] = useState<unknown>(null),
    [directory, setDirectory] = useState(""),
    [selected, setSelected] = useState<FileEntry | null>(null),
    [editor, setEditor] = useState(false),
    [text, setText] = useState(""),
    [original, setOriginal] = useState(""),
    [revision, setRevision] = useState(""),
    [newFolder, setNewFolder] = useState(false),
    [folder, setFolder] = useState("");
  const list = useQuery({
    queryKey: ["files", s.id, directory],
    queryFn: () =>
      api<FileEntry[]>(
        `/servers/${s.id}/files?path=${encodeURIComponent(directory)}`,
      ),
  });
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (text !== original) e.preventDefault();
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [text, original]);
  async function edit(f: FileEntry) {
    setSelected(f);
    setReadError(null);
    try {
      const value = await api<{ text: string; revision: string }>(
        `/servers/${s.id}/files/text?path=${encodeURIComponent(f.path)}`,
      );
      setText(value.text);
      setOriginal(value.text);
      setRevision(value.revision);
      setEditor(true);
    } catch (e) {
      setReadError(e);
    }
  }
  return (
    <>
      <UploadDialog
        server={s}
        open={upload}
        onOpenChange={setUpload}
        defaultKind="file"
        directory={directory}
      />
      <MinePanel>
        <div className="section-heading">
          <div>
            <h2>{t("files")}</h2>
            <p>{t("filesHint")}</p>
          </div>
          <div className="button-row">
            <MineButton variant="secondary" onClick={() => setUpload(true)}>
              {t("upload")}
            </MineButton>
            <MineButton
              variant="secondary"
              onClick={() => {
                const name = window.prompt(t("newFile"));
                if (!name) return;
                setSelected({
                  name,
                  path: directory ? directory + "/" + name : name,
                  directory: false,
                  bytes: 0,
                  modifiedAt: new Date().toISOString(),
                });
                setText("");
                setOriginal("");
                setRevision(
                  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                );
                setEditor(true);
              }}
            >
              {t("newFile")}
            </MineButton>
            <MineButton variant="secondary" onClick={() => setNewFolder(true)}>
              <Folder size={17} />
              {t("folder")}
            </MineButton>
          </div>
        </div>
        <div className="file-breadcrumb">
          <MineButton
            variant="ghost"
            disabled={!directory}
            onClick={() =>
              setDirectory(directory.split("/").slice(0, -1).join("/"))
            }
          >
            <ArrowUp size={17} />
          </MineButton>
          <button onClick={() => setDirectory("")}>/data</button>
          {directory
            .split("/")
            .filter(Boolean)
            .map((segment, i) => (
              <span key={i}>
                <ChevronRight size={13} />
                <button
                  onClick={() =>
                    setDirectory(
                      directory
                        .split("/")
                        .slice(0, i + 1)
                        .join("/"),
                    )
                  }
                >
                  {segment}
                </button>
              </span>
            ))}
        </div>
        <ErrorNotice error={readError ?? list.error ?? action.error} />
        {list.isPending ? (
          <MineProgress message={t("loading")} />
        ) : !list.data?.length ? (
          <MineEmpty
            icon="chest"
            title={t("fileEmpty")}
            description={t("fileEmptyBody")}
          />
        ) : (
          <div className="file-list">
            {list.data.map((f) => (
              <div className="file-row" key={f.path}>
                <button
                  className="file-name"
                  onClick={() =>
                    f.directory ? setDirectory(f.path) : void edit(f)
                  }
                >
                  {f.directory ? <Folder size={21} /> : <File size={21} />}
                  <span>{f.name}</span>
                </button>
                <small>{f.directory ? "—" : bytes(f.bytes)}</small>
                <div className="file-actions">
                  {!f.directory && (
                    <>
                      <MineButton variant="ghost" onClick={() => void edit(f)}>
                        {t("edit")}
                      </MineButton>
                      <a
                        href={`/api/v1/servers/${s.id}/files/download?path=${encodeURIComponent(f.path)}`}
                      >
                        {t("download")}
                      </a>
                    </>
                  )}
                  <MineButton
                    variant="ghost"
                    onClick={() => {
                      const name = window.prompt(t("rename"), f.name);
                      if (name && name !== f.name)
                        action.mutate({
                          path: `/servers/${s.id}/files`,
                          body: {
                            action: "rename",
                            path: f.path,
                            destination: directory
                              ? directory + "/" + name
                              : name,
                            confirm: true,
                          },
                        });
                    }}
                  >
                    {t("rename")}
                  </MineButton>
                  {f.directory && (
                    <MineButton
                      variant="ghost"
                      onClick={() => {
                        const name = window.prompt(
                          t("createArchive"),
                          f.name + ".zip",
                        );
                        if (name)
                          action.mutate({
                            path: `/servers/${s.id}/files`,
                            body: {
                              action: "archive",
                              path: f.path,
                              destination: directory
                                ? directory + "/" + name
                                : name,
                              confirm: true,
                            },
                          });
                      }}
                    >
                      {t("createArchive")}
                    </MineButton>
                  )}
                  {f.name.endsWith(".zip") && (
                    <MineButton
                      variant="ghost"
                      onClick={() => {
                        const dest = window.prompt(t("destination"));
                        if (dest)
                          action.mutate({
                            path: `/servers/${s.id}/files`,
                            body: {
                              action: "extract",
                              path: f.path,
                              destination: directory
                                ? directory + "/" + dest
                                : dest,
                              confirm: true,
                            },
                          });
                      }}
                    >
                      {t("extract")}
                    </MineButton>
                  )}
                  <MineButton
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm(t("delete") + " " + f.name + "?"))
                        action.mutate({
                          path: `/servers/${s.id}/files`,
                          body: {
                            action: "delete",
                            path: f.path,
                            confirm: true,
                          },
                        });
                    }}
                  >
                    {t("delete")}
                  </MineButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </MinePanel>
      <MineModal
        open={editor}
        onOpenChange={(value) => {
          if (!value && text !== original && !window.confirm(t("unsaved")))
            return;
          setEditor(value);
        }}
        title={t("textEditor") + " · " + (selected?.name ?? "")}
      >
        <CodeEditor value={text} onChange={setText} label={t("textEditor")} />
        {text !== original && <MineNotice>{t("unsaved")}</MineNotice>}
        <details>
          <summary>{t("diff")}</summary>
          <div className="diff-preview">
            <pre>{original}</pre>
            <pre>{text}</pre>
          </div>
        </details>
        <MineButton
          disabled={text === original || action.isPending}
          onClick={() =>
            action.mutate(
              {
                path: `/servers/${s.id}/files`,
                body: {
                  action: "write",
                  path: selected!.path,
                  text,
                  revision,
                  confirm: true,
                },
              },
              {
                onSuccess: () => {
                  setOriginal(text);
                  setEditor(false);
                },
              },
            )
          }
        >
          {t("save")}
        </MineButton>
        <ErrorNotice error={action.error} />
      </MineModal>
      <MineModal
        open={newFolder}
        onOpenChange={setNewFolder}
        title={t("folder")}
      >
        <MineInput
          label={t("filename")}
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
        />
        <MineButton
          disabled={!folder || action.isPending}
          onClick={() =>
            action.mutate(
              {
                path: `/servers/${s.id}/files`,
                body: {
                  action: "mkdir",
                  path: directory ? directory + "/" + folder : folder,
                  confirm: true,
                },
              },
              {
                onSuccess: () => {
                  setNewFolder(false);
                  setFolder("");
                },
              },
            )
          }
        >
          {t("create")}
        </MineButton>
        <ErrorNotice error={action.error} />
      </MineModal>
    </>
  );
}
