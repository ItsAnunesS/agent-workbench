import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  FileText,
  FolderTree,
  Globe,
  Home,
  Maximize2,
  Minimize2,
  TerminalSquare,
  GitCompareArrows,
  Info,
  X,
} from "lucide-react";
import { dateLocale, t } from "../i18n";
import { workerStatusLabel } from "./WorkerPanel";
import { coalesceEvents, type WorkerRun } from "../worker";
import type { BrowserSnapshot, ToolScope } from "../tool-types";
import { ProjectFiles } from "./ProjectFiles";
import { BrowserPane } from "./BrowserPane";
import { TerminalPane } from "./TerminalPane";

const tools = [
  { id: "home", label: "Tools dashboard", Icon: Home },
  { id: "files", label: "Files", Icon: FolderTree },
  { id: "changes", label: "Changes", Icon: GitCompareArrows },
  { id: "terminal", label: "Terminal", Icon: TerminalSquare },
  { id: "browser", label: "Browser", Icon: Globe },
  { id: "context", label: "Context", Icon: Info },
] as const;
type Tab = (typeof tools)[number]["id"];
function Changes({ runs }: { runs: WorkerRun[] }) {
  const [selected, setSelected] = useState("");
  const run = runs.find((value) => value.id === selected) || runs[0];
  const changes = run
    ? coalesceEvents(run.events).flatMap((event) =>
        event.item?.type === "fileChange" ? event.item.changes || [] : [],
      )
    : [];
  return (
    <section className="tool-changes">
      <div className="tool-toolbar">
        <label>
          {t("Worker run")}{" "}
          <select
            aria-label={t("Worker run")}
            value={run?.id || ""}
            onChange={(event) => setSelected(event.target.value)}
          >
            {runs.map((value) => (
              <option key={value.id} value={value.id}>
                {new Date(value.createdAt * 1000).toLocaleString(dateLocale())}{" "}
                · {workerStatusLabel(value.status)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="tool-hint">
        {t(
          "Changes reported by the AI in the selected task. Saved event previews may be truncated.",
        )}
      </p>
      {!changes.length && (
        <p className="tool-empty">
          {t("No AI file changes recorded in this task yet.")}
        </p>
      )}
      {changes.map((change, index) => (
        <details className="diff-file" key={`${change.path}-${index}`} open>
          <summary>
            <FileText size={14} />
            {change.path}
          </summary>
          <pre>
            {change.diff.split("\n").map((line, lineIndex) => (
              <div
                key={lineIndex}
                className={
                  line.startsWith("+") && !line.startsWith("+++")
                    ? "diff-added"
                    : line.startsWith("-") && !line.startsWith("---")
                      ? "diff-removed"
                      : ""
                }
              >
                {line || " "}
              </div>
            ))}
          </pre>
        </details>
      ))}
    </section>
  );
}
export function ToolPanel({
  environmentId,
  projectId,
  conversationId,
  projectName,
  runs,
  suspended,
  onCreateConversation,
  onClose,
  children,
}: {
  environmentId: string;
  projectId: string | null;
  conversationId: string | null;
  projectName?: string;
  runs: WorkerRun[];
  suspended: boolean;
  onCreateConversation: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const scope = useMemo<ToolScope>(
    () => ({ environmentId, projectId, conversationId }),
    [environmentId, projectId, conversationId],
  );
  const key = JSON.stringify(scope);
  return (
    <ScopedTools
      key={key}
      scope={scope}
      projectName={projectName}
      runs={runs}
      suspended={suspended}
      onCreateConversation={onCreateConversation}
      onClose={onClose}
    >
      {children}
    </ScopedTools>
  );
}
function ScopedTools({
  scope,
  projectName,
  runs,
  suspended,
  onCreateConversation,
  onClose,
  children,
}: {
  scope: ToolScope;
  projectName?: string;
  runs: WorkerRun[];
  suspended: boolean;
  onCreateConversation: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("home");
  const [expanded, setExpanded] = useState(false);
  const [terminalOpened, setTerminalOpened] = useState(false);
  const [address, setAddress] = useState("");
  const [requestId, setRequestId] = useState(0);
  const [snapshot, setSnapshot] = useState<BrowserSnapshot>({
    url: null,
    pages: [],
  });
  const updateSnapshot = useCallback(
    (value: BrowserSnapshot) => setSnapshot(value),
    [],
  );
  const ready = !!(scope.projectId || scope.conversationId);
  function select(value: Tab) {
    setTab(value);
    if (value === "terminal") setTerminalOpened(true);
  }
  function visit(url: string) {
    setAddress(url);
    setRequestId((value) => value + 1);
    setTab("browser");
  }
  return (
    <aside
      className={`context-panel tools-panel ${expanded ? "tools-expanded" : ""}`}
      aria-label={t("Workspace tools")}
    >
      <header className="tools-header">
        <strong>{t("Workspace tools")}</strong>
        <div>
          <button
            aria-label={t(
              expanded ? "Restore tools panel" : "Expand tools panel",
            )}
            title={t(expanded ? "Restore tools panel" : "Expand tools panel")}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button aria-label={t("Close tools panel")} onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </header>
      <div
        role="tablist"
        aria-label={t("Apps")}
        className="tools-tabs"
        onKeyDown={(event) => {
          const index = tools.findIndex((tool) => tool.id === tab);
          const next =
            event.key === "ArrowRight"
              ? (index + 1) % tools.length
              : event.key === "ArrowLeft"
                ? (index + tools.length - 1) % tools.length
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tools.length - 1
                    : null;
          if (next == null) return;
          event.preventDefault();
          select(tools[next].id);
          document.getElementById(`tool-tab-${tools[next].id}`)?.focus();
        }}
      >
        {tools.map(({ id, label, Icon }) => (
          <button
            role="tab"
            key={id}
            id={`tool-tab-${id}`}
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            aria-controls={`tool-pane-${id}`}
            title={t(label)}
            onClick={() => select(id)}
          >
            <Icon size={16} />
            <span>{t(label)}</span>
          </button>
        ))}
      </div>
      <div className="tools-content">
        <section
          role="tabpanel"
          id="tool-pane-home"
          aria-labelledby="tool-tab-home"
          hidden={tab !== "home"}
          className="tools-dashboard"
        >
          <span className="eyebrow">{projectName || t("Workspace tools")}</span>
          <h2>{t("Your workspace, at hand.")}</h2>
          <p className="subtle">
            {t(
              "Browse files, inspect AI changes, run a terminal and open the web alongside your chat.",
            )}
          </p>
          <div className="tool-cards">
            {tools
              .filter((value) => !["home", "context"].includes(value.id))
              .map(({ id, label, Icon }) => (
                <button key={id} onClick={() => select(id)}>
                  <Icon size={19} />
                  <strong>{t(label)}</strong>
                  <span>
                    {t(
                      id === "files"
                        ? "Explore the selected project"
                        : id === "changes"
                          ? "Review the AI's file changes"
                          : id === "terminal"
                            ? "Open your local shell"
                            : "Browse with an isolated session",
                    )}
                  </span>
                </button>
              ))}
          </div>
          <h3>{t("Recently visited")}</h3>
          {!ready ? (
            <div className="tool-empty">
              <p>{t("Select a project or conversation to use this tool.")}</p>
              <button className="primary-button" onClick={onCreateConversation}>
                {t("New conversation")}
              </button>
            </div>
          ) : snapshot.pages.length ? (
            <div className="recent-pages">
              {snapshot.pages.map((page) => (
                <button key={page.url} onClick={() => visit(page.url)}>
                  <Globe size={16} />
                  <span>
                    <strong>{page.title}</strong>
                    <small>{page.url}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="subtle">
              {t(
                "Pages you visit in this project or conversation will appear here.",
              )}
            </p>
          )}
        </section>
        <section
          role="tabpanel"
          id="tool-pane-files"
          aria-labelledby="tool-tab-files"
          hidden={tab !== "files"}
        >
          {tab === "files" && (
            <ProjectFiles scope={scope} projectName={projectName} />
          )}
        </section>
        <section
          role="tabpanel"
          id="tool-pane-changes"
          aria-labelledby="tool-tab-changes"
          hidden={tab !== "changes"}
        >
          {tab === "changes" && <Changes runs={runs} />}
        </section>
        <section
          role="tabpanel"
          id="tool-pane-terminal"
          aria-labelledby="tool-tab-terminal"
          hidden={tab !== "terminal"}
        >
          {ready ? (
            terminalOpened && (
              <TerminalPane scope={scope} active={tab === "terminal"} />
            )
          ) : (
            <p className="tool-empty">
              {t("Select a project or conversation to use this tool.")}
            </p>
          )}
        </section>
        <section
          role="tabpanel"
          id="tool-pane-browser"
          aria-labelledby="tool-tab-browser"
          hidden={tab !== "browser"}
        >
          {ready ? (
            <BrowserPane
              scope={scope}
              active={tab === "browser" && !suspended}
              address={address}
              requestId={requestId}
              onSnapshot={updateSnapshot}
              onHome={() => setTab("home")}
            />
          ) : (
            <p className="tool-empty">
              {t("Select a project or conversation to use this tool.")}
            </p>
          )}
        </section>
        <section
          role="tabpanel"
          id="tool-pane-context"
          aria-labelledby="tool-tab-context"
          hidden={tab !== "context"}
          className="tool-context"
        >
          {children}
        </section>
      </div>
    </aside>
  );
}
