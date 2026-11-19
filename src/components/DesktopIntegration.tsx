import { invoke } from "../api";
import { t, localizeMessage } from "../i18n";
import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Monitor } from "lucide-react";

type Status = { supported: boolean; installed: boolean; issue: string | null };
export function DesktopIntegration() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState("");
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    invoke<Status>("desktop_integration_status")
      .then((value) => {
        if (alive) setStatus(value);
      })
      .catch((error) => {
        if (alive) setIssue(String(error));
      });
    return () => {
      alive = false;
    };
  }, []);
  async function repair() {
    setBusy(true);
    setIssue("");
    try {
      setStatus(await invoke<Status>("desktop_integration_repair"));
    } catch (error) {
      setIssue(String(error));
    } finally {
      setBusy(false);
    }
  }
  if (!status?.supported && !issue) return null;
  return (
    <div className="desktop-integration">
      <Monitor size={17} />
      <div>
        <strong>{t("System integration")}</strong>
        <p>
          {status?.installed
            ? t(
                "The logo and launcher are registered in this user's application menu.",
              )
            : t("Application menu integration needs attention.")}
        </p>
        {(issue || status?.issue) && (
          <p className="account-issue" role="alert">
            {localizeMessage(issue || status?.issue)}
          </p>
        )}
        {status?.supported && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={repair}
          >
            {busy ? t("Updating...") : t("Repair integration")}
          </button>
        )}
      </div>
    </div>
  );
}
