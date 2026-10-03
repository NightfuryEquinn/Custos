import { Icon } from "@/frontend/components/ui";
import type { ImportRowError, ImportRowNotice } from "@/frontend/auth/lib/csv";
import { useEffect, useRef, useState } from "react";

export type CsvImportPreview = {
  countLabel: string;
  extraStats?: string;
  errors: ImportRowError[];
  notices: ImportRowNotice[];
  canImport: boolean;
  importButtonLabel: string;
};

type CsvImportPanelProps = {
  importLead: string;
  exported: boolean;
  exportLabel: string;
  onExport: () => void;
  countNote: string;
  onReadFile: (file: File) => void | Promise<void>;
  preview: CsvImportPreview | null;
  importBusy: boolean;
  onImport: () => void;
  onClear: () => void;
  resultSummary?: string | null;
  resultPartial?: boolean;
  /** Read/import failure, shown inline under the panel. */
  error?: string;
  footnote?: string;
};

export function CsvImportPanel({
  importLead,
  exported,
  exportLabel,
  onExport,
  countNote,
  onReadFile,
  preview,
  importBusy,
  onImport,
  onClear,
  resultSummary,
  resultPartial,
  error,
  footnote,
}: CsvImportPanelProps) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!preview) {
      setFileName(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, [preview]);

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    if (!file) return;
    setFileName(file.name);
    void onReadFile(file);
  };

  const clear = () => {
    setFileName(null);
    if (fileRef.current) fileRef.current.value = "";
    onClear();
  };

  return (
    <div className="csv-data-panel">
      <button className="primary-btn full" type="button" onClick={onExport}>
        <Icon name={exported ? "check" : "download"} size={17} />
        {exported ? "Downloaded" : exportLabel}
      </button>
      <p className="dm-note">{countNote}</p>

      <p className="dm-lead dm-lead--gap">{importLead}</p>
      <div
        className={`csv-dropzone${dragging ? " csv-dropzone--drag" : ""}`}
        role="button"
        tabIndex={0}
        aria-label="Import CSV File"
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <Icon name="file" size={22} />
        <p className="csv-dropzone-text">
          {fileName ? (
            <>
              Selected: <strong>{fileName}</strong>
            </>
          ) : (
            <>
              Drop your CSV here or <span className="csv-dropzone-link">Choose a File</span>
            </>
          )}
        </p>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />

      {preview ? (
        <div className="csv-import-preview">
          <p className="csv-import-count">
            {preview.countLabel}
            {preview.extraStats ? ` · ${preview.extraStats}` : ""}
            {preview.errors.length
              ? ` · ${preview.errors.length} row${preview.errors.length === 1 ? "" : "s"} skipped`
              : ""}
          </p>
          {preview.notices.length ? (
            <ul className="csv-import-notices">
              {preview.notices.slice(0, 5).map((notice) => (
                <li key={`${notice.row}-${notice.message}`}>
                  {notice.row > 0 ? `Row ${notice.row}: ` : ""}
                  {notice.message}
                </li>
              ))}
              {preview.notices.length > 5 ? <li>…and {preview.notices.length - 5} more</li> : null}
            </ul>
          ) : null}
          {preview.errors.length ? (
            <ul className="csv-import-errors">
              {preview.errors.slice(0, 5).map((err) => (
                <li key={`${err.row}-${err.message}`}>
                  {err.row > 0 ? `Row ${err.row}: ` : ""}
                  {err.message}
                </li>
              ))}
              {preview.errors.length > 5 ? <li>…and {preview.errors.length - 5} more</li> : null}
            </ul>
          ) : null}
          <div className="csv-import-actions">
            <button
              className="primary-btn"
              type="button"
              disabled={!preview.canImport || importBusy}
              onClick={onImport}
            >
              {importBusy ? "Importing…" : preview.importButtonLabel}
            </button>
            <button className="ghost-btn" type="button" disabled={importBusy} onClick={clear}>
              Clear
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="auth-error auth-error--gap" role="alert">
          {error}
        </p>
      ) : null}

      {resultSummary ? (
        <p className={`csv-import-summary${resultPartial ? " csv-import-summary--partial" : ""}`}>
          {resultSummary}
        </p>
      ) : null}

      {footnote ? <p className="dm-note">{footnote}</p> : null}
    </div>
  );
}
