import { Download } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { t, localizeMessage } from "../i18n";
import { version } from "../../package.json";
import type { AppUpdates } from "../updates";

export function UpdateSettings({ updates }: { updates: AppUpdates }) {
  if (!isTauri()) return null;
  const busy = updates.phase === "checking" || updates.phase === "downloading";
  return (
    <div className="desktop-integration app-updates">
      <Download size={17} />
      <div>
        <strong>{t("App updates")}</strong>
        <p>{t("Installed version: {version}", { version })}</p>
        <label className="update-preference">
          <input type="checkbox" checked={updates.automatic}
            onChange={(event) => updates.selectAutomatic(event.target.checked)} />
          {t("Check GitHub releases automatically")}
        </label>
        <p className="subtle">{t("Checks on startup and every six hours. Downloads only when you choose to install.")}</p>
        <p role="status" aria-live="polite">
          {updates.phase === "installed"
            ? t("Update installed. Close and reopen the app when your work is finished.")
            : updates.phase === "downloading"
              ? t("Downloading update: {percent}%", { percent: updates.progress ? Math.floor(updates.progress.downloaded * 100 / updates.progress.total) : 0 })
              : updates.phase === "checking"
                ? t("Checking for updates...")
                : updates.status?.supported === false
                  ? t("In-app updates require the Linux x86_64 AppImage.")
                  : updates.status?.version
                    ? t("Version {version} is available.", { version: updates.status.version })
                    : updates.checked ? t("You are using the latest version.") : t("Check for a newer stable release on GitHub.")}
        </p>
        {updates.phase === "downloading" && (
          <progress max={updates.progress?.total || 1} value={updates.progress?.downloaded || 0}
            aria-label={t("Update download progress")} />
        )}
        {updates.issue && <p className="account-issue" role="alert">{localizeMessage(updates.issue)}</p>}
        {updates.phase !== "installed" && (
          <div className="update-actions">
            <button type="button" className="text-button" disabled={busy} onClick={() => void updates.check()}>
              {t("Check for updates")}
            </button>
            {updates.status?.version && updates.status.supported && (
              <button type="button" className="primary-button" disabled={busy} onClick={() => void updates.install()}>
                <Download size={15} />{t("Download and install")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
