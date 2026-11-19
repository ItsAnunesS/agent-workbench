import { useEffect, useState } from "react";
import { ChevronRight, FileText, Folder, RefreshCw, X } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { invoke } from "../api";
import { localizeMessage, t } from "../i18n";
import type { ToolScope } from "../tool-types";
interface Entry {
  name: string;
  path: string;
  directory: boolean;
  symlink: boolean;
}
interface Listing {
  entries: Entry[];
  truncated: boolean;
}
function FolderTree({
  scope,
  path,
  depth,
  onFile,
}: {
  scope: ToolScope;
  path: string;
  depth: number;
  onFile: (path: string) => void;
}) {
  const [listing, setListing] = useState<Listing>();
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    setError(null);
    invoke<Listing>("tool_files", { scope, path })
      .then((value) => {
        if (alive) setListing(value);
      })
      .catch((failure) => {
        if (alive) setError(failure);
      });
    return () => {
      alive = false;
    };
  }, [scope, path, revision]);
  if (error != null)
    return (
      <p role="alert" className="tool-error">
        {localizeMessage(error)}{" "}
        <button onClick={() => setRevision((value) => value + 1)}>
          {t("Try again")}
        </button>
      </p>
    );
  if (!listing) return <p className="tool-hint">{t("Loading...")}</p>;
  return (
    <div role="group">
      {listing.entries.map((entry) => (
        <div key={entry.path}>
          <button
            className="file-tree-entry"
            style={{ paddingLeft: 8 + depth * 14 }}
            aria-expanded={
              entry.directory ? open.includes(entry.path) : undefined
            }
            disabled={entry.symlink}
            title={
              entry.symlink ? t("Symbolic links are not followed.") : entry.path
            }
            onClick={() =>
              entry.directory
                ? setOpen((previous) =>
                    previous.includes(entry.path)
                      ? previous.filter((value) => value !== entry.path)
                      : [...previous, entry.path],
                  )
                : onFile(entry.path)
            }
          >
            {entry.directory ? (
              <ChevronRight
                size={12}
                className={open.includes(entry.path) ? "rotated" : ""}
              />
            ) : (
              <span className="tree-indent" />
            )}
            {entry.directory ? <Folder size={14} /> : <FileText size={14} />}
            <span>{entry.name}</span>
          </button>
          {entry.directory && open.includes(entry.path) && (
            <FolderTree
              scope={scope}
              path={entry.path}
              depth={depth + 1}
              onFile={onFile}
            />
          )}
        </div>
      ))}
      {listing.truncated && (
        <p className="tool-hint">
          {t("Only the first 2,000 entries are shown.")}
        </p>
      )}
      {!listing.entries.length && (
        <p className="tool-hint">{t("This folder is empty.")}</p>
      )}
    </div>
  );
}
export function ProjectFiles({
  scope,
  projectName,
}: {
  scope: ToolScope;
  projectName?: string;
}) {
  const [path, setPath] = useState("");
  const [content, setContent] = useState<string>();
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setContent(undefined);
    setError(null);
    invoke<string>("tool_read_file", { scope, path })
      .then((value) => {
        if (alive) setContent(value);
      })
      .catch((failure) => {
        if (alive) setError(failure);
      });
    return () => {
      alive = false;
    };
  }, [scope, path, revision]);
  if (!scope.projectId)
    return (
      <p className="tool-empty">
        {t("Select a project folder to use this tool.")}
      </p>
    );
  if (!isTauri())
    return (
      <p className="tool-empty">
        {t("Open the desktop app to browse project files.")}
      </p>
    );
  return (
    <section className={`project-files ${path ? "has-preview" : ""}`}>
      <div className="file-tree">
        <div className="tool-toolbar">
          <strong>{projectName}</strong>
          <button
            aria-label={t("Refresh files")}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <FolderTree
          key={revision}
          scope={scope}
          path=""
          depth={0}
          onFile={setPath}
        />
      </div>
      {path && (
        <div className="file-preview">
          <div className="tool-toolbar">
            <span title={path}>{path}</span>
            <button aria-label={t("Close file")} onClick={() => setPath("")}>
              <X size={14} />
            </button>
          </div>
          <p className="tool-hint">{t("Read-only preview")}</p>
          {error != null ? (
            <p role="alert" className="tool-error">
              {localizeMessage(error)}
            </p>
          ) : content == null ? (
            <p>{t("Loading...")}</p>
          ) : (
            <pre className="source-preview">
              {content.split("\n").map((line, index) => (
                <div key={index}>
                  <span className="line-number">{index + 1}</span>
                  <code>{line || " "}</code>
                </div>
              ))}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
