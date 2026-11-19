import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { invoke } from "../api";
import { localizeMessage, t } from "../i18n";
import type { TerminalConfig, TerminalPreferences } from "../tool-types";

export function TerminalSettings({
  environmentId,
}: {
  environmentId?: string;
}) {
  const [config, setConfig] = useState<TerminalConfig>({
    executable: "/bin/bash",
    args: [],
  });
  const [inherit, setInherit] = useState(!!environmentId);
  const [globalConfig, setGlobalConfig] = useState<TerminalConfig>(config);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoaded(false);
    setError(null);
    (isTauri()
      ? invoke<TerminalPreferences>("terminal_preferences", {
          environmentId: environmentId || null,
        })
      : Promise.resolve({
          global: { executable: "/bin/bash", args: [] },
          environmentOverride: null,
          effective: { executable: "/bin/bash", args: [] },
        })
    )
      .then((value) => {
        if (alive) {
          setLoaded(true);
          setConfig(value.effective);
          setGlobalConfig(value.global);
          setInherit(!!environmentId && !value.environmentOverride);
        }
      })
      .catch((failure) => {
        if (alive) setError(failure);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [environmentId, revision]);
  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      if (!isTauri())
        throw new Error(
          "Open the desktop app to configure the local terminal.",
        );
      await invoke("save_terminal_preferences", {
        environmentId: environmentId || null,
        config: environmentId && inherit ? null : config,
      });
      setSaved(true);
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="terminal-settings">
      <details>
        <summary>{t("Terminal settings")}</summary>
        <p className="subtle">
          {t(
            environmentId
              ? "This environment can override the global shell. Changes apply to newly opened terminals."
              : "Default shell for all environments. Changes apply to newly opened terminals.",
          )}
        </p>
        {environmentId && (
          <label className="terminal-inherit">
            <input
              type="checkbox"
              checked={inherit}
              disabled={!loaded || loading || saving}
              onChange={(event) => {
                setInherit(event.target.checked);
                if (event.target.checked) setConfig(globalConfig);
                setSaved(false);
              }}
            />
            {t("Use global terminal settings")}
          </label>
        )}
        <fieldset
          disabled={
            !loaded || loading || saving || (!!environmentId && inherit)
          }
        >
          <label className="field">
            {t("Shell executable")}
            <input
              value={config.executable}
              maxLength={4096}
              placeholder="/bin/bash"
              onChange={(event) => {
                setConfig({ ...config, executable: event.target.value });
                setSaved(false);
              }}
            />
          </label>
          <label className="field">
            {t("Shell arguments (one per line)")}
            <textarea
              rows={3}
              value={config.args.join("\n")}
              onChange={(event) => {
                setConfig({
                  ...config,
                  args: event.target.value
                    ? event.target.value.split("\n")
                    : [],
                });
                setSaved(false);
              }}
            />
          </label>
        </fieldset>
        <button
          className="primary-button"
          disabled={!loaded || loading || saving}
          onClick={() => void save()}
        >
          {t(saving ? "Saving..." : "Save terminal settings")}
        </button>
        {saved && <p role="status">{t("Terminal settings saved.")}</p>}
        {error != null && (
          <p role="alert">
            {localizeMessage(error)}{" "}
            <button
              className="text-button"
              onClick={() => setRevision((value) => value + 1)}
            >
              {t("Try again")}
            </button>
          </p>
        )}
      </details>
    </section>
  );
}
