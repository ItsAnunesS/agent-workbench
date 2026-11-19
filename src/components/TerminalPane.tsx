import { useEffect, useRef, useState } from "react";
import { Channel, isTauri } from "@tauri-apps/api/core";
import { invoke } from "../api";
import { localizeMessage, t } from "../i18n";
import type { ToolScope } from "../tool-types";
import "@xterm/xterm/css/xterm.css";

export function TerminalPane({
  scope,
  active,
}: {
  scope: ToolScope;
  active: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [exited, setExited] = useState(false);
  useEffect(() => {
    if (!host.current || !isTauri()) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    setError(null);
    setExited(false);
    Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")])
      .then(async ([{ Terminal }, { FitAddon }]) => {
        if (cancelled || !host.current) return;
        const terminal = new Terminal({
          cursorBlink: true,
          fontSize: 12,
          fontFamily: '"Source Code Pro", monospace',
          scrollback: 1500,
          theme: { background: "#151619", foreground: "#eee9e0" },
          allowProposedApi: false,
        });
        const fit = new FitAddon();
        terminal.loadAddon(fit);
        terminal.open(host.current);
        fit.fit();
        let id: string | undefined;
        let pendingCredits = 0;
        const output = new Channel<{ data: number[]; exited: boolean }>();
        output.onmessage = (event) => {
          if (cancelled) return;
          if (event.data.length)
            terminal.write(new Uint8Array(event.data), () => {
              pendingCredits += event.data.length;
              acknowledge();
            });
          if (event.exited) setExited(true);
        };
        const control = (
          action: string,
          extra: Record<string, unknown> = {},
        ) =>
          id
            ? invoke("terminal_control", { scope, id, action, ...extra })
            : Promise.resolve();
        function acknowledge() {
          if (!id || !pendingCredits) return;
          const count = pendingCredits;
          pendingCredits = 0;
          void control("ack", { data: String(count) }).catch(() => {
            // Output can finish parsing after the shell exits or its panel closes.
          });
        }
        let inputQueue = Promise.resolve<unknown>(undefined);
        const input = terminal.onData((data) => {
          inputQueue = inputQueue
            .then(() => (cancelled ? undefined : control("write", { data })))
            .catch((failure) => {
              if (!cancelled) setError(failure);
            });
        });
        const resize = terminal.onResize(({ cols, rows }) => {
          void control("resize", { cols, rows }).catch((failure) => {
            if (!cancelled) setError(failure);
          });
        });
        const observer = new ResizeObserver(() => {
          if (host.current?.clientWidth && host.current?.clientHeight)
            fit.fit();
        });
        observer.observe(host.current);
        dispose = () => {
          observer.disconnect();
          input.dispose();
          resize.dispose();
          terminal.dispose();
          if (id)
            void control("close").catch(() => {
              /* The shell may already have exited. */
            });
        };
        try {
          id = await invoke<string>("terminal_open", {
            scope,
            cols: Math.max(2, terminal.cols),
            rows: Math.max(1, terminal.rows),
            output,
          });
          acknowledge();
          if (cancelled) {
            void control("close").catch(() => {});
          } else terminal.focus();
        } catch (failure) {
          if (!cancelled) setError(failure);
        }
      })
      .catch((failure) => {
        if (!cancelled) setError(failure);
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [scope, revision]);
  return (
    <section className="tool-terminal" hidden={!active}>
      <div className="tool-toolbar">
        <span>{t("Local terminal")}</span>
        <button onClick={() => setRevision((value) => value + 1)}>
          {t("Restart terminal")}
        </button>
      </div>
      <p className="tool-hint">
        {t(
          "Commands run on this computer. The AI Worker remains isolated in Docker.",
        )}
      </p>
      {!isTauri() && (
        <p>{t("Open the desktop app to use the local terminal.")}</p>
      )}
      {error != null && (
        <p className="tool-error" role="alert">
          {localizeMessage(error)}
        </p>
      )}
      {exited && (
        <p role="status">
          {t("The shell has exited. Restart the terminal to continue.")}
        </p>
      )}
      <div ref={host} className="terminal-viewport" />
    </section>
  );
}
