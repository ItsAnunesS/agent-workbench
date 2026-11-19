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
  const automaticRef = useRef(automatic);

  const download = useCallback(async (version: string) => {
    setPhase("downloading");
    setProgress(null);
    const channel = new Channel<DownloadProgress>();
    channel.onmessage = setProgress;
    await invoke("app_update_install", { version, progress: channel });
    installed.current = true;
    setPhase("installed");
  }, []);

  const check = useCallback(async (installAutomatically = false) => {
    if (!isTauri() || operation.current || installed.current) return;
    operation.current = true;
    setPhase("checking");
    setIssue("");
    try {
      const next = await invoke<UpdateStatus>("app_update_check");
      setStatus(next);
      setChecked(true);
      if (installAutomatically && automaticRef.current && next.supported && next.version) {
        await download(next.version);
      }
    } catch (error) {
      setIssue(String(error));
    } finally {
      operation.current = false;
      if (!installed.current) setPhase("idle");
    }
  }, [download]);

  useEffect(() => {
    if (!automatic || !isTauri()) return;
    const startup = window.setTimeout(() => void check(true), 3000);
    const interval = window.setInterval(() => void check(), 6 * 60 * 60 * 1000);
    return () => {
      window.clearTimeout(startup);
      window.clearInterval(interval);
    };
  }, [automatic, check]);

  function selectAutomatic(value: boolean) {
    automaticRef.current = value;
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
    setIssue("");
    try {
      await download(status.version);
    } catch (error) {
      setIssue(String(error));
    } finally {
      operation.current = false;
      if (!installed.current) setPhase("idle");
    }
  }

  return { automatic, selectAutomatic, status, phase, progress, issue, checked, check, install };
}

export type AppUpdates = ReturnType<typeof useUpdates>;
