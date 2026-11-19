import { t, dateLocale, localizeMessage } from "../i18n";
import {
  Check,
  ChevronDown,
  Cpu,
  Folder,
  LoaderCircle,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { coalesceEvents } from "../worker";
import type { WorkerController, WorkerEvent, WorkerRun } from "../worker";
import { formatDuration, useElapsed } from "./ActivityIndicator";
import { MessageContent } from "./MessageContent";

const labels: Record<string, string> = {
  running: "Running",
  awaitingApproval: "Needs approval",
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
};
export function workerStatusLabel(status: string) {
  return t(labels[status] || status);
}
function Activity({ event }: { event: WorkerEvent }) {
  const item = event.item;
  if (!item) return <p>{t(event.text)}</p>;
  if (item.type === "commandExecution")
    return (
      <div className="worker-command">
        <code>{item.command || t("Command")}</code>
        {item.cwd && (
          <small>
            {item.cwd}
            {item.exitCode != null
              ? ` · ${t("Exit code: {code}", { code: item.exitCode })}`
              : ""}
          </small>
        )}
        {item.output && (
          <details>
            <summary>{t("View output")}</summary>
            <pre>{item.output}</pre>
          </details>
        )}
      </div>
    );
  return (
    <div>
      {item.changes?.map((change, index) => (
        <details key={`${change.path}-${index}`} className="worker-diff">
          <summary>{change.path}</summary>
          <pre>{change.diff}</pre>
        </details>
      )) || <p>{t("File changes")}</p>}
    </div>
  );
}
export function RunActivity({
  run,
  active,
  worker,
}: {
  run: WorkerRun;
  active: boolean;
  worker: WorkerController;
}) {
  const events = coalesceEvents(run.events);
  const resolved = new Set(
    events
      .filter((event) => event.kind === "decision")
      .map((event) => event.approvalId),
  );
  const pending = events.filter(
    (event) =>
      active &&
      event.kind === "approval" &&
      event.approvalId &&
      !resolved.has(event.approvalId),
  );
  const elapsed = useElapsed(run.createdAt * 1000, active, run.durationMs);
  const agentMessages = events.filter(
    (event) => event.item?.type === "agentMessage",
  );
  const latestMessage = agentMessages.at(-1)?.item;
  const liveOutput = latestMessage
    ? latestMessage.phase === "commentary"
      ? ""
      : latestMessage.text || ""
    : run.output;
  return (
    <div
      className={`worker-run inline-run ${active ? "active" : ""}`}
      data-testid="worker-run"
    >
      <details className="run-timeline" open={active}>
        <summary className={`worker-run-header ${run.status}`}>
          {active && <LoaderCircle size={14} className="activity-spinner" />}
          <strong>
            {elapsed == null
              ? t(labels[run.status] || run.status)
              : t(active ? "Working for {duration}" : "Worked for {duration}", {
                  duration: formatDuration(elapsed),
                })}
          </strong>
          <span className="run-status">
            {t(labels[run.status] || run.status)}
          </span>
          <ChevronDown size={14} />
        </summary>
        <div
          className="worker-events"
          role="log"
          aria-label={t("Worker activity")}
        >
          {events
            .filter(
              (event) =>
                !["finished", "approval", "approvalSent"].includes(event.kind),
            )
            .map((event, index) => {
              const item = event.item;
              if (item?.type === "agentMessage") {
                if (
                  item.phase === "final_answer" ||
                  (item === latestMessage && item.phase !== "commentary")
                )
                  return null;
                return (
                  <div className="timeline-commentary" key={item.id || index}>
                    <MessageContent content={item.text || ""} />
                  </div>
                );
              }
              if (item?.type === "reasoning" || item?.type === "plan")
                return item.summary || item.text ? (
                  <p className="reasoning-summary" key={item.id || index}>
                    {item.summary || item.text}
                  </p>
                ) : null;
              return (
                <div key={index} className={`worker-event ${event.kind}`}>
                  <Activity event={event} />
                </div>
              );
            })}
        </div>
      </details>
      {pending.map((event) => (
        <section
          className="inline-approval"
          key={event.approvalId}
          aria-label={t("Needs approval")}
        >
          <strong>{t("Approval required")}</strong>
          <p>{t(event.text)}</p>
          <Activity event={event} />
          <div className="worker-approval-actions">
            <button onClick={() => worker.approve(event.approvalId!, false)}>
              <X size={14} />
              {t("Decline")}
            </button>
            <button
              className="approve"
              onClick={() => worker.approve(event.approvalId!, true)}
            >
              <Check size={14} />
              {t("Allow once")}
            </button>
          </div>
        </section>
      ))}
      {active && liveOutput && (
        <div className="worker-response" aria-live="polite">
          <MessageContent content={liveOutput} />
        </div>
      )}
      {run.error && (
        <p className="account-issue" role="alert">
          {localizeMessage(run.error)}
        </p>
      )}
      {active && (
        <button className="text-button" onClick={worker.cancel}>
          <Square size={13} />
          {t("Stop task")}
        </button>
      )}
    </div>
  );
}

export function WorkerSetup({ worker }: { worker: WorkerController }) {
  return (
    <div className="worker-setup">
      <Cpu size={18} />
      <div>
        <strong>{t("Codex runtime")}</strong>
        <p>
          {worker.runtime?.message
            ? localizeMessage(worker.runtime.message)
            : t("Checking Docker...")}
        </p>
        <div className="worker-setup-actions">
          <button
            type="button"
            className="text-button"
            disabled={worker.preparing || worker.checking}
            onClick={worker.refresh}
          >
            {worker.checking ? t("Checking...") : t("Check Docker")}
          </button>
          {!worker.runtime?.ready && (
            <button
              type="button"
              className="primary-button"
              disabled={!worker.runtime?.available || worker.preparing}
              onClick={worker.prepare}
            >
              {worker.preparing ? t("Preparing Codex...") : t("Prepare Worker")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
export function WorkerPanel({
  worker,
  conversationId,
  projectPath,
  onEditPath,
  inlineOnly = false,
}: {
  worker: WorkerController;
  conversationId: string | null;
  projectPath?: string;
  onEditPath?: () => void;
  inlineOnly?: boolean;
}) {
  const active =
    worker.active?.conversationId === conversationId ? worker.active : null;
  return (
    <section className="worker-panel" aria-label={t("Codex execution")}>
      <div className="worker-boundary">
        <ShieldCheck size={17} />
        <span>
          {t("Isolated by project")}
          <span className="worker-boundary-detail">
            {t("Commands without network · One-time approvals")}
          </span>
        </span>
      </div>
      <div className="worker-project">
        <Folder size={14} />
        <code>{projectPath || t("Select a project with a local folder")}</code>
        {onEditPath && (
          <button
            type="button"
            className="text-button"
            disabled={!!worker.active}
            onClick={onEditPath}
          >
            {t("Set folder")}
          </button>
        )}
      </div>
      {!worker.runtime?.ready && <WorkerSetup worker={worker} />}
      {worker.issue && (
        <p className="account-issue" role="alert">
          {localizeMessage(worker.issue)}
        </p>
      )}
      {!inlineOnly && active && (
        <RunActivity run={active} active worker={worker} />
      )}
      {!inlineOnly &&
        worker.history
          .filter((run) => run.id !== active?.id)
          .map((run) => (
            <details
              className="worker-history"
              key={run.id}
              open={worker.history[0]?.id === run.id && !active}
            >
              <summary>
                {t(labels[run.status] || run.status)} ·{" "}
                {new Date(run.createdAt * 1000).toLocaleString(dateLocale())}
              </summary>
              <RunActivity run={run} active={false} worker={worker} />
            </details>
          ))}
    </section>
  );
}
