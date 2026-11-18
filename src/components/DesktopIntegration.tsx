import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Monitor } from "lucide-react";

type Status = { supported: boolean; installed: boolean; issue: string | null };
export function DesktopIntegration() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState("");
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    invoke<Status>("desktop_integration_status")
      .then((value) => {
        if (alive) setStatus(value);
      })
      .catch((error) => {
        if (alive) setIssue(String(error));
      });
    return () => {
      alive = false;
    };
  }, []);
  async function repair() {
    setBusy(true);
    setIssue("");
    try {
      setStatus(await invoke<Status>("desktop_integration_repair"));
    } catch (error) {
      setIssue(String(error));
    } finally {
      setBusy(false);
    }
  }
  if (!status?.supported && !issue) return null;
  return (
    <div className="desktop-integration">
      <Monitor size={17} />
      <div>
        <strong>Logo no sistema</strong>
        <p>
          {status?.installed
            ? "O logo e o atalho estão registados no menu de aplicações deste utilizador."
            : "A integração com o menu precisa de atenção."}
        </p>
        {(issue || status?.issue) && (
          <p className="account-issue" role="alert">
            {issue || status?.issue}
          </p>
        )}
        {status?.supported && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={repair}
          >
            {busy ? "A atualizar..." : "Reparar integração"}
          </button>
        )}
      </div>
    </div>
  );
}
