import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type { Conversation } from "./workspace";

export type WorkerEvent = {
  kind: string;
  text: string;
  approvalId?: string;
  item?: {
    type: string;
    id?: string;
    command?: string;
    cwd?: string;
    status?: string;
    exitCode?: number;
    output?: string;
    changes?: { path: string; diff: string; kind?: unknown }[];
  };
};
export type WorkerRun = {
  id: string;
  environmentId: string;
  projectId: string;
  conversationId: string;
  model: string;
  status: string;
  createdAt: number;
  events: WorkerEvent[];
  output: string;
  error: string | null;
};
export type RuntimeStatus = {
  available: boolean;
  ready: boolean;
  message: string;
};

export function useWorker(
  environmentId: string,
  conversationId: string | null,
) {
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [issue, setIssue] = useState("");
  const [active, setActive] = useState<WorkerRun | null>(null);
  const [history, setHistory] = useState<WorkerRun[]>([]);
  const running = useRef(false);
  const selection = useRef({ environmentId, conversationId });
  selection.current = { environmentId, conversationId };
  const refresh = useCallback(async () => {
    if (!isTauri()) {
      setRuntime({
        available: false,
        ready: false,
        message: "Abre a aplicação desktop para usar o Worker.",
      });
      return;
    }
    setChecking(true);
    try {
      setRuntime(await invoke<RuntimeStatus>("worker_runtime"));
    } catch (failure) {
      setIssue(String(failure));
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    let alive = true;
    setHistory([]);
    setIssue("");
    if (isTauri() && conversationId) {
      invoke<WorkerRun[]>("worker_history", { environmentId, conversationId })
        .then((runs) => {
          if (alive) setHistory(runs);
        })
        .catch((failure) => {
          if (alive) setIssue(String(failure));
        });
    }
    return () => {
      alive = false;
    };
  }, [environmentId, conversationId]);

  async function prepare() {
    setPreparing(true);
    setIssue("");
    try {
      setRuntime(await invoke<RuntimeStatus>("worker_prepare"));
    } catch (failure) {
      setIssue(String(failure));
    } finally {
      setPreparing(false);
    }
  }
  async function start(target: Conversation, model: string) {
    if (!isTauri() || running.current || !target.projectId) return null;
    running.current = true;
    setIssue("");
    const run: WorkerRun = {
      id: crypto.randomUUID(),
      environmentId: target.environmentId,
      projectId: target.projectId,
      conversationId: target.id,
      model,
      status: "running",
      createdAt: Date.now() / 1000,
      events: [],
      output: "",
      error: null,
    };
    setActive(run);
    const channel = new Channel<WorkerEvent>();
    channel.onmessage = (event) => {
      setActive((previous) => {
        if (!previous || previous.id !== run.id) return previous;
        if (event.kind === "delta")
          return { ...previous, output: previous.output + event.text };
        return {
          ...previous,
          status:
            event.kind === "approval"
              ? "awaitingApproval"
              : event.kind === "decision"
                ? previous.events.some(
                    (item) =>
                      (item.kind === "approval" ||
                        item.kind === "approvalSent") &&
                      item.approvalId !== event.approvalId &&
                      !previous.events.some(
                        (decision) =>
                          decision.kind === "decision" &&
                          decision.approvalId === item.approvalId,
                      ),
                  )
                  ? "awaitingApproval"
                  : "running"
                : previous.status,
          events: [...previous.events, event],
        };
      });
    };
    try {
      const result = await invoke<WorkerRun>("worker_run", {
        environmentId: target.environmentId,
        conversationId: target.id,
        model,
        runId: run.id,
        onEvent: channel,
      });
      if (
        selection.current.environmentId === target.environmentId &&
        selection.current.conversationId === target.id
      )
        setHistory((previous) =>
          [result, ...previous.filter((item) => item.id !== result.id)].slice(
            0,
            10,
          ),
        );
      if (result.error) setIssue(result.error);
      return result;
    } catch (failure) {
      setIssue(String(failure));
      return null;
    } finally {
      running.current = false;
      setActive(null);
    }
  }
  async function cancel() {
    if (!active) return;
    try {
      await invoke("worker_cancel", {
        environmentId: active.environmentId,
        conversationId: active.conversationId,
        runId: active.id,
      });
    } catch (failure) {
      setIssue(String(failure));
    }
  }
  async function approve(approvalId: string, accept: boolean) {
    if (!active) return;
    try {
      await invoke("worker_approve", {
        environmentId: active.environmentId,
        conversationId: active.conversationId,
        runId: active.id,
        approvalId,
        accept,
      });
      // Hide duplicate-click controls immediately; the durable decision arrives from the worker.
      setActive((previous) =>
        previous
          ? {
              ...previous,
              events: previous.events.map((event) =>
                event.approvalId === approvalId && event.kind === "approval"
                  ? { ...event, kind: "approvalSent" }
                  : event,
              ),
            }
          : previous,
      );
    } catch (failure) {
      setIssue(String(failure));
    }
  }
  return {
    runtime,
    preparing,
    checking,
    issue,
    active,
    history,
    start,
    prepare,
    refresh,
    cancel,
    approve,
  };
}
export type WorkerController = ReturnType<typeof useWorker>;
