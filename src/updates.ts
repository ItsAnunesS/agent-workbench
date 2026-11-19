import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, isTauri } from "@tauri-apps/api/core";
import { invoke } from "./api";

export type UpdateStatus = { supported: boolean; version: string | null };
export type DownloadProgress = { downloaded: number; total: number };
export type UpdatePhase = "idle" | "checking" | "downloading" | "installed";
const preferenceKey = "workbench.checkUpdates";

export function readAutomaticChecks(): boolean {
  try {
    return localStorage.getItem(preferenceKey) !== "false";
  } catch {
    return true;
  }
}

export function useUpdates() {
  const [automatic, setAutomatic] = useState(readAutomaticChecks);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [issue, setIssue] = useState("");
  const [checked, setChecked] = useState(false);
  const operation = useRef(false);
  const installed = useRef(false);

  const check = useCallback(async () => {
    if (!isTauri() || operation.current || installed.current) return;
    operation.current = true;
    setPhase("checking");
    setIssue("");
    try {
      setStatus(await invoke<UpdateStatus>("app_update_check"));
      setChecked(true);
    } catch (error) {
      setIssue(String(error));
    } finally {
      operation.current = false;
      setPhase("idle");
    }
  }, []);

  useEffect(() => {
    if (!automatic || !isTauri()) return;
    const startup = window.setTimeout(() => void check(), 3000);
    const interval = window.setInterval(() => void check(), 6 * 60 * 60 * 1000);
    return () => {
      window.clearTimeout(startup);
      window.clearInterval(interval);
    };
  }, [automatic, check]);

  function selectAutomatic(value: boolean) {
    setAutomatic(value);
    try {
      localStorage.setItem(preferenceKey, String(value));
    } catch {
      // The in-memory preference still applies when storage is unavailable.
    }
  }

  async function install() {
    if (!status?.version || operation.current || installed.current) return;
    operation.current = true;
    setPhase("downloading");
    setIssue("");
    setProgress(null);
    const channel = new Channel<DownloadProgress>();
    channel.onmessage = setProgress;
    try {
      await invoke("app_update_install", { version: status.version, progress: channel });
      installed.current = true;
      setPhase("installed");
    } catch (error) {
      setIssue(String(error));
      setPhase("idle");
    } finally {
      operation.current = false;
    }
  }

  return { automatic, selectAutomatic, status, phase, progress, issue, checked, check, install };
}

export type AppUpdates = ReturnType<typeof useUpdates>;
