import { Check, Cpu, Folder, ShieldCheck, Square, X } from "lucide-react";
import type { WorkerController, WorkerEvent, WorkerRun } from "../worker";
import { MessageContent } from "./MessageContent";

const labels: Record<string, string> = {
  running: "A executar",
  awaitingApproval: "Precisa de aprovação",
  completed: "Concluída",
  failed: "Falhou",
  interrupted: "Interrompida",
};
function Activity({ event }: { event: WorkerEvent }) {
  const item = event.item;
  if (!item) return <p>{event.text}</p>;
  if (item.type === "commandExecution")
    return (
      <div className="worker-command">
        <code>{item.command || "Comando"}</code>
        {item.cwd && (
          <small>
            {item.cwd}
            {item.exitCode != null ? ` · Saída ${item.exitCode}` : ""}
          </small>
        )}
        {item.output && (
          <details>
            <summary>Ver saída</summary>
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
      )) || <p>Alteração de ficheiros</p>}
    </div>
  );
}
function RunActivity({
  run,
  active,
  worker,
}: {
  run: WorkerRun;
  active: boolean;
  worker: WorkerController;
}) {
  const resolved = new Set(
    run.events
      .filter((event) => event.kind === "decision")
      .map((event) => event.approvalId),
  );
  return (
    <div className="worker-run" data-testid="worker-run">
      <div className={`worker-run-header ${run.status}`}>
        <strong>{labels[run.status] || run.status}</strong>
        <span>{run.model}</span>
        <time>
          {new Date(run.createdAt * 1000).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </div>
      <div
        className="worker-events"
        role="log"
        aria-label="Atividade do Worker"
      >
        {run.events
          .filter((event) => event.kind !== "finished")
          .map((event, index) => (
            <div key={index} className={`worker-event ${event.kind}`}>
              {event.kind === "approval" && event.text && (
                <p className="worker-approval-reason">{event.text}</p>
              )}
              <Activity event={event} />
              {active &&
                event.kind === "approval" &&
                event.approvalId &&
                !resolved.has(event.approvalId) && (
                  <div className="worker-approval-actions">
                    <button
                      onClick={() => worker.approve(event.approvalId!, false)}
                    >
                      <X size={14} />
                      Recusar
                    </button>
                    <button
                      className="approve"
                      onClick={() => worker.approve(event.approvalId!, true)}
                    >
                      <Check size={14} />
                      Autorizar uma vez
                    </button>
                  </div>
                )}
            </div>
          ))}
      </div>
      {active && run.output && (
        <div className="worker-response" aria-live="polite">
          <MessageContent content={run.output} />
        </div>
      )}
      {!active && run.output && (
        <details className="worker-result">
          <summary>Resposta guardada do Worker</summary>
          <MessageContent content={run.output} />
        </details>
      )}
      {run.error && (
        <p className="account-issue" role="alert">
          {run.error}
        </p>
      )}
      {active && (
        <button className="text-button" onClick={worker.cancel}>
          <Square size={13} />
          Parar tarefa
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
        <strong>Runtime do Codex</strong>
        <p>{worker.runtime?.message || "A verificar o Docker..."}</p>
        <div className="worker-setup-actions">
          <button
            type="button"
            className="text-button"
            disabled={worker.preparing || worker.checking}
            onClick={worker.refresh}
          >
            {worker.checking ? "A verificar..." : "Verificar Docker"}
          </button>
          {!worker.runtime?.ready && (
            <button
              type="button"
              className="primary-button"
              disabled={!worker.runtime?.available || worker.preparing}
              onClick={worker.prepare}
            >
              {worker.preparing ? "A preparar o Codex..." : "Preparar Worker"}
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
}: {
  worker: WorkerController;
  conversationId: string | null;
  projectPath?: string;
  onEditPath?: () => void;
}) {
  const active =
    worker.active?.conversationId === conversationId ? worker.active : null;
  return (
    <section className="worker-panel" aria-label="Execução do Codex">
      <div className="worker-boundary">
        <ShieldCheck size={17} />
        <span>
          Isolado por projeto
          <span className="worker-boundary-detail">
            Comandos sem rede · Aprovações pontuais
          </span>
        </span>
      </div>
      <div className="worker-project">
        <Folder size={14} />
        <code>{projectPath || "Seleciona um projeto com pasta local"}</code>
        {onEditPath && (
          <button
            type="button"
            className="text-button"
            disabled={!!worker.active}
            onClick={onEditPath}
          >
            Definir pasta
          </button>
        )}
      </div>
      {!worker.runtime?.ready && <WorkerSetup worker={worker} />}
      {worker.issue && (
        <p className="account-issue" role="alert">
          {worker.issue}
        </p>
      )}
      {active && <RunActivity run={active} active worker={worker} />}
      {worker.history
        .filter((run) => run.id !== active?.id)
        .map((run) => (
          <details
            className="worker-history"
            key={run.id}
            open={worker.history[0]?.id === run.id && !active}
          >
            <summary>
              {labels[run.status] || run.status} ·{" "}
              {new Date(run.createdAt * 1000).toLocaleString()}
            </summary>
            <RunActivity run={run} active={false} worker={worker} />
          </details>
        ))}
    </section>
  );
}
