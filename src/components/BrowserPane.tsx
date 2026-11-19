import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Home, RefreshCw } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { invoke } from "../api";
import { browserAddress } from "../browser-address";
import { localizeMessage, t } from "../i18n";
import type { BrowserSnapshot, ToolScope } from "../tool-types";

// Native WebKit operations stay ordered even while React changes scope or closes a panel.
let browserQueue: Promise<unknown> = Promise.resolve();
function request(
  scope: ToolScope,
  action: string,
  extra: Record<string, unknown> = {},
) {
  const operation = browserQueue
    .catch(() => {})
    .then(() => invoke("tool_browser", { scope, action, ...extra }));
  browserQueue = operation;
  return operation;
}
export function BrowserPane({
  scope,
  active,
  address,
  requestId,
  onSnapshot,
  onHome,
}: {
  scope: ToolScope;
  active: boolean;
  address: string;
  requestId: number;
  onSnapshot: (value: BrowserSnapshot) => void;
  onHome: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState(address);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const openedRef = useRef(false);
  const focused = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const bounds = () => {
    const rect = viewport.current?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0
      ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      : null;
  };
  const navigate = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value) return;
      setError(null);
      if (!isTauri()) {
        setError(
          new Error("Open the desktop app to use the integrated browser."),
        );
        return;
      }
      const rectangle = bounds();
      if (!rectangle) return;
      const url = browserAddress(value);
      try {
        await request(scope, "open", { url, bounds: rectangle });
        openedRef.current = true;
        setOpened(true);
        setInput(url);
        if (!activeRef.current) await request(scope, "hide");
      } catch (failure) {
        setError(failure);
      }
    },
    [scope],
  );
  useEffect(() => {
    if (address) void navigate(address);
  }, [address, navigate, requestId]);
  useEffect(() => {
    let alive = true;
    const update = () => {
      if (!isTauri()) return;
      invoke<BrowserSnapshot>("tool_browser_snapshot", { scope })
        .then((value) => {
          if (!alive) return;
          onSnapshot(value);
          if (value.url && !focused.current) setInput(value.url);
        })
        .catch((failure) => {
          if (alive && activeRef.current) setError(failure);
        });
    };
    update();
    const timer = active ? setInterval(update, 1500) : undefined;
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [scope, onSnapshot, active]);
  useEffect(() => {
    if (!isTauri()) return;
    const adjust = () => {
      if (!openedRef.current) return;
      const rectangle = bounds();
      void request(
        scope,
        activeRef.current && rectangle ? "show" : "hide",
        rectangle ? { bounds: rectangle } : {},
      ).catch(setError);
    };
    const observer = new ResizeObserver(adjust);
    if (viewport.current) observer.observe(viewport.current);
    window.addEventListener("resize", adjust);
    window.addEventListener("scroll", adjust, true);
    adjust();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", adjust);
      window.removeEventListener("scroll", adjust, true);
    };
  }, [scope, active, opened]);
  useEffect(
    () => () => {
      if (isTauri())
        void request(scope, "close").catch(() => {
          /* A deleted scope may already be closed. */
        });
    },
    [scope],
  );
  async function control(action: string) {
    try {
      await request(scope, action);
    } catch (failure) {
      setError(failure);
    }
  }
  return (
    <section className="tool-browser" hidden={!active}>
      <form
        className="browser-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate(input);
        }}
      >
        <button
          type="button"
          title={t("Back")}
          aria-label={t("Back")}
          disabled={!opened}
          onClick={() => void control("back")}
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          title={t("Forward")}
          aria-label={t("Forward")}
          disabled={!opened}
          onClick={() => void control("forward")}
        >
          <ArrowRight size={14} />
        </button>
        <button
          type="button"
          title={t("Reload page")}
          aria-label={t("Reload page")}
          disabled={!opened}
          onClick={() => void control("reload")}
        >
          <RefreshCw size={14} />
        </button>
        <input
          aria-label={t("Search or enter a URL")}
          placeholder={t("Enter a URL")}
          value={input}
          onFocus={() => (focused.current = true)}
          onBlur={() => (focused.current = false)}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit">{t("Go")}</button>
        <button
          type="button"
          aria-label={t("Tools dashboard")}
          onClick={onHome}
        >
          <Home size={14} />
        </button>
      </form>
      {error != null && (
        <p role="alert" className="tool-error">
          {localizeMessage(error)}
        </p>
      )}
      <div className="browser-viewport" ref={viewport}>
        {!opened && (
          <p className="tool-empty">
            {t(
              "Enter an address to open a page in this project's or conversation's browser session.",
            )}
          </p>
        )}
      </div>
    </section>
  );
}
