import { BarChart3, ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { invoke } from "../api";
import { dateLocale, localizeMessage, t } from "../i18n";
import type { UsageController } from "../usage";

function tokens(value: number | null | undefined) {
  return value == null
    ? t("Not reported")
    : new Intl.NumberFormat(dateLocale()).format(value);
}
export function UsageButton({
  usage,
  onOpen,
  connected,
}: {
  usage: UsageController;
  onOpen: () => void;
  connected: boolean;
}) {
  return (
    <button
      className="usage-button"
      aria-label={t("Usage")}
      title={t("Usage in this environment")}
      onClick={onOpen}
    >
      <BarChart3 size={16} />
      <span>
        <strong>{t("Usage")}</strong>
        <small>
          {!connected
            ? t("Connect OpenAI to view usage")
            : usage.data?.lastSevenDays.responses
              ? t("{tokens} tokens recorded in 7 days", {
                  tokens: tokens(usage.data.lastSevenDays.tokens.total),
                })
              : t("View recorded tokens")}
        </small>
      </span>
      <ExternalLink size={13} />
    </button>
  );
}
export function UsagePanel({
  usage,
  environmentName,
  connected,
}: {
  usage: UsageController;
  environmentName: string;
  connected: boolean;
}) {
  const [manageError, setManageError] = useState<unknown>(null);
  const data = usage.data;
  async function manage() {
    setManageError(null);
    try {
      if (isTauri()) await invoke("openai_manage_usage");
      else
        window.open(
          "https://chatgpt.com/settings/usage",
          "_blank",
          "noopener,noreferrer",
        );
    } catch (error) {
      setManageError(error);
    }
  }
  const max = Math.max(
    1,
    ...(data?.daily.map((day) => day.totalTokens || 0) || []),
  );
  return (
    <div className="usage-panel">
      <div className="usage-summary-header">
        <p>{t("Usage in {name}", { name: environmentName })}</p>
        <button
          className="text-button"
          disabled={usage.loading || !connected}
          onClick={usage.refresh}
        >
          <RefreshCw size={14} />
          {t("Refresh usage")}
        </button>
      </div>
      <section className="usage-plan-card">
        <div>
          <span className="eyebrow">{t("ChatGPT plan")}</span>
          <h3>{t("Plan limits and credits")}</h3>
        </div>
        <button className="secondary-button" onClick={() => void manage()}>
          {t("Manage usage")}
          <ExternalLink size={13} />
        </button>
        <dl>
          <div>
            <dt>{t("Weekly limit")}</dt>
            <dd>{t("Not provided by this connection")}</dd>
          </div>
          <div>
            <dt>{t("Credits")}</dt>
            <dd>{t("Not provided by this connection")}</dd>
          </div>
        </dl>
        <p className="subtle">
          {t(
            "Check remaining allowance, reset times and credits in the official ChatGPT usage page.",
          )}
        </p>
      </section>
      {manageError != null && (
        <p role="alert" className="account-issue">
          {localizeMessage(manageError)}
        </p>
      )}
      <h3 className="usage-section-title">
        {t("Tokens recorded by this app")}
      </h3>
      <p className="subtle">
        {t(
          "Local history for the selected account and environment. It does not represent your remaining plan allowance or usage in other apps.",
        )}
      </p>
      {!connected ? (
        <p className="usage-empty">{t("Connect OpenAI to view usage")}</p>
      ) : usage.error != null ? (
        <p role="alert" className="account-issue">
          {localizeMessage(usage.error)}
        </p>
      ) : !data ? (
        <p role="status" className="usage-empty">
          {t(
            usage.loading
              ? "Loading usage..."
              : "Open the desktop app to view recorded usage.",
          )}
        </p>
      ) : (
        <>
          {data.recordingIssue && (
            <p role="alert" className="account-issue">
              {t(
                "Some token usage could not be saved. Recorded totals may be incomplete.",
              )}
            </p>
          )}
          <div className="usage-metrics">
            {(
              [
                ["Today (UTC)", data.today],
                ["Last 7 days (UTC)", data.lastSevenDays],
                ["All recorded usage", data.allTime],
              ] as const
            ).map(([label, total]) => {
              return (
                <div className="usage-metric" key={label}>
                  <span>{t(label)}</span>
                  <strong>{tokens(total.tokens.total)}</strong>
                  <small>
                    {t("{count} reported responses", {
                      count: total.responses,
                    })}
                  </small>
                </div>
              );
            })}
          </div>
          <dl className="usage-token-breakdown">
            {(
              [
                ["Input tokens", data.allTime.tokens.input],
                ["Output tokens", data.allTime.tokens.output],
                ["Cached input tokens", data.allTime.tokens.cached],
                ["Reasoning tokens", data.allTime.tokens.reasoning],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{t(label)}</dt>
                <dd>{tokens(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="usage-caption">
            {t(
              "Cached input and reasoning tokens are already included in input and output totals.",
            )}
          </p>
          <section className="usage-chart-card">
            <h3>{t("Reported tokens by day (UTC)")}</h3>
            {!data.daily.length ? (
              <p className="usage-empty">
                {t("Usage appears after a response reports its token counts.")}
              </p>
            ) : (
              <div
                className="usage-chart"
                role="img"
                aria-label={t("Reported tokens by day (UTC)")}
              >
                {Array.from({ length: 7 }, (_, index) => {
                  const date = new Date();
                  date.setUTCHours(0, 0, 0, 0);
                  date.setUTCDate(date.getUTCDate() - 6 + index);
                  const key = date.toISOString().slice(0, 10);
                  const day = data.daily.find((day) => day.date === key);
                  const value = day ? day.totalTokens : 0;
                  const label = date.toLocaleDateString(dateLocale(), {
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  });
                  return (
                    <div
                      className="usage-chart-column"
                      key={key}
                      title={`${label}: ${tokens(value)}`}
                    >
                      <span>{tokens(value)}</span>
                      <div className="usage-bar-track">
                        <div
                          className="usage-bar"
                          style={{
                            height: `${value == null ? 0 : Math.max(value ? 3 : 0, (value / max) * 100)}%`,
                          }}
                        />
                      </div>
                      <small>{label}</small>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          {!!data.recent.length && (
            <section className="usage-recent">
              <h3>{t("Recent reported responses")}</h3>
              {data.recent.map((response, index) => (
                <div key={index}>
                  <span>
                    <strong>{response.model}</strong>
                    <small>
                      {t(
                        response.source === "chat"
                          ? "Chat"
                          : response.source === "worker"
                            ? "Worker"
                            : "Approval review",
                      )}{" "}
                      ·{" "}
                      {new Date(response.createdAt * 1000).toLocaleString(
                        dateLocale(),
                      )}
                    </small>
                  </span>
                  <strong>{tokens(response.tokens.total)}</strong>
                </div>
              ))}
            </section>
          )}
          {!!data.allTime.incompleteResponses && (
            <p className="usage-caption">
              {t(
                "Some responses did not include a total token count. Totals include only the counts OpenAI reported.",
              )}
            </p>
          )}
          {data.allTime.firstRecordedAt != null && (
            <p className="usage-caption">
              {t("Recorded since {date}", {
                date: new Date(
                  data.allTime.firstRecordedAt * 1000,
                ).toLocaleDateString(dateLocale()),
              })}
            </p>
          )}
        </>
      )}
      <p className="usage-caption">
        {t(
          "Older, interrupted or unreported requests may be missing. Token counts are not a bill or a quota estimate.",
        )}
      </p>
    </div>
  );
}
