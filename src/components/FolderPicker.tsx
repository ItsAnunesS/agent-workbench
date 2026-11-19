import { useEffect, useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { invoke } from "../api";
import { localizeMessage, t } from "../i18n";

export function FolderPicker({
  value,
  onChange,
  onPendingChange,
}: {
  value: string;
  onChange: (value: string) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onPendingChange(false);
    };
  }, [onPendingChange]);
  async function choose() {
    if (pending || !isTauri()) return;
    setPending(true);
    setError(null);
    onPendingChange(true);
    try {
      const path = await invoke<string | null>("select_project_folder", {
        initialPath: value || null,
      });
      if (mounted.current && path != null) onChange(path);
    } catch (failure) {
      if (mounted.current) setError(failure);
    } finally {
      if (mounted.current) {
        setPending(false);
        onPendingChange(false);
      }
    }
  }
  return (
    <div className="folder-picker">
      <output className="selected-folder" aria-label={t("Selected folder")}>
        {value || t("No folder selected")}
      </output>
      <div className="folder-picker-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={pending || !isTauri()}
          aria-busy={pending}
          onClick={() => void choose()}
        >
          <FolderOpen size={16} />
          {t(
            pending
              ? "Choosing folder..."
              : value
                ? "Change folder"
                : "Choose folder",
          )}
        </button>
        {!!value && (
          <button
            type="button"
            className="text-button"
            disabled={pending}
            onClick={() => {
              onChange("");
              setError(null);
            }}
          >
            {t("Remove folder")}
          </button>
        )}
      </div>
      {!isTauri() && (
        <small>{t("Open the desktop app to choose a project folder.")}</small>
      )}
      {error != null && (
        <p className="account-issue" role="alert">
          {localizeMessage(error)}
        </p>
      )}
    </div>
  );
}
