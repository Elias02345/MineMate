import { useState } from "react";
import { Asset, MineButton } from "../../../packages/ui/src/index.tsx";
import { useI18n } from "./i18n.tsx";
import { bytes } from "./Dashboard.tsx";

export function UploadPicker({
  files,
  onChange,
  accept,
  multiple = false,
  folder = false,
  label,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  folder?: boolean;
  label: string;
}) {
  const { t } = useI18n(),
    [dragging, setDragging] = useState(false);
  const select = (selected: File[]) =>
    onChange(multiple && !folder ? [...files, ...selected] : selected);
  return (
    <>
      <label
        className={"drop-zone " + (dragging ? "dragging" : "")}
        onDragOver={(event) => {
          if (!folder) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (!folder) {
            event.preventDefault();
            setDragging(false);
            select(
              Array.from(event.dataTransfer.files).slice(
                0,
                multiple ? undefined : 1,
              ),
            );
          }
        }}
      >
        <Asset name="chest" size={40} />
        <b>{label}</b>
        <small>
          {t(
            folder
              ? "folderUploadHint"
              : multiple
                ? "bulkJarHint"
                : "fileUploadHint",
          )}
        </small>
        <input
          key={folder ? "folder" : "file"}
          type="file"
          accept={accept}
          multiple={multiple || folder}
          ref={(node) => {
            if (folder) node?.setAttribute("webkitdirectory", "");
          }}
          onChange={(event) => {
            select(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </label>
      {!!files.length && (
        <>
          <p className="upload-summary">
            {files.length} {t("selectedFiles")} ·{" "}
            {bytes(files.reduce((n, f) => n + f.size, 0))}
          </p>
          <ul className="upload-files">
            {files.map((file, index) => (
              <li key={index}>
                <span>
                  {folder ? file.webkitRelativePath || file.name : file.name}
                </span>
                {!folder && (
                  <MineButton
                    variant="ghost"
                    aria-label={t("removeSelectedFile") + " " + file.name}
                    onClick={() =>
                      onChange(files.filter((_, i) => i !== index))
                    }
                  >
                    ×
                  </MineButton>
                )}
              </li>
            ))}
          </ul>
          <MineButton variant="ghost" onClick={() => onChange([])}>
            {t("clearSelection")}
          </MineButton>
        </>
      )}
    </>
  );
}
