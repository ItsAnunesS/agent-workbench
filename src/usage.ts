import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { invoke } from "./api";

export interface UsageTokens {
  input: number | null;
  output: number | null;
  total: number | null;
  cached: number | null;
  reasoning: number | null;
}
export interface UsageTotals {
  responses: number;
  tokens: UsageTokens;
  firstRecordedAt: number | null;
  incompleteResponses: number;
}
export interface UsageSnapshot {
  connected: boolean;
  recordingIssue: boolean;
  allTime: UsageTotals;
  today: UsageTotals;
  lastSevenDays: UsageTotals;
  daily: { date: string; totalTokens: number | null; responses: number }[];
  recent: {
    source: string;
    model: string;
    createdAt: number;
    tokens: UsageTokens;
  }[];
}
export function useUsage(
  environmentId: string,
  accountId: string,
  connected: boolean,
  activity: string,
) {
  const scope = `${environmentId}:${accountId}:${connected}`;
  const [result, setResult] = useState<{
    scope: string;
    data: UsageSnapshot;
  } | null>(null);
  const [failure, setFailure] = useState<{
    scope: string;
    error: unknown;
  } | null>(null);
  const [loadingScope, setLoadingScope] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let alive = true;
    if (!connected || !isTauri()) return;
    setLoadingScope(scope);
    setFailure(null);
    invoke<UsageSnapshot>("openai_usage", { environmentId })
      .then((data) => {
        if (alive) setResult({ scope, data });
      })
      .catch((error) => {
        if (alive) setFailure({ scope, error });
      })
      .finally(() => {
        if (alive) setLoadingScope(null);
      });
    return () => {
      alive = false;
    };
  }, [scope, environmentId, connected, activity, revision]);
  useEffect(() => {
    if (!connected) return;
    const update = () => {
      if (!document.hidden) refresh();
    };
    const timer = setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [connected, refresh]);
  return {
    data: result?.scope === scope ? result.data : null,
    error: failure?.scope === scope ? failure.error : null,
    loading: loadingScope === scope,
    refresh,
  };
}
export type UsageController = ReturnType<typeof useUsage>;
