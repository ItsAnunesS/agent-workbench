import { useEffect, useState } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { t } from "../i18n";

export function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return seconds < 60
    ? t("{seconds}s", { seconds })
    : t("{minutes}m {seconds}s", {
        minutes: Math.floor(seconds / 60),
        seconds: seconds % 60,
      });
}

export function useElapsed(
  startedAt: number,
  active: boolean,
  durationMs?: number,
) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);
  return active ? Math.max(0, now - startedAt) : durationMs;
}

export function ActivityIndicator({
  startedAt,
  active,
  durationMs,
  summary,
}: {
  startedAt: number;
  active: boolean;
  durationMs?: number;
  summary?: string;
}) {
  const elapsed = useElapsed(startedAt, active, durationMs);
  const label =
    elapsed == null
      ? t("Activity")
      : t(active ? "Working for {duration}" : "Worked for {duration}", {
          duration: formatDuration(elapsed),
        });
  return summary ? (
    <details className="response-activity">
      <summary>
        {active && <LoaderCircle className="activity-spinner" size={14} />}
        {label}
        <ChevronDown size={13} />
      </summary>
      <p className="reasoning-summary">{summary}</p>
    </details>
  ) : (
    <div className="response-activity" role={active ? "status" : undefined}>
      {active && <LoaderCircle className="activity-spinner" size={14} />}
      {label}
    </div>
  );
}
