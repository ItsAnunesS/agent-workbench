import { useEffect, useState, type FormEvent } from "react";
import {
  loadAppSettings,
  saveAppSettings,
  type AppSettings,
} from "../global-settings";
import { localizeMessage, t } from "../i18n";

export function GlobalInstructionsSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loadAppSettings()
      .then((value) => {
        if (alive) {
          setSettings(value);
          setDirty(false);
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
  }, [revision]);
  function update(key: keyof AppSettings, value: string) {
    setSettings((previous) =>
      previous ? { ...previous, [key]: value } : previous,
    );
    setDirty(true);
    setSaved(false);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveAppSettings(settings);
      setDirty(false);
      setSaved(true);
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="global-instructions-settings">
      <details>
        <summary>{t("Global AGENTS.md and Git conventions")}</summary>
        <p className="subtle">
          {t(
            "These instructions apply to Chat and Worker in every workspace. Conventions guide generated work and do not execute Git actions automatically.",
          )}
        </p>
        <form onSubmit={save}>
          <fieldset disabled={loading || saving || !settings}>
            <label className="field">
              {t("Global AGENTS.md")}
              <textarea
                aria-label={t("Global AGENTS.md")}
                aria-describedby="global-agents-description"
                rows={6}
                maxLength={100_000}
                value={settings?.agentsMarkdown || ""}
                onChange={(event) =>
                  update("agentsMarkdown", event.target.value)
                }
                placeholder={t("Instructions shared by all workspaces...")}
              />
              <small id="global-agents-description">
                {t(
                  "Stored as app instructions. Existing AGENTS.md files on your computer and in projects are not changed.",
                )}
              </small>
            </label>
            {(
              [
                ["commitConvention", "Commit convention"],
                ["pullRequestConvention", "Pull request convention"],
                ["branchConvention", "Branch naming convention"],
              ] as const
            ).map(([key, label]) => (
              <label className="field" key={key}>
                {t(label)}
                <textarea
                  rows={3}
                  maxLength={4_000}
                  value={settings?.[key] || ""}
                  onChange={(event) => update(key, event.target.value)}
                />
              </label>
            ))}
            <button
              className="primary-button"
              type="submit"
              disabled={!dirty || saving}
            >
              {t(saving ? "Saving..." : "Save global instructions")}
            </button>
          </fieldset>
        </form>
      </details>
      {loading && (
        <p className="subtle" role="status">
          {t("Loading global instructions...")}
        </p>
      )}
      {saved && (
        <p className="subtle" role="status">
          {t("Global instructions saved.")}
        </p>
      )}
      {error != null && (
        <div>
          <p className="account-issue" role="alert">
            {localizeMessage(error)}
          </p>
          {!settings && (
            <button
              type="button"
              className="text-button"
              onClick={() => setRevision((value) => value + 1)}
            >
              {t("Try again")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
