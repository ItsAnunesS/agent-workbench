import { invoke } from "./api";
import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";

export interface Account {
  environmentId: string;
  email: string;
  connected: boolean;
  eligible: boolean;
  usageAccountId?: string;
}
export interface Model {
  slug: string;
  name: string;
}
export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | {
      type: "completed";
      input_tokens: number | null;
      output_tokens: number | null;
    }
  | { type: "summary"; text: string }
  | { type: "interrupted" };

export function useOpenAi(environmentId: string) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>(
    {},
  );
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [loginEnvironment, setLoginEnvironment] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [modelRevision, setModelRevision] = useState(0);
  const account = accounts.find((item) => item.environmentId === environmentId);
  const issue = issues[environmentId] || "";

  const refreshAccounts = useCallback(async () => {
    if (!isTauri()) return;
    setAccounts(await invoke<Account[]>("openai_accounts"));
  }, []);

  useEffect(() => {
    void refreshAccounts().catch(() =>
      setIssues((previous) => ({
        ...previous,
        [environmentId]: "Could not load local accounts.",
      })),
    );
  }, [refreshAccounts, environmentId]);

  useEffect(() => {
    let alive = true;
    setModels([]);
    setLoadingModels(false);
    if (!account?.connected || !account.eligible || !isTauri()) return;
    setLoadingModels(true);
    invoke<Model[]>("openai_models", { environmentId })
      .then((result) => {
        if (!alive) return;
        setModels(result);
        setSelectedModels((previous) => ({
          ...previous,
          [environmentId]: result.some(
            (model) => model.slug === previous[environmentId],
          )
            ? previous[environmentId]
            : result[0]?.slug || "",
        }));
        setIssues((previous) => ({
          ...previous,
          [environmentId]: result.length
            ? ""
            : "The account did not provide any models for this app.",
        }));
      })
      .catch((error) => {
        if (alive)
          setIssues((previous) => ({
            ...previous,
            [environmentId]: String(error),
          }));
      })
      .finally(() => {
        if (alive) setLoadingModels(false);
      });
    return () => {
      alive = false;
    };
  }, [
    environmentId,
    account?.connected,
    account?.eligible,
    account?.email,
    modelRevision,
  ]);

  async function login() {
    if (!isTauri()) {
      setIssues((previous) => ({
        ...previous,
        [environmentId]: "Open the AppImage to connect your account.",
      }));
      return;
    }
    setLoginEnvironment(environmentId);
    setIssues((previous) => ({ ...previous, [environmentId]: "" }));
    try {
      await invoke("openai_login", { environmentId });
      await refreshAccounts();
      setModelRevision((previous) => previous + 1);
    } catch (error) {
      setIssues((previous) => ({
        ...previous,
        [environmentId]: String(error),
      }));
    } finally {
      setLoginEnvironment(null);
    }
  }

  async function logout() {
    setDisconnecting(true);
    try {
      const revoked = await invoke<boolean>("openai_logout", { environmentId });
      await refreshAccounts();
      setModels([]);
      setIssues((previous) => ({
        ...previous,
        [environmentId]: revoked
          ? ""
          : "Local session ended. Remote revocation could not be confirmed. You can remove access in ChatGPT settings.",
      }));
    } catch (error) {
      setIssues((previous) => ({
        ...previous,
        [environmentId]: String(error),
      }));
    } finally {
      setDisconnecting(false);
    }
  }

  return {
    account,
    models,
    model: selectedModels[environmentId] || "",
    issue,
    loginEnvironment,
    loadingModels,
    disconnecting,
    login,
    logout,
    selectModel: (model: string) =>
      setSelectedModels((previous) => ({
        ...previous,
        [environmentId]: model,
      })),
    reloadModels: () => setModelRevision((previous) => previous + 1),
    cancelLogin: () =>
      invoke("openai_cancel_login").catch((error) =>
        setIssues((previous) => ({
          ...previous,
          [environmentId]: String(error),
        })),
      ),
  };
}
