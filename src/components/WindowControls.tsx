import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";

export function WindowControls({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const [maximized, setMaximized] = useState(false);
  const native = isTauri();
  useEffect(() => {
    if (!native) return;
    let alive = true;
    const refresh = async () => {
      try {
        const value = await getCurrentWindow().isMaximized();
        if (alive) setMaximized(value);
      } catch {
        if (alive) onError("Não foi possível consultar o estado da janela.");
      }
    };
    void refresh();
    window.addEventListener("resize", refresh);
    return () => {
      alive = false;
      window.removeEventListener("resize", refresh);
    };
  }, [native, onError]);

  async function control(action: "minimize" | "maximize" | "close") {
    if (!native) return;
    try {
      const window = getCurrentWindow();
      if (action === "minimize") await window.minimize();
      else if (action === "close") await window.close();
      else {
        await window.toggleMaximize();
        setMaximized(await window.isMaximized());
      }
    } catch {
      onError("Não foi possível controlar a janela. Tenta novamente.");
    }
  }
  return (
    <div
      className="window-controls"
      role="group"
      aria-label="Controlos da janela"
      data-tauri-drag-region="false"
    >
      <button
        type="button"
        disabled={!native}
        aria-label="Minimizar janela"
        title="Minimizar"
        onClick={() => control("minimize")}
      >
        <Minus size={15} />
      </button>
      <button
        type="button"
        disabled={!native}
        aria-label={maximized ? "Restaurar janela" : "Maximizar janela"}
        title={maximized ? "Restaurar" : "Maximizar"}
        onClick={() => control("maximize")}
      >
        {maximized ? <Copy size={13} /> : <Square size={13} />}
      </button>
      <button
        type="button"
        disabled={!native}
        className="window-close"
        aria-label="Fechar janela"
        title="Fechar"
        onClick={() => control("close")}
      >
        <X size={16} />
      </button>
    </div>
  );
}
