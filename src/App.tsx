import { GlobalInstructionsSettings } from "./components/GlobalInstructionsSettings";
import { InteractiveBrandMark } from "./components/InteractiveBrandMark";
import { ToolPanel } from "./components/ToolPanel";
import { TerminalSettings } from "./components/TerminalSettings";
import { Fragment } from "react";
import {
  WorkspaceSidebar,
  type SidebarTarget,
  type SidebarAction,
} from "./components/WorkspaceSidebar";
import { ManagementDialog } from "./components/ManagementDialog";
import { ActivityIndicator } from "./components/ActivityIndicator";
import { invoke } from "./api";
import { t, useLocale, dateLocale, localizeMessage } from "./i18n";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { version as appVersion } from "../package.json";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Channel, isTauri } from "@tauri-apps/api/core";
import {
  ArrowRight,
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  CircleHelp,
  Code2,
  Cpu,
  Folder,
  FolderPlus,
  Layers3,
  LockKeyhole,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Sun,
  Moon,
  X,
} from "lucide-react";
import { useOpenAi, type ChatStreamEvent } from "./openai";
import { DesktopIntegration } from "./components/DesktopIntegration";
import { WindowControls } from "./components/WindowControls";
import { useTheme } from "./theme";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import {
  useWorker,
  readApprovalMode,
  saveApprovalMode,
  workerAnswer,
  type ApprovalMode,
} from "./worker";
import {
  WorkerPanel,
  WorkerSetup,
  RunActivity,
} from "./components/WorkerPanel";
import { BrandMark, BrandWordmark } from "./components/Brand";
import { MessageContent } from "./components/MessageContent";
import {
  createConversation,
  createHandoff,
  isArchived,
  removeConversation,
  removeProject,
  duplicateConversation,
  type Color,
  type Conversation,
  type Mode,
  type Workspace,
} from "./workspace";

type Dialog =
  | "projectPath"
  | "environment"
  | "project"
  | "memory"
  | "environmentInstructions"
  | "settings"
  | "globalSettings"
  | null;
const previewWorkspace: Workspace = {
  version: 1,
  environments: [
    { id: "personal", name: "Personal", color: "violet", instructions: "" },
    { id: "work", name: "Work", color: "blue", instructions: "" },
  ],
  projects: [],
  conversations: [],
};

export default function App() {
  useLocale();
  const appearance = useTheme();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [environmentId, setEnvironmentId] = useState("personal");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("chat");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [rightPanel, setRightPanel] = useState(() => window.innerWidth > 1180);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [approvalMode, setApprovalMode] =
    useState<ApprovalMode>(readApprovalMode);
  const [management, setManagement] = useState<{
    target: SidebarTarget;
    action: "rename" | "move" | "delete";
    value: string;
  } | null>(null);
  const [saveStatus, setSaveStatus] = useState("Saved on this device");
  const [error, setError] = useState("");
  const [formName, setFormName] = useState("");
  const [formPath, setFormPath] = useState("");
  const [formText, setFormText] = useState("");
  const [formColor, setFormColor] = useState<Color>("green");
  const openai = useOpenAi(environmentId);
  const worker = useWorker(
    environmentId,
    mode === "worker" ? conversationId : null,
  );
  const workspaceRef = useRef<Workspace | null>(null);
  const savedWorkspaceRef = useRef<Workspace | null>(null);
  const [activeRequest, setActiveRequest] = useState<{
    id: string;
    environmentId: string;
    conversationId: string;
    text: string;
    summary: string;
    startedAt: number;
  } | null>(null);
  const requestRef = useRef<string | null>(null);
  const [lastUsage, setLastUsage] = useState<{
    environmentId: string;
    input: number;
    output: number;
  } | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followResponseRef = useRef(true);
  const draftsRef = useRef(new Map<string, string>());
  const [showLatest, setShowLatest] = useState(false);

  useEffect(() => {
    if (!dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      if (!modalRef.current?.contains(document.activeElement)) {
        modalRef.current
          ?.querySelector<HTMLElement>(
            "input, textarea, button:not(.modal-close)",
          )
          ?.focus();
      }
    });
    function trapFocus(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDialog(null);
        return;
      }
      if (event.key !== "Tab") return;
      const elements = Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input, textarea, select, summary, a[href]",
        ) || [],
      );
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
    }
    document.addEventListener("keydown", trapFocus);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", trapFocus);
      previousFocus?.focus();
    };
  }, [dialog]);

  useEffect(() => {
    let alive = true;
    (isTauri()
      ? invoke<Workspace>("load_workspace")
      : Promise.resolve(previewWorkspace)
    )
      .then((data) => {
        if (alive) {
          workspaceRef.current = data;
          savedWorkspaceRef.current = data;
          setWorkspace(data);
          setEnvironmentId(data.environments[0].id);
        }
      })
      .catch(() => {
        if (alive) setError("Could not open local data. Restart the app.");
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    followResponseRef.current = true;
    setShowLatest(false);
    endRef.current?.scrollIntoView({ behavior: "auto" });
  }, [conversationId]);

  useEffect(() => {
    if (followResponseRef.current)
      endRef.current?.scrollIntoView({ behavior: "auto" });
  }, [
    workspace?.conversations,
    activeRequest?.text,
    worker.active?.output,
    worker.active?.events.length,
  ]);

  function commit(next: Workspace): Promise<boolean> {
    workspaceRef.current = next;
    setWorkspace(next);
    setSaveStatus("Saving...");
    setError("");
    const save = saveQueue.current
      .then(async () => {
        if (isTauri()) await invoke("save_workspace", { workspace: next });
        savedWorkspaceRef.current = next;
        setSaveStatus(isTauri() ? "Saved on this device" : "Browser preview");
        return true;
      })
      .catch(() => {
        setError("Could not save. Keep the app open and try again.");
        setSaveStatus("Unsaved changes");
        return false;
      });
    saveQueue.current = save.then(() => undefined);
    return save;
  }

  async function requestResponse(target: Conversation) {
    if (workspaceRef.current && isArchived(workspaceRef.current, target))
      return;
    if (
      !isTauri() ||
      requestRef.current ||
      !openai.account?.eligible ||
      !openai.model
    )
      return;
    const id = crypto.randomUUID();
    setError("");
    requestRef.current = id;
    setActiveRequest({
      id,
      environmentId: target.environmentId,
      conversationId: target.id,
      text: "",
      summary: "",
      startedAt: Date.now(),
    });
    const startedAt = performance.now();
    let text = "";
    let summary = "";
    const outcome = {
      status: "failed" as "completed" | "interrupted" | "failed",
    };
    let responseError = "";
    const channel = new Channel<ChatStreamEvent>();
    channel.onmessage = (event) => {
      if (event.type === "delta") {
        text += event.text;
        setActiveRequest((previous) =>
          previous?.id === id ? { ...previous, text } : previous,
        );
      } else if (event.type === "summary") {
        summary = (summary + event.text).slice(0, 20000);
        setActiveRequest((previous) =>
          previous?.id === id ? { ...previous, summary } : previous,
        );
      } else if (event.type === "completed") {
        outcome.status = "completed";
        setLastUsage({
          environmentId: target.environmentId,
          input: event.input_tokens || 0,
          output: event.output_tokens || 0,
        });
      } else if (event.type === "interrupted") {
        outcome.status = "interrupted";
      }
    };
    try {
      await saveQueue.current;
      if (workspaceRef.current !== savedWorkspaceRef.current)
        throw new Error("Save local changes before sending context to OpenAI.");
      await invoke("openai_chat", {
        environmentId: target.environmentId,
        conversationId: target.id,
        model: openai.model,
        requestId: id,
        onEvent: channel,
      });
      if (!text && outcome.status === "completed")
        responseError = "OpenAI completed the request without returning text.";
    } catch (failure) {
      responseError = String(failure);
    } finally {
      const latest = workspaceRef.current;
      if (text && latest) {
        await commit({
          ...latest,
          conversations: latest.conversations.map((item) =>
            item.id === target.id
              ? {
                  ...item,
                  messages: [
                    ...item.messages,
                    {
                      id: crypto.randomUUID(),
                      role: "assistant",
                      status: outcome.status,
                      content: text,
                      summary,
                      durationMs: Math.round(performance.now() - startedAt),
                      createdAt: new Date().toISOString(),
                    },
                  ],
                }
              : item,
          ),
        });
      }
      requestRef.current = null;
      setActiveRequest(null);
      if (responseError) setError(responseError);
    }
  }

  async function executeWorker(target: Conversation) {
    if (workspaceRef.current && isArchived(workspaceRef.current, target))
      return;
    if (
      worker.active ||
      requestRef.current ||
      !openai.account?.eligible ||
      !openai.model
    )
      return;
    await saveQueue.current;
    if (workspaceRef.current !== savedWorkspaceRef.current) {
      setError("Save changes before running the task.");
      return;
    }
    const result = await worker.start(target, openai.model, approvalMode);
    const latest = workspaceRef.current;
    if (result && workerAnswer(result) && latest) {
      await commit({
        ...latest,
        conversations: latest.conversations.map((item) =>
          item.id === target.id
            ? {
                ...item,
                messages: [
                  ...item.messages,
                  {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    status:
                      result.status === "completed"
                        ? "completed"
                        : result.status === "interrupted"
                          ? "interrupted"
                          : "failed",
                    content: workerAnswer(result),
                    durationMs: result.durationMs,
                    workerRunId: result.id,
                    createdAt: new Date().toISOString(),
                  },
                ],
              }
            : item,
        ),
      });
    }
  }

  async function cancelResponse() {
    if (!activeRequest) return;
    try {
      await invoke("openai_cancel_chat", {
        environmentId: activeRequest.environmentId,
        requestId: activeRequest.id,
      });
    } catch (failure) {
      setError(String(failure));
    }
  }

  if (!workspace)
    return (
      <div className="loading" data-tauri-drag-region="deep">
        <div className="loading-window-controls">
          <WindowControls onError={setError} />
        </div>
        <BrandMark className="loading-logo" />
        <BrandWordmark theme={appearance.theme} />
        <p>{error ? localizeMessage(error) : t("Opening your workspace...")}</p>
      </div>
    );

  const environment = workspace.environments.find(
    (item) => item.id === environmentId,
  )!;
  const projects = workspace.projects.filter(
    (item) => item.environmentId === environmentId && !item.archived,
  );
  const project = workspace.projects.find(
    (item) => item.id === projectId && item.environmentId === environmentId,
  );
  const conversation = workspace.conversations.find(
    (item) =>
      item.id === conversationId &&
      item.environmentId === environmentId &&
      item.mode === mode,
  );
  const scopeArchived = conversation
    ? isArchived(workspace, conversation)
    : !!project?.archived;
  const busyIds = [
    activeRequest?.conversationId,
    worker.active?.conversationId,
  ].filter((id): id is string => !!id);

  function changeScope(
    nextEnvironmentId: string,
    nextProjectId: string | null,
    nextMode = mode,
    nextConversationId: string | null = null,
  ) {
    draftsRef.current.set(
      JSON.stringify([environmentId, projectId, mode, conversationId]),
      draft,
    );
    setEnvironmentId(nextEnvironmentId);
    setProjectId(nextProjectId);
    setMode(nextMode);
    setConversationId(nextConversationId);
    setDraft(
      draftsRef.current.get(
        JSON.stringify([
          nextEnvironmentId,
          nextProjectId,
          nextMode,
          nextConversationId,
        ]),
      ) || "",
    );
    setQuery("");
  }

  function newConversation() {
    if (scopeArchived) return;
    const next = createConversation(environmentId, mode, projectId);
    commit({
      ...workspace!,
      conversations: [next, ...workspace!.conversations],
    });
    changeScope(environmentId, projectId, mode, next.id);
    composerRef.current?.focus();
  }

  async function saveMessage(event?: FormEvent) {
    event?.preventDefault();
    if (scopeArchived) return;
    const content = draft.trim();
    if (
      !content ||
      content.length > 100_000 ||
      requestRef.current ||
      worker.active
    )
      return;
    const current =
      conversation || createConversation(environmentId, mode, projectId);
    const updated: Conversation = {
      ...current,
      title: current.messages.length
        ? current.title
        : Array.from(content).slice(0, 80).join(""),
      messages: [
        ...current.messages,
        {
          id: crypto.randomUUID(),
          content,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    const saving = commit({
      ...workspace!,
      conversations: conversation
        ? workspace!.conversations.map((item) =>
            item.id === current.id ? updated : item,
          )
        : [updated, ...workspace!.conversations],
    });
    draftsRef.current.delete(
      JSON.stringify([environmentId, projectId, mode, conversationId]),
    );
    followResponseRef.current = true;
    setShowLatest(false);
    setConversationId(updated.id);
    setDraft("");
    const saved = await saving;
    if (saved && updated.mode === "chat") await requestResponse(updated);
    if (
      saved &&
      updated.mode === "worker" &&
      worker.runtime?.ready &&
      project?.path &&
      openai.account?.eligible &&
      openai.model
    )
      await executeWorker(updated);
  }

  function handoff() {
    if (!conversation?.messages.length) return;
    const task = createHandoff(conversation);
    commit({
      ...workspace!,
      conversations: [task, ...workspace!.conversations],
    });
    changeScope(environmentId, projectId, "worker", task.id);
  }

  function openDialog(value: Dialog) {
    if (scopeArchived && ["memory", "projectPath"].includes(value || ""))
      return;
    setFormName("");
    setFormPath(value === "projectPath" ? project?.path || "" : "");
    setFormColor("green");
    setFormText(
      value === "environmentInstructions"
        ? environment.instructions
        : value === "memory"
          ? project
            ? project.memory
            : environment.instructions
          : "",
    );
    setDialog(value);
  }

  function submitDialog(event: FormEvent) {
    event.preventDefault();
    if (dialog === "projectPath" && project && !worker.active) {
      commit({
        ...workspace!,
        projects: workspace!.projects.map((item) =>
          item.id === project.id ? { ...item, path: formPath.trim() } : item,
        ),
      });
    } else if (dialog === "environment" && formName.trim()) {
      const id = crypto.randomUUID();
      commit({
        ...workspace!,
        environments: [
          ...workspace!.environments,
          { id, name: formName.trim(), color: formColor, instructions: "" },
        ],
      });
      changeScope(id, null);
    } else if (dialog === "project" && formName.trim()) {
      const id = crypto.randomUUID();
      commit({
        ...workspace!,
        projects: [
          ...workspace!.projects,
          {
            id,
            environmentId,
            name: formName.trim(),
            path: formPath.trim(),
            memory: "",
          },
        ],
      });
      changeScope(environmentId, id);
    } else if (dialog === "memory" || dialog === "environmentInstructions") {
      commit(
        project && dialog !== "environmentInstructions"
          ? {
              ...workspace!,
              projects: workspace!.projects.map((item) =>
                item.id === project.id ? { ...item, memory: formText } : item,
              ),
            }
          : {
              ...workspace!,
              environments: workspace!.environments.map((item) =>
                item.id === environmentId
                  ? { ...item, instructions: formText }
                  : item,
              ),
            },
      );
    }
    setDialog(null);
  }

  function targetBusy(target: SidebarTarget) {
    return target.type === "conversation"
      ? busyIds.includes(target.id)
      : workspace!.conversations.some(
          (item) => item.projectId === target.id && busyIds.includes(item.id),
        );
  }
  function handleSidebarAction(target: SidebarTarget, action: SidebarAction) {
    if (targetBusy(target)) return;
    const latest = workspaceRef.current!;
    const item =
      target.type === "project"
        ? latest.projects.find((item) => item.id === target.id)
        : latest.conversations.find((item) => item.id === target.id);
    if (!item || item.environmentId !== environmentId) return;
    if (["rename", "move", "delete"].includes(action)) {
      setManagement({
        target,
        action: action as "rename" | "move" | "delete",
        value:
          action === "rename"
            ? "title" in item
              ? item.title
              : item.name
            : "projectId" in item
              ? item.projectId || ""
              : "",
      });
      return;
    }
    if (action === "pin" || action === "archive") {
      const key = action === "pin" ? "pinned" : "archived";
      void commit(
        target.type === "project"
          ? {
              ...latest,
              projects: latest.projects.map((entry) =>
                entry.id === target.id
                  ? { ...entry, [key]: !entry[key] }
                  : entry,
              ),
            }
          : {
              ...latest,
              conversations: latest.conversations.map((entry) =>
                entry.id === target.id
                  ? { ...entry, [key]: !entry[key] }
                  : entry,
              ),
            },
      );
      return;
    }
    if (target.type === "conversation" && action === "duplicate") {
      const source = latest.conversations.find(
        (item) => item.id === target.id,
      )!;
      if (
        latest.projects.find((item) => item.id === source.projectId)?.archived
      )
        return;
      const copy = duplicateConversation(source);
      void commit({
        ...latest,
        conversations: [copy, ...latest.conversations],
      });
      changeScope(environmentId, copy.projectId, copy.mode, copy.id);
      return;
    }
    if (target.type === "project") {
      const targetProject = latest.projects.find(
        (item) => item.id === target.id,
      )!;
      if (targetProject.archived) return;
      if (action === "newChat" || action === "newTask") {
        const copy = createConversation(
          environmentId,
          action === "newChat" ? "chat" : "worker",
          target.id,
        );
        void commit({
          ...latest,
          conversations: [copy, ...latest.conversations],
        });
        changeScope(environmentId, target.id, copy.mode, copy.id);
      } else {
        changeScope(environmentId, target.id);
        setFormText(targetProject.memory);
        setFormPath(targetProject.path);
        setDialog(action === "memory" ? "memory" : "projectPath");
      }
    }
  }
  function submitManagement() {
    if (!management || targetBusy(management.target)) return;
    const latest = workspaceRef.current!;
    const { target, action, value } = management;
    let next = latest;
    if (action === "delete")
      next =
        target.type === "project"
          ? removeProject(latest, target.id)
          : removeConversation(latest, target.id);
    else if (action === "rename") {
      if (!value.trim()) return;
      next =
        target.type === "project"
          ? {
              ...latest,
              projects: latest.projects.map((item) =>
                item.id === target.id ? { ...item, name: value.trim() } : item,
              ),
            }
          : {
              ...latest,
              conversations: latest.conversations.map((item) =>
                item.id === target.id ? { ...item, title: value.trim() } : item,
              ),
            };
    } else {
      if (
        value &&
        !latest.projects.some(
          (item) =>
            item.id === value &&
            item.environmentId === environmentId &&
            !item.archived,
        )
      )
        return;
      next = {
        ...latest,
        conversations: latest.conversations.map((item) =>
          item.id === target.id ? { ...item, projectId: value || null } : item,
        ),
      };
    }
    void commit(next);
    setManagement(null);
    if (
      action === "delete" &&
      (target.id === conversationId || target.id === projectId)
    )
      changeScope(environmentId, null);
    else if (action === "move" && target.id === conversationId)
      changeScope(environmentId, value || null, mode, conversationId);
  }

  return (
    <div className="app-shell">
      <nav className="environment-rail" aria-label={t("Environments")}>
        <button
          className="brand-mark"
          title="Agent Workbench"
          aria-label={t("About Agent Workbench")}
          onClick={() => openDialog("globalSettings")}
        >
          <InteractiveBrandMark />
        </button>
        <div className="rail-divider" />
        <div className="environment-list">
          {workspace.environments.map((item) => (
            <button
              key={item.id}
              className={`environment-button ${item.color} ${item.id === environmentId ? "active" : ""}`}
              title={item.name}
              aria-label={t("Environment {name}", { name: item.name })}
              aria-pressed={item.id === environmentId}
              onClick={() => changeScope(item.id, null)}
            >
              {item.name.slice(0, 2).toUpperCase()}
            </button>
          ))}
        </div>
        <button
          className="rail-add"
          title={t("Create environment")}
          aria-label={t("Create environment")}
          onClick={() => openDialog("environment")}
        >
          <Plus size={23} />
        </button>
        <div className="rail-bottom">
          <span className="local-indicator" title={t("Local data")} />
          <button
            className="avatar"
            aria-label={t("Global settings")}
            title={t("Global settings")}
            onClick={() => openDialog("globalSettings")}
          >
            <Settings2 size={18} />
          </button>
        </div>
      </nav>

      <aside className="sidebar">
        <button
          className="environment-heading"
          aria-label={t("Settings for {name}", { name: environment.name })}
          onClick={() => openDialog("settings")}
        >
          <span>
            {environment.name}
            <small>{t("YOUR ENVIRONMENT")}</small>
          </span>
          <Settings2 size={16} />
        </button>
        <div className="sidebar-body">
          <WorkspaceSidebar
            workspace={workspace}
            environmentId={environmentId}
            mode={mode}
            projectId={projectId}
            conversationId={conversationId}
            query={query}
            onQuery={setQuery}
            onScope={changeScope}
            onNew={newConversation}
            onProject={() => openDialog("project")}
            onAction={handleSidebarAction}
            busyIds={busyIds}
          />
        </div>
        <button
          className="sidebar-footer"
          aria-label={t("Workspace settings")}
          title={t("Workspace settings")}
          onClick={() => openDialog("settings")}
        >
          <div className="provider-icon">
            <Bot size={18} />
          </div>
          <span>
            OpenAI
            <small>
              {openai.account?.connected
                ? t(openai.account.email)
                : t("Account not connected")}
            </small>
          </span>
          <Settings2 size={16} />
        </button>
      </aside>

      <main className="main-area">
        <header className="topbar" data-tauri-drag-region="deep">
          <div className="breadcrumb">
            <span>{environment.name}</span>
            <ChevronRight size={14} />
            <span>{project?.name || t("General")}</span>
            <ChevronRight size={14} />
            <strong>{mode === "chat" ? t("Chat") : t("Worker")}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button theme-toggle"
              aria-label={
                appearance.theme === "dark"
                  ? t("Switch to light theme")
                  : t("Switch to dark theme")
              }
              title={
                appearance.theme === "dark"
                  ? t("Switch to light theme")
                  : t("Switch to dark theme")
              }
              onClick={() =>
                appearance.selectTheme(
                  appearance.theme === "dark" ? "light" : "dark",
                )
              }
            >
              {appearance.theme === "dark" ? (
                <Sun size={17} />
              ) : (
                <Moon size={17} />
              )}
            </button>
            <span className="local-badge">
              <span />
              {t("Local")}
            </span>
            <button
              className="icon-button"
              title={rightPanel ? t("Hide tools") : t("Show tools")}
              aria-label={t("Toggle tools panel")}
              onClick={() => setRightPanel(!rightPanel)}
            >
              {rightPanel ? (
                <PanelRightClose size={18} />
              ) : (
                <PanelRightOpen size={18} />
              )}
            </button>
            <WindowControls onError={setError} />
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{localizeMessage(error)}</span>
            <div>
              {saveStatus === "Unsaved changes" && (
                <button onClick={() => commit(workspace)}>
                  {t("Try saving again")}
                </button>
              )}
              <button
                className="icon-button"
                aria-label={t("Dismiss notice")}
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}
        {!isTauri() && (
          <div className="preview-banner">
            {t("Interface preview. Data in this window is not saved.")}
          </div>
        )}
        <div className="main-content">
          <div className="conversation-area">
            <div
              className="message-scroll"
              ref={scrollRef}
              onScroll={() => {
                const viewport = scrollRef.current;
                if (viewport) {
                  const nearBottom =
                    viewport.scrollHeight -
                      viewport.scrollTop -
                      viewport.clientHeight <
                    90;
                  followResponseRef.current = nearBottom;
                  setShowLatest(!nearBottom);
                }
              }}
            >
              {!conversation?.messages.length ? (
                <div className="welcome">
                  <div className="welcome-symbol">
                    <BrandMark />
                  </div>
                  <div className="eyebrow">
                    AGENT WORKBENCH <span>/</span>{" "}
                    {mode === "chat" ? "CHAT" : "WORKER"}
                  </div>
                  <h1>
                    {mode === "chat"
                      ? t("An idea starts here.")
                      : t("From ideas to the next commit.")}
                  </h1>
                  <p>
                    {mode === "chat"
                      ? t(
                          "Think out loud, explore possibilities and plan what comes next.",
                        )
                      : t(
                          "Prepare a task, gather context and define what you want to build.",
                        )}
                  </p>
                  <div className="suggestions">
                    {(mode === "chat"
                      ? [
                          {
                            icon: Sparkles,
                            title: t("Explore an idea"),
                            text: t("Turn an idea into a plan"),
                            prompt: t("I want to explore an idea: "),
                          },
                          {
                            icon: Layers3,
                            title: t("Think about architecture"),
                            text: t("Organize the parts of a project"),
                            prompt: t("I want to plan the architecture of "),
                          },
                          {
                            icon: StickyNote,
                            title: t("Organize context"),
                            text: t("Record decisions for later"),
                            prompt: t("Decisions and context to save:\n"),
                          },
                        ]
                      : [
                          {
                            icon: Code2,
                            title: t("Prepare a feature"),
                            text: t("Define the goal and acceptance criteria"),
                            prompt: t(
                              "Feature to implement:\n\nGoal:\n\nAcceptance criteria:\n",
                            ),
                          },
                          {
                            icon: Search,
                            title: t("Investigate a problem"),
                            text: t("Record symptoms and expected results"),
                            prompt: t(
                              "Problem to investigate:\n\nCurrent behavior:\n\nExpected result:\n",
                            ),
                          },
                          {
                            icon: ShieldCheck,
                            title: t("Plan verification"),
                            text: t("Define how to validate changes"),
                            prompt: t(
                              "Verification plan:\n\nBehaviors to test:\n",
                            ),
                          },
                        ]
                    ).map((item) => (
                      <button
                        key={item.title}
                        onClick={() => {
                          setDraft(item.prompt);
                          composerRef.current?.focus();
                        }}
                      >
                        <item.icon size={20} />
                        <strong>{item.title}</strong>
                        <span>{item.text}</span>
                        <ArrowRight className="suggestion-arrow" size={16} />
                      </button>
                    ))}
                  </div>
                  <div className="welcome-footnote">
                    <LockKeyhole size={13} />
                    {t("{name} has its own history and memory.", {
                      name: environment.name,
                    })}
                  </div>
                </div>
              ) : (
                <div className="messages">
                  <div className="conversation-title">
                    <span>
                      {mode === "chat" ? t("CONVERSATION") : t("TASK")}
                    </span>
                    <h1>{conversation.title}</h1>
                    {conversation.sourceId && (
                      <p>
                        {t(
                          "Context copied from a Chat in this environment. The original conversation was preserved.",
                        )}
                      </p>
                    )}
                  </div>
                  {conversation.messages.map((message) => (
                    <Fragment key={message.id}>
                      <article
                        data-status={message.status || "completed"}
                        className={`message ${message.role === "assistant" ? "assistant-message" : "user-message"}`}
                      >
                        <div className="message-avatar">
                          {message.role === "assistant" ? (
                            <BrandMark />
                          ) : (
                            t("YOU")
                          )}
                        </div>
                        <div>
                          <div className="message-meta">
                            <strong>
                              {message.role === "assistant"
                                ? "OpenAI"
                                : t("You")}
                            </strong>
                            <time>
                              {new Date(message.createdAt).toLocaleTimeString(
                                dateLocale(),
                                { hour: "2-digit", minute: "2-digit" },
                              )}
                            </time>
                            <span>
                              {message.status === "interrupted"
                                ? t("Response interrupted")
                                : message.status === "failed"
                                  ? t("Incomplete response")
                                  : t("Saved locally")}
                            </span>
                          </div>
                          {message.role === "assistant" ? (
                            <>
                              {(!message.workerRunId ||
                                !worker.history.some(
                                  (run) => run.id === message.workerRunId,
                                )) &&
                                (message.durationMs != null ||
                                  message.summary) && (
                                  <ActivityIndicator
                                    startedAt={0}
                                    active={false}
                                    durationMs={message.durationMs}
                                    summary={message.summary}
                                  />
                                )}
                              <MessageContent content={message.content} />
                            </>
                          ) : (
                            <p>{message.content}</p>
                          )}
                        </div>
                      </article>
                      {mode === "worker" &&
                        worker.history
                          .filter(
                            (run) =>
                              run.userMessageId === message.id &&
                              run.id !== worker.active?.id,
                          )
                          .map((run) => (
                            <RunActivity
                              key={run.id}
                              run={run}
                              active={false}
                              worker={worker}
                            />
                          ))}
                      {mode === "worker" &&
                        worker.active?.conversationId === conversation.id &&
                        worker.active.userMessageId === message.id && (
                          <RunActivity
                            run={worker.active}
                            active
                            worker={worker}
                          />
                        )}
                    </Fragment>
                  ))}
                  {activeRequest?.conversationId === conversation.id && (
                    <article
                      className="message assistant-message"
                      aria-live="polite"
                    >
                      <div className="message-avatar">
                        <BrandMark />
                      </div>
                      <div>
                        <div className="message-meta">
                          <strong>OpenAI</strong>
                          <span>{t("Responding...")}</span>
                        </div>
                        <ActivityIndicator
                          active
                          startedAt={activeRequest.startedAt}
                          summary={activeRequest.summary}
                        />
                        <MessageContent
                          content={
                            activeRequest.text || t("Preparing the response...")
                          }
                        />
                      </div>
                    </article>
                  )}
                  {!openai.account?.connected && (
                    <div className="pending-note">
                      <Cpu size={17} />
                      <span>
                        {t(
                          "Message saved. Connect this environment's account to receive responses.",
                        )}
                      </span>
                    </div>
                  )}
                  {mode === "chat" &&
                    !scopeArchived &&
                    openai.account?.eligible &&
                    openai.model &&
                    !activeRequest && (
                      <button
                        className="text-button"
                        onClick={() => requestResponse(conversation)}
                      >
                        {t("Request a response from OpenAI")}
                        <ArrowRight size={14} />
                      </button>
                    )}
                  {mode === "worker" && !scopeArchived && (
                    <>
                      {!project && (
                        <label className="field worker-assign">
                          {t("Task project")}
                          <select
                            aria-label={t("Task project")}
                            value=""
                            disabled={!!worker.active}
                            onChange={async (event) => {
                              const id = event.target.value;
                              if (!id) return;
                              const latest = workspaceRef.current!;
                              if (
                                await commit({
                                  ...latest,
                                  conversations: latest.conversations.map(
                                    (item) =>
                                      item.id === conversation.id
                                        ? { ...item, projectId: id }
                                        : item,
                                  ),
                                })
                              )
                                changeScope(
                                  environmentId,
                                  id,
                                  "worker",
                                  conversation.id,
                                );
                            }}
                          >
                            <option value="">{t("Select project")}</option>
                            {projects.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <WorkerPanel
                        worker={worker}
                        conversationId={conversation.id}
                        inlineOnly
                        projectPath={project?.path}
                        onEditPath={
                          project ? () => openDialog("projectPath") : undefined
                        }
                      />
                      <button
                        className="primary-button worker-execute"
                        disabled={
                          !isTauri() ||
                          !!worker.active ||
                          !!activeRequest ||
                          !worker.runtime?.ready ||
                          !project?.path ||
                          !openai.account?.eligible ||
                          !openai.model
                        }
                        onClick={() => executeWorker(conversation)}
                      >
                        <Cpu size={15} />
                        {t("Run task")}
                      </button>
                    </>
                  )}
                  {mode === "chat" && (
                    <button
                      className="handoff-button"
                      disabled={!!activeRequest || scopeArchived}
                      onClick={handoff}
                    >
                      <Code2 size={16} />
                      {t("Create a task from this conversation")}
                      <ArrowRight size={15} />
                    </button>
                  )}
                  {mode === "worker" &&
                    worker.history
                      .filter((run) => !run.userMessageId)
                      .map((run) => (
                        <RunActivity
                          key={run.id}
                          run={run}
                          active={false}
                          worker={worker}
                        />
                      ))}
                  <div ref={endRef} />
                </div>
              )}
            </div>
            {showLatest && (
              <div className="latest-wrapper">
                <button
                  onClick={() => {
                    followResponseRef.current = true;
                    setShowLatest(false);
                    endRef.current?.scrollIntoView({ behavior: "auto" });
                  }}
                >
                  {t("Go to the latest message")}
                  <ArrowRight size={13} />
                </button>
              </div>
            )}
            <div className="composer-container">
              {scopeArchived && (
                <div className="archived-notice" role="status">
                  <span>
                    {t(
                      "This conversation is archived. Restore it to continue.",
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleSidebarAction(
                        project?.archived
                          ? { type: "project", id: project.id }
                          : { type: "conversation", id: conversation!.id },
                        "archive",
                      )
                    }
                  >
                    {t("Restore")}
                  </button>
                </div>
              )}
              {activeRequest &&
                activeRequest.conversationId !== conversationId && (
                  <div className="running-notice">
                    <span>
                      {t("A response is in progress in {name}.", {
                        name:
                          workspace.environments.find(
                            (item) => item.id === activeRequest.environmentId,
                          )?.name || "",
                      })}
                    </span>
                    <button
                      onClick={() => {
                        const target = workspace.conversations.find(
                          (item) => item.id === activeRequest.conversationId,
                        );
                        if (target) {
                          changeScope(
                            target.environmentId,
                            target.projectId,
                            "chat",
                            target.id,
                          );
                        }
                      }}
                    >
                      {t("View conversation")}
                      <ArrowRight size={13} />
                    </button>
                  </div>
                )}
              {mode === "worker" && !conversation?.messages.length && (
                <WorkerPanel
                  worker={worker}
                  conversationId={null}
                  projectPath={project?.path}
                  onEditPath={
                    project ? () => openDialog("projectPath") : undefined
                  }
                />
              )}
              {worker.active &&
                worker.active.conversationId !== conversationId && (
                  <div className="running-notice">
                    <span>
                      {t(
                        worker.active.status === "awaitingApproval"
                          ? "A Codex task is waiting for your approval."
                          : "A Codex task is running.",
                      )}
                    </span>
                    <button
                      onClick={() => {
                        const target = workspace.conversations.find(
                          (item) => item.id === worker.active?.conversationId,
                        );
                        if (target)
                          changeScope(
                            target.environmentId,
                            target.projectId,
                            "worker",
                            target.id,
                          );
                      }}
                    >
                      {t("View task")}
                      <ArrowRight size={13} />
                    </button>
                  </div>
                )}
              <div
                className={`connection-notice ${openai.account?.eligible ? "connected" : ""}`}
              >
                <span className="notice-dot" />
                <span>
                  {openai.account?.connected
                    ? t(openai.account.email)
                    : t("Account not connected")}
                </span>
                <span className="notice-divider">·</span>
                <span>
                  {mode === "worker"
                    ? worker.runtime?.ready
                      ? t("Codex isolated by project")
                      : t("Set up Worker in settings")
                    : openai.account?.eligible
                      ? t("Chat with your subscription")
                      : t("Connect your ChatGPT subscription")}
                </span>
                <button onClick={() => openDialog("settings")}>
                  {openai.account?.connected
                    ? t("Manage account")
                    : t("Connect account")}
                  <ArrowRight size={12} />
                </button>
              </div>
              {openai.issue && (
                <p className="account-issue" role="status">
                  {localizeMessage(openai.issue)}
                </p>
              )}
              <form className="composer" onSubmit={saveMessage}>
                <textarea
                  ref={composerRef}
                  disabled={scopeArchived}
                  aria-label={
                    mode === "chat" ? t("Message") : t("Task description")
                  }
                  maxLength={100_000}
                  placeholder={
                    mode === "chat"
                      ? openai.account?.eligible
                        ? t("What shall we create today?")
                        : t("Write an idea or save context for later...")
                      : t("Describe what you want to build...")
                  }
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      saveMessage();
                    }
                  }}
                />
                <div className="composer-toolbar">
                  <button
                    type="button"
                    className="context-button"
                    onClick={() => openDialog("memory")}
                  >
                    <Plus size={16} />
                    <span>{t("Context")}</span>
                  </button>
                  <div className="composer-controls">
                    {mode === "worker" && (
                      <label
                        className="approval-mode-picker"
                        title={t(
                          approvalMode === "auto"
                            ? "Automatically review low-risk actions. Ask before potentially unsafe actions."
                            : "Ask before commands and file changes that require approval.",
                        )}
                      >
                        <ShieldCheck size={14} />
                        <select
                          aria-label={t("Approval mode")}
                          value={approvalMode}
                          disabled={!!worker.active || scopeArchived}
                          onChange={(event) => {
                            const value =
                              event.target.value === "auto" ? "auto" : "ask";
                            setApprovalMode(value);
                            saveApprovalMode(value);
                          }}
                        >
                          <option value="ask">{t("Ask for approval")}</option>
                          <option value="auto">{t("Approve for me")}</option>
                        </select>
                      </label>
                    )}
                    {openai.account?.eligible ? (
                      <select
                        className="model-picker"
                        aria-label={t("Model")}
                        disabled={
                          openai.loadingModels ||
                          !!activeRequest ||
                          !!worker.active
                        }
                        value={openai.model}
                        onChange={(event) =>
                          openai.selectModel(event.target.value)
                        }
                      >
                        <option value="" disabled>
                          {openai.loadingModels
                            ? t("Loading models...")
                            : t("Select model")}
                        </option>
                        {openai.models.map((model) => (
                          <option key={model.slug} value={model.slug}>
                            {model.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <button
                        type="button"
                        className="agent-placeholder"
                        onClick={() =>
                          openDialog(
                            mode === "worker" ? "globalSettings" : "settings",
                          )
                        }
                      >
                        <Bot size={14} />
                        {mode === "chat"
                          ? t("Connect OpenAI")
                          : t("Set up Worker")}
                      </button>
                    )}
                    {worker.active ? (
                      <button
                        type="button"
                        className="stop-button"
                        onClick={worker.cancel}
                      >
                        {t("Stop task")}
                      </button>
                    ) : activeRequest ? (
                      <button
                        type="button"
                        className="stop-button"
                        onClick={cancelResponse}
                      >
                        {t("Stop")}
                      </button>
                    ) : (
                      <button
                        className="send-button"
                        type="submit"
                        disabled={!draft.trim() || scopeArchived}
                        title={
                          mode === "chat" &&
                          openai.account?.eligible &&
                          openai.model
                            ? t("Send message")
                            : t("Save message locally")
                        }
                        aria-label={
                          mode === "chat" &&
                          openai.account?.eligible &&
                          openai.model
                            ? t("Send message")
                            : t("Save message locally")
                        }
                      >
                        <ArrowUp size={19} />
                      </button>
                    )}
                  </div>
                </div>
              </form>
              <div className="composer-footnote">
                <span>
                  <ShieldCheck size={12} />
                  {t(saveStatus)}
                </span>
                <span>{t("Enter to send · Shift + Enter for a new line")}</span>
              </div>
            </div>
          </div>

          {rightPanel && (
            <ToolPanel
              environmentId={environmentId}
              projectId={projectId}
              conversationId={conversationId}
              projectName={project?.name}
              runs={
                worker.active
                  ? [
                      worker.active,
                      ...worker.history.filter(
                        (run) => run.id !== worker.active?.id,
                      ),
                    ]
                  : worker.history
              }
              suspended={!!dialog || !!management || scopeArchived}
              onCreateConversation={newConversation}
              onClose={() => setRightPanel(false)}
            >
              <div className="context-heading">
                <span>{t("Context")}</span>
                <span className="section-chip">
                  {mode === "chat" ? "CHAT" : "WORKER"}
                </span>
              </div>
              <div className="context-section">
                <div className="context-label">
                  <Layers3 size={14} />
                  {t("ENVIRONMENT")}
                </div>
                <div className="environment-card">
                  <div className={`context-env-icon ${environment.color}`}>
                    {environment.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <strong>{environment.name}</strong>
                    <span>{t("Separate history")}</span>
                  </div>
                  <LockKeyhole size={14} />
                </div>
              </div>
              <div className="context-section">
                <div className="context-label">
                  <StickyNote size={14} />
                  {project
                    ? t("PROJECT MEMORY")
                    : t("ENVIRONMENT INSTRUCTIONS")}
                  <button
                    title={t("Edit context")}
                    aria-label={t("Edit context")}
                    onClick={() => openDialog("memory")}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <p className="memory-preview">
                  {(project ? project.memory : environment.instructions) ||
                    t(
                      "Add preferences and decisions to keep in this workspace.",
                    )}
                </p>
                <button
                  className="text-button"
                  onClick={() => openDialog("memory")}
                >
                  {(project ? project.memory : environment.instructions)
                    ? t("Edit context")
                    : t("Add context")}
                  <ArrowRight size={13} />
                </button>
              </div>
              {project && (
                <div className="context-section">
                  <div className="context-label">
                    <Folder size={14} />
                    {t("PROJECT")}
                  </div>
                  <strong className="project-detail">{project.name}</strong>
                  <p className="path-detail">
                    {project.path || t("No folder linked")}
                  </p>
                  <span className="subtle">
                    {mode === "worker"
                      ? t("Only this folder is available during execution.")
                      : t("Chat cannot access local files.")}
                  </span>
                </div>
              )}
              <div className="context-section">
                <div className="context-label">
                  <Cpu size={14} />
                  {t("THIS ENVIRONMENT'S ACCOUNT")}
                </div>
                <button
                  className="provider-card"
                  onClick={() => openDialog("settings")}
                  aria-label={t("Manage this environment's account")}
                >
                  <Bot size={20} />
                  <div>
                    <strong>OpenAI</strong>
                    <span>
                      {openai.account?.connected
                        ? t(openai.account.email)
                        : t("No account connected")}
                    </span>
                  </div>
                  <span className="pending-chip">
                    {openai.account?.eligible
                      ? t("Connected")
                      : openai.account?.connected
                        ? t("Authorize")
                        : t("Connect")}
                  </span>
                </button>
                <p className="subtle">
                  {lastUsage?.environmentId === environmentId
                    ? t(
                        "Last response: {input} input tokens and {output} output tokens.",
                        { input: lastUsage.input, output: lastUsage.output },
                      )
                    : t("The account is linked only to this environment.")}
                </p>
              </div>
              <div className="context-bottom">
                <ShieldCheck size={18} />
                <strong>{t("Context stays in its place.")}</strong>
                <p>
                  {t(
                    "Chat and Worker have separate histories. Sharing context is always your choice.",
                  )}
                </p>
                <button onClick={() => openDialog("globalSettings")}>
                  <CircleHelp size={13} />
                  {t("About this version")}
                </button>
              </div>
            </ToolPanel>
          )}
        </div>
      </main>

      {dialog && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialog(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setDialog(null);
          }}
        >
          <section
            className={`modal ${["settings", "globalSettings"].includes(dialog) ? "settings-modal" : ""}`}
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <button
              className="modal-close icon-button"
              aria-label={t("Close")}
              onClick={() => setDialog(null)}
            >
              <X size={19} />
            </button>
            {["settings", "globalSettings"].includes(dialog) ? (
              <BrandWordmark
                className="settings-wordmark"
                theme={appearance.theme}
              />
            ) : (
              <div className="modal-symbol">
                {dialog === "environment" ? (
                  <Layers3 />
                ) : dialog === "project" ? (
                  <FolderPlus />
                ) : dialog === "memory" ? (
                  <StickyNote />
                ) : (
                  <Settings2 />
                )}
              </div>
            )}
            <h2 id="dialog-title">
              {dialog === "environment"
                ? t("A new environment")
                : dialog === "project"
                  ? t("Add project")
                  : dialog === "projectPath"
                    ? t("Project folder")
                    : dialog === "memory" ||
                        dialog === "environmentInstructions"
                      ? project && dialog === "memory"
                        ? t("Project memory")
                        : t("Environment instructions")
                      : t(
                          dialog === "globalSettings"
                            ? "Global settings"
                            : "Workspace settings",
                        )}
            </h2>
            {dialog === "globalSettings" ? (
              <>
                <p className="modal-description">
                  {t(
                    "Preferences for the entire app, shared by all workspaces.",
                  )}
                </p>
                <LanguageSwitcher />
                <ThemeSwitcher
                  value={appearance.preference}
                  onChange={appearance.selectTheme}
                />
                <GlobalInstructionsSettings />
                <TerminalSettings />
                <DesktopIntegration />
                <WorkerSetup worker={worker} />
                {worker.issue && (
                  <p className="account-issue" role="alert">
                    {localizeMessage(worker.issue)}
                  </p>
                )}
                <details className="settings-details">
                  <summary>{t("Privacy and about this version")}</summary>
                  <p>
                    {t(
                      "Credentials are protected on your computer. History is local and separated by environment and mode. Chat receives the current conversation and the context saved in this workspace.",
                    )}
                  </p>
                  <p>
                    {t(
                      "Agent Workbench {version} · Chat and Codex Worker with local history. Worker modifies files directly in the selected folder. Stopping a task does not undo changes already made.",
                      { version: appVersion },
                    )}
                  </p>
                </details>
                <button
                  className="primary-button full-width"
                  onClick={() => setDialog(null)}
                >
                  {t("Done")}
                </button>
              </>
            ) : dialog === "settings" ? (
              <>
                <p className="modal-description">
                  <span className={`settings-environment ${environment.color}`}>
                    {environment.name}
                  </span>{" "}
                  {t("Other environments keep their own accounts.")}
                </p>
                <div
                  className={`settings-account-card ${openai.account?.eligible ? "connected" : ""}`}
                >
                  <div className="provider-icon">
                    <Bot size={20} />
                  </div>
                  <div>
                    <strong>
                      {openai.account?.connected
                        ? t(openai.account.email)
                        : t("Connect your ChatGPT subscription")}
                    </strong>
                    <p>
                      {openai.account?.eligible
                        ? t(
                            "Account connected. Available models appear in the Chat selector.",
                          )
                        : t(
                            "Connect your account in the browser to use your subscription, if eligible. Official conversations stay in ChatGPT.",
                          )}
                    </p>
                  </div>
                </div>
                {openai.issue && (
                  <p className="account-issue" role="status">
                    {localizeMessage(openai.issue)}
                  </p>
                )}
                <div className="account-actions">
                  {openai.loginEnvironment ? (
                    <>
                      <p>{t("Wait for login to finish in the browser.")}</p>
                      <button
                        className="secondary-button"
                        onClick={openai.cancelLogin}
                      >
                        {t("Cancel login")}
                      </button>
                    </>
                  ) : (
                    <button className="primary-button" onClick={openai.login}>
                      {openai.account?.connected
                        ? t("Renew authorization")
                        : t("Continue with ChatGPT")}
                    </button>
                  )}
                  {openai.account?.connected && (
                    <>
                      <button
                        className="secondary-button"
                        disabled={openai.disconnecting}
                        onClick={openai.logout}
                      >
                        {openai.disconnecting
                          ? t("Disconnecting...")
                          : t("Disconnect account")}
                      </button>
                      <button
                        className="text-button"
                        onClick={openai.reloadModels}
                      >
                        {t("Refresh models")}
                      </button>
                    </>
                  )}
                </div>
                {openai.account?.connected && !openai.account.eligible && (
                  <p className="account-issue">
                    {t(
                      "The account signed in but did not grant permission to use the subscription. Renew authorization and check account and workspace eligibility.",
                    )}
                  </p>
                )}
                <div className="settings-privacy">
                  <ShieldCheck size={17} />
                  <p>
                    {t(
                      openai.account?.connected
                        ? "The account is connected only to {name}. To use another account, choose another environment."
                        : "When you connect an account, it is linked only to {name}. To use another account, choose another environment.",
                      { name: environment.name },
                    )}
                  </p>
                </div>
                <div className="settings-workspace-instructions">
                  <h3>{t("Environment instructions")}</h3>
                  <p className="memory-preview">
                    {environment.instructions ||
                      t(
                        "Add preferences and decisions to keep in this workspace.",
                      )}
                  </p>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => openDialog("environmentInstructions")}
                  >
                    {t("Edit workspace instructions")}
                  </button>
                </div>
                <section className="settings-workspace-project">
                  <TerminalSettings environmentId={environmentId} />
                  <h3>{t("Project settings")}</h3>
                  {project ? (
                    <>
                      <strong>{project.name}</strong>
                      <p className="subtle">{t("Project folder")}</p>
                      <code className="settings-project-path">
                        {project.path || t("No folder linked")}
                      </code>
                      <button
                        type="button"
                        className="text-button"
                        disabled={!!worker.active || !!project.archived}
                        onClick={() => openDialog("projectPath")}
                      >
                        {t("Set folder")}
                      </button>
                      <h4>{t("Project memory")}</h4>
                      <p className="memory-preview">
                        {project.memory ||
                          t(
                            "Add preferences and decisions to keep in this workspace.",
                          )}
                      </p>
                      <button
                        type="button"
                        className="text-button"
                        disabled={!!project.archived}
                        onClick={() => openDialog("memory")}
                      >
                        {t("Edit project memory")}
                      </button>
                      <p className="subtle">
                        {t(
                          "Project memory and the selected workspace instructions are combined with global instructions for Chat and Worker.",
                        )}
                      </p>
                    </>
                  ) : (
                    <p className="subtle">
                      {t("Select a project to manage its folder and memory.")}
                    </p>
                  )}
                </section>
                <button
                  className="primary-button full-width"
                  onClick={() => setDialog(null)}
                >
                  {t("Done")}
                </button>
              </>
            ) : (
              <form onSubmit={submitDialog}>
                <p className="modal-description">
                  {dialog === "environment"
                    ? t(
                        "Keep projects, conversations and instructions in their own workspace.",
                      )
                    : dialog === "projectPath"
                      ? t(
                          "This is the only folder on your computer available to tasks in this project.",
                        )
                      : dialog === "project"
                        ? t("This project will belong to {name}.", {
                            name: environment.name,
                          })
                        : t(
                            "Save only information appropriate for this workspace. Do not include credentials or secrets.",
                          )}
                </p>
                {(dialog === "environment" || dialog === "project") && (
                  <label className="field">
                    {t("Name")}
                    <input
                      autoFocus
                      required
                      maxLength={80}
                      value={formName}
                      placeholder={
                        dialog === "environment"
                          ? t("e.g. Nexlo Games")
                          : t("e.g. Agent Workbench")
                      }
                      onChange={(event) => setFormName(event.target.value)}
                    />
                  </label>
                )}
                {dialog === "environment" && (
                  <div className="field">
                    {t("Color")}
                    <div className="color-picker">
                      {(["violet", "blue", "green", "orange"] as Color[]).map(
                        (color) => (
                          <button
                            key={color}
                            type="button"
                            aria-label={t(
                              {
                                violet: "Violet",
                                blue: "Blue",
                                green: "Green",
                                orange: "Orange",
                              }[color],
                            )}
                            aria-pressed={formColor === color}
                            className={`color-option ${color}`}
                            onClick={() => setFormColor(color)}
                          >
                            {formColor === color && <Check size={17} />}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                )}
                {(dialog === "project" || dialog === "projectPath") && (
                  <label className="field">
                    {t("Project folder")}
                    <span>{t("(required to run Worker)")}</span>
                    <input
                      maxLength={4096}
                      value={formPath}
                      placeholder={t("/home/user/Projects/my-project")}
                      onChange={(event) => setFormPath(event.target.value)}
                    />
                    <small>
                      {t(
                        "When running a task, Codex can read and modify files in this folder. Select only the project you want to make available.",
                      )}
                    </small>
                  </label>
                )}
                {(dialog === "memory" ||
                  dialog === "environmentInstructions") && (
                  <label className="field">
                    {project && dialog !== "environmentInstructions"
                      ? project.name
                      : environment.name}
                    <textarea
                      autoFocus
                      rows={10}
                      maxLength={100_000}
                      value={formText}
                      onChange={(event) => setFormText(event.target.value)}
                      placeholder={t(
                        "Preferences, decisions and important context...",
                      )}
                    />
                    <small>
                      {t(
                        "This context is sent with Chat and Worker requests in this environment or project.",
                      )}
                    </small>
                  </label>
                )}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setDialog(null)}
                  >
                    {t("Cancel")}
                  </button>
                  <button className="primary-button" type="submit">
                    {dialog === "memory" || dialog === "environmentInstructions"
                      ? t("Save context")
                      : dialog === "projectPath"
                        ? t("Save folder")
                        : t("Create")}
                    <ArrowRight size={15} />
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
      {management && (
        <ManagementDialog
          title={t(
            management.action === "delete"
              ? "Delete {name}?"
              : management.action === "rename"
                ? "Rename {name}"
                : "Move {name}",
            {
              name:
                management.target.type === "project"
                  ? workspace.projects.find(
                      (item) => item.id === management.target.id,
                    )?.name || ""
                  : workspace.conversations.find(
                      (item) => item.id === management.target.id,
                    )?.title || "",
            },
          )}
          description={t(
            management.action === "delete"
              ? management.target.type === "project"
                ? "The project will be removed. Its conversations and tasks will move to General. Local files will not be deleted."
                : "This permanently removes the conversation, its messages and task history. This cannot be undone."
              : management.action === "move"
                ? "Choose a project in this environment, or keep the conversation in General."
                : "Choose a name that is easy to find.",
          )}
          value={management.value}
          options={
            management.action === "move"
              ? [
                  { value: "", label: t("General") },
                  ...projects.map((item) => ({
                    value: item.id,
                    label: item.name,
                  })),
                ]
              : undefined
          }
          maxLength={management.target.type === "project" ? 80 : 100}
          danger={management.action === "delete"}
          onChange={(value) => setManagement({ ...management, value })}
          onSubmit={submitManagement}
          onClose={() => setManagement(null)}
        />
      )}
    </div>
  );
}
