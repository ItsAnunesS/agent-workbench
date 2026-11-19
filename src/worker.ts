import { invoke } from "./api";
import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, isTauri } from "@tauri-apps/api/core";
import type { Conversation } from "./workspace";

export type ApprovalMode = "ask" | "auto";
export function readApprovalMode(): ApprovalMode {
  try {
    return localStorage.getItem("workbench.approvalMode") === "auto"
      ? "auto"
      : "ask";
  } catch {
    return "ask";
  }
}
export function saveApprovalMode(value: ApprovalMode) {
  try {
    localStorage.setItem("workbench.approvalMode", value);
  } catch {
    /* Keep the preference in memory when storage is unavailable. */
  }
}
export function workerAnswer(run: WorkerRun) {
  if (run.finalOutput != null) return run.finalOutput;
  const messages = coalesceEvents(run.events).filter(
    (event) => event.item?.type === "agentMessage",
  );
  if (
    messages.length &&
    messages.every((event) => event.item?.phase === "commentary")
  )
    return "";
  return messages.at(-1)?.item?.text || run.output;
}

export type WorkerEvent = {
  kind: string;
  text: string;
  approvalId?: string;
  item?: {
    type: string;
    text?: string;
    phase?: string;
    summary?: string;
    id?: string;
    command?: string;
    cwd?: string;
    status?: string;
    exitCode?: number;
    output?: string;
    changes?: { path: string; diff: string; kind?: unknown }[];
  };
};
export function coalesceEvents(events: WorkerEvent[]): WorkerEvent[] {
  const result: WorkerEvent[] = [];
  for (const event of events) {
    const index =
      event.kind === "activity" && event.item?.id
        ? result.findIndex(
            (entry) =>
              entry.kind === "activity" && entry.item?.id === event.item!.id,
          )
        : -1;
    if (index >= 0) result[index] = event;
    else result.push(event);
  }
  return result;
}
export type WorkerRun = {
  id: string;
  environmentId: string;
  projectId: string;
  conversationId: string;
  model: string;
  status: string;
  createdAt: number;
  durationMs?: number;
  userMessageId?: string;
  finalOutput?: string;
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
        message: "Open the desktop app to use Worker.",
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
  async function start(
    target: Conversation,
    model: string,
    approvalMode: ApprovalMode,
  ) {
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
      userMessageId: target.messages
        .filter((item) => item.role !== "assistant")
        .at(-1)?.id,
      events: [],
      output: "",
      error: null,
    };
    setActive(run);
    const channel = new Channel<WorkerEvent>();
    channel.onmessage = (event) => {
      setActive((previous) => {
        if (!previous || previous.id !== run.id) return previous;
        if (event.kind === "delta") {
          const events = [...previous.events];
          if (event.item?.id) {
            const index = events.findIndex(
              (item) =>
                item.item?.id === event.item!.id &&
                item.item?.type === "agentMessage",
            );
            if (index >= 0)
              events[index] = {
                ...events[index],
                item: {
                  ...events[index].item!,
                  text: (events[index].item?.text || "") + event.text,
                },
              };
            else
              events.push({
                kind: "activity",
                text: "",
                item: { ...event.item, text: event.text },
              });
          }
          return { ...previous, output: previous.output + event.text, events };
        }
        const events = [...previous.events];
        const index = event.item?.id
          ? events.findIndex(
              (item) =>
                item.item?.id === event.item!.id && item.kind === "activity",
            )
          : -1;
        if (index >= 0 && event.kind === "activity") events[index] = event;
        else events.push(event);
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
          events,
        };
      });
    };
    try {
      const response = await invoke<WorkerRun>("worker_run", {
        environmentId: target.environmentId,
        conversationId: target.id,
        model,
        runId: run.id,
        onEvent: channel,
        approvalMode,
        userMessageId: run.userMessageId,
      });
      const result = {
        ...response,
        userMessageId: response.userMessageId || run.userMessageId,
        durationMs:
          response.durationMs ?? Math.max(0, Date.now() - run.createdAt * 1000),
      };
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
    history: history.filter(
      (run) =>
        run.environmentId === environmentId &&
        run.conversationId === conversationId,
    ),
    start,
    prepare,
    refresh,
    cancel,
    approve,
  };
}
export type WorkerController = ReturnType<typeof useWorker>;
