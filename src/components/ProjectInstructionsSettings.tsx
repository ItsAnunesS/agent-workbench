import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { invoke } from "../api";
import { localizeMessage, t, useLocale } from "../i18n";

interface Instructions {
  path: string | null;
  content: string | null;
}
export function ProjectInstructionsSettings({
  environmentId,
  projectId,
  projectPath,
}: {
  environmentId: string;
  projectId: string;
  projectPath: string;
}) {
  const { locale } = useLocale();
  const [data, setData] = useState<Instructions | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setData(null);
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    invoke<Instructions>("project_agents", { environmentId, projectId })
      .then((value) => {
        if (alive) setData(value);
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
  }, [environmentId, projectId, projectPath, locale, revision]);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  return (
    <section className="project-instructions-settings">
      <h4>{t("Project AGENTS.md")}</h4>
      <p className="subtle">
        {t(
          "Instructions from the project root apply to Chat and Worker in this project. Global and manual workspace settings are kept.",
        )}
      </p>
      {loading ? (
        <p role="status">{t("Checking project instructions...")}</p>
      ) : error != null ? (
        <p className="account-issue" role="alert">
          {localizeMessage(error)}
        </p>
      ) : data?.path ? (
        <>
          <p className="subtle">{t("Recognized automatically")}</p>
          <code className="settings-project-path">{data.path}</code>
          <details
            open={expanded}
            onToggle={(event) => setExpanded(event.currentTarget.open)}
          >
            <summary>{t("View project instructions")}</summary>
            <pre className="memory-preview project-instructions-preview">
              {data.content || t("The instruction file is empty.")}
            </pre>
          </details>
        </>
      ) : (
        <p className="subtle">
          {t(
            !isTauri()
              ? "Open the desktop app to detect project instructions."
              : !projectPath
                ? "Select a project folder to detect AGENTS.md."
                : "No AGENTS.md or agents.md found in the project root.",
          )}
        </p>
      )}
      <p className="subtle">
        {t(
          "The file is read again before each Chat request or Worker run. Project instructions override conflicting global or workspace preferences without changing runtime permissions.",
        )}
      </p>
      <button
        type="button"
        className="text-button"
        disabled={loading || !isTauri()}
        onClick={() => setRevision((value) => value + 1)}
      >
        {t("Refresh project instructions")}
      </button>
    </section>
  );
}
