import { version as appVersion } from "../package.json";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
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
  Hash,
  Layers3,
  LockKeyhole,
  MessageSquare,
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
import { useWorker } from "./worker";
import { WorkerPanel, WorkerSetup } from "./components/WorkerPanel";
import { BrandMark, BrandWordmark } from "./components/Brand";
import { MessageContent } from "./components/MessageContent";
import {
  createConversation,
  createHandoff,
  visibleConversations,
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
  | "settings"
  | null;
const previewWorkspace: Workspace = {
  version: 1,
  environments: [
    { id: "personal", name: "Pessoal", color: "violet", instructions: "" },
    { id: "work", name: "Trabalho", color: "blue", instructions: "" },
  ],
  projects: [],
  conversations: [],
};

export default function App() {
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
  const [saveStatus, setSaveStatus] = useState("Guardado neste dispositivo");
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
        if (alive)
          setError(
            "Não foi possível abrir os dados locais. Reinicia a aplicação.",
          );
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
    setSaveStatus("A guardar...");
    setError("");
    const save = saveQueue.current
      .then(async () => {
        if (isTauri()) await invoke("save_workspace", { workspace: next });
        savedWorkspaceRef.current = next;
        setSaveStatus(
          isTauri()
            ? "Guardado neste dispositivo"
            : "Pré-visualização no navegador",
        );
        return true;
      })
      .catch(() => {
        setError(
          "Não foi possível guardar. Mantém a aplicação aberta e tenta novamente.",
        );
        setSaveStatus("Alterações por guardar");
        return false;
      });
    saveQueue.current = save.then(() => undefined);
    return save;
  }

  async function requestResponse(target: Conversation) {
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
    });
    let text = "";
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
        throw new Error(
          "Guarda as alterações locais antes de enviar o contexto à OpenAI.",
        );
      await invoke("openai_chat", {
        environmentId: target.environmentId,
        conversationId: target.id,
        model: openai.model,
        requestId: id,
        onEvent: channel,
      });
      if (!text && outcome.status === "completed")
        responseError = "A OpenAI concluiu o pedido sem devolver texto.";
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
    if (
      worker.active ||
      requestRef.current ||
      !openai.account?.eligible ||
      !openai.model
    )
      return;
    await saveQueue.current;
    if (workspaceRef.current !== savedWorkspaceRef.current) {
      setError("Guarda as alterações antes de executar a tarefa.");
      return;
    }
    const result = await worker.start(target, openai.model);
    const latest = workspaceRef.current;
    if (result?.output && latest) {
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
                    content: result.output,
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
        <p>{error || "A abrir o teu espaço de trabalho..."}</p>
      </div>
    );

  const environment = workspace.environments.find(
    (item) => item.id === environmentId,
  )!;
  const projects = workspace.projects.filter(
    (item) => item.environmentId === environmentId,
  );
  const project = projects.find((item) => item.id === projectId);
  const conversations = visibleConversations(
    workspace,
    environmentId,
    mode,
    projectId,
  );
  const conversation = conversations.find((item) => item.id === conversationId);
  const filteredConversations = conversations.filter((item) =>
    item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );

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
    setFormName("");
    setFormPath(value === "projectPath" ? project?.path || "" : "");
    setFormColor("green");
    setFormText(
      value === "memory"
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
    } else if (dialog === "memory") {
      commit(
        project
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

  return (
    <div className="app-shell">
      <nav className="environment-rail" aria-label="Ambientes">
        <button
          className="brand-mark"
          title="Agent Workbench"
          aria-label="Sobre o Agent Workbench"
          onClick={() => openDialog("settings")}
        >
          <BrandMark />
        </button>
        <div className="rail-divider" />
        <div className="environment-list">
          {workspace.environments.map((item) => (
            <button
              key={item.id}
              className={`environment-button ${item.color} ${item.id === environmentId ? "active" : ""}`}
              title={item.name}
              aria-label={`Ambiente ${item.name}`}
              aria-pressed={item.id === environmentId}
              onClick={() => changeScope(item.id, null)}
            >
              {item.name.slice(0, 2).toUpperCase()}
            </button>
          ))}
        </div>
        <button
          className="rail-add"
          title="Criar ambiente"
          aria-label="Criar ambiente"
          onClick={() => openDialog("environment")}
        >
          <Plus size={23} />
        </button>
        <div className="rail-bottom">
          <span className="local-indicator" title="Dados locais" />
          <button
            className="avatar"
            aria-label="Definições"
            title="Definições"
            onClick={() => openDialog("settings")}
          >
            <Settings2 size={18} />
          </button>
        </div>
      </nav>

      <aside className="sidebar">
        <button
          className="environment-heading"
          onClick={() => openDialog("settings")}
        >
          <span>
            {environment.name}
            <small>O TEU AMBIENTE</small>
          </span>
          <Settings2 size={16} />
        </button>
        <div className="sidebar-body">
          <button className="new-button" onClick={newConversation}>
            <Plus size={17} />
            {mode === "chat" ? "Nova conversa" : "Nova tarefa"}
            <span aria-hidden="true">+</span>
          </button>
          <div className="mode-tabs" aria-label="Tipo de conversa">
            <button
              className={mode === "chat" ? "selected" : ""}
              aria-pressed={mode === "chat"}
              onClick={() => changeScope(environmentId, projectId, "chat")}
            >
              <MessageSquare size={15} />
              Chat
            </button>
            <button
              className={mode === "worker" ? "selected" : ""}
              aria-pressed={mode === "worker"}
              onClick={() => changeScope(environmentId, projectId, "worker")}
            >
              <Code2 size={16} />
              Worker
            </button>
          </div>
          <label className="search">
            <Search size={15} />
            <input
              aria-label="Pesquisar conversas"
              placeholder="Pesquisar neste espaço"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <span>⌕</span>
          </label>
          <div className="section-label">
            <span>ESPAÇO DE TRABALHO</span>
          </div>
          <button
            className={`project-row ${!projectId ? "selected" : ""}`}
            onClick={() => changeScope(environmentId, null)}
          >
            <Hash size={17} />
            Geral
            <span>
              {workspace.conversations.filter(
                (item) =>
                  item.environmentId === environmentId &&
                  item.mode === mode &&
                  !item.projectId,
              ).length || ""}
            </span>
          </button>
          <div className="section-label project-label">
            <span>PROJETOS</span>
            <button
              title="Criar projeto"
              aria-label="Criar projeto"
              onClick={() => openDialog("project")}
            >
              <Plus size={15} />
            </button>
          </div>
          {projects.map((item) => (
            <button
              key={item.id}
              className={`project-row ${projectId === item.id ? "selected" : ""}`}
              onClick={() => changeScope(environmentId, item.id)}
            >
              <Folder size={16} />
              <span className="project-name">{item.name}</span>
              {projectId === item.id && <span className="small-dot" />}
            </button>
          ))}
          {!projects.length && (
            <button
              className="empty-project"
              onClick={() => openDialog("project")}
            >
              <FolderPlus size={16} />
              <span>Adiciona o primeiro projeto</span>
            </button>
          )}
          <div className="section-label conversations-label">
            <span>{mode === "chat" ? "CONVERSAS" : "TAREFAS"}</span>
            <span>{conversations.length.toString().padStart(2, "0")}</span>
          </div>
          <div className="conversation-list">
            {filteredConversations.map((item) => (
              <button
                key={item.id}
                className={`conversation-row ${conversationId === item.id ? "selected" : ""}`}
                onClick={() => {
                  changeScope(environmentId, projectId, mode, item.id);
                }}
              >
                {mode === "chat" ? (
                  <MessageSquare size={14} />
                ) : (
                  <Code2 size={14} />
                )}
                <span>{item.title}</span>
              </button>
            ))}
            {!filteredConversations.length && (
              <p className="sidebar-empty">
                {query
                  ? "Sem resultados."
                  : mode === "chat"
                    ? "As tuas conversas ficam aqui."
                    : "As tuas tarefas ficam aqui."}
              </p>
            )}
          </div>
        </div>
        <button
          className="sidebar-footer"
          onClick={() => openDialog("settings")}
        >
          <div className="provider-icon">
            <Bot size={18} />
          </div>
          <span>
            OpenAI
            <small>
              {openai.account?.connected
                ? openai.account.email
                : "Conta por ligar"}
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
            <span>{project?.name || "Geral"}</span>
            <ChevronRight size={14} />
            <strong>{mode === "chat" ? "Chat" : "Worker"}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button theme-toggle"
              aria-label={
                appearance.theme === "dark"
                  ? "Ativar tema claro"
                  : "Ativar tema escuro"
              }
              title={
                appearance.theme === "dark"
                  ? "Ativar tema claro"
                  : "Ativar tema escuro"
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
              Local
            </span>
            <button
              className="icon-button"
              title={rightPanel ? "Ocultar contexto" : "Mostrar contexto"}
              aria-label="Alternar painel de contexto"
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
            <span>{error}</span>
            <div>
              {saveStatus === "Alterações por guardar" && (
                <button onClick={() => commit(workspace)}>
                  Tentar guardar novamente
                </button>
              )}
              <button
                className="icon-button"
                aria-label="Fechar aviso"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}
        {!isTauri() && (
          <div className="preview-banner">
            Pré-visualização da interface. Os dados desta janela não são
            guardados.
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
                      ? "Uma ideia começa aqui."
                      : "Das ideias ao próximo commit."}
                  </h1>
                  <p>
                    {mode === "chat"
                      ? "Pensa em voz alta, explora possibilidades e organiza o que vem a seguir."
                      : "Prepara uma tarefa, reúne o contexto e define o que queres construir."}
                  </p>
                  <div className="suggestions">
                    {(mode === "chat"
                      ? [
                          {
                            icon: Sparkles,
                            title: "Explorar uma ideia",
                            text: "Transformar uma ideia num plano",
                            prompt: "Quero explorar uma ideia: ",
                          },
                          {
                            icon: Layers3,
                            title: "Pensar na arquitetura",
                            text: "Organizar as peças de um projeto",
                            prompt: "Quero planear a arquitetura de ",
                          },
                          {
                            icon: StickyNote,
                            title: "Organizar o contexto",
                            text: "Registar decisões para continuar",
                            prompt: "Decisões e contexto que quero guardar:\n",
                          },
                        ]
                      : [
                          {
                            icon: Code2,
                            title: "Preparar uma feature",
                            text: "Definir objetivo e critérios de aceitação",
                            prompt:
                              "Feature a implementar:\n\nObjetivo:\n\nCritérios de aceitação:\n",
                          },
                          {
                            icon: Search,
                            title: "Investigar um problema",
                            text: "Registar sintomas e resultado esperado",
                            prompt:
                              "Problema a investigar:\n\nComportamento atual:\n\nResultado esperado:\n",
                          },
                          {
                            icon: ShieldCheck,
                            title: "Planear a verificação",
                            text: "Definir como validar as alterações",
                            prompt:
                              "Plano de verificação:\n\nComportamentos a testar:\n",
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
                    {environment.name} tem o seu próprio histórico e memória.
                  </div>
                </div>
              ) : (
                <div className="messages">
                  <div className="conversation-title">
                    <span>{mode === "chat" ? "CONVERSA" : "TAREFA"}</span>
                    <h1>{conversation.title}</h1>
                    {conversation.sourceId && (
                      <p>
                        Contexto copiado de um Chat deste ambiente. A conversa
                        original foi preservada.
                      </p>
                    )}
                  </div>
                  {conversation.messages.map((message) => (
                    <article className="message" key={message.id}>
                      <div className="message-avatar">
                        {message.role === "assistant" ? <BrandMark /> : "TU"}
                      </div>
                      <div>
                        <div className="message-meta">
                          <strong>
                            {message.role === "assistant" ? "OpenAI" : "Tu"}
                          </strong>
                          <time>
                            {new Date(message.createdAt).toLocaleTimeString(
                              "pt-PT",
                              { hour: "2-digit", minute: "2-digit" },
                            )}
                          </time>
                          <span>
                            {message.status === "interrupted"
                              ? "Resposta interrompida"
                              : message.status === "failed"
                                ? "Resposta incompleta"
                                : "Guardado localmente"}
                          </span>
                        </div>
                        {message.role === "assistant" ? (
                          <MessageContent content={message.content} />
                        ) : (
                          <p>{message.content}</p>
                        )}
                      </div>
                    </article>
                  ))}
                  {activeRequest?.conversationId === conversation.id && (
                    <article className="message" aria-live="polite">
                      <div className="message-avatar">
                        <BrandMark />
                      </div>
                      <div>
                        <div className="message-meta">
                          <strong>OpenAI</strong>
                          <span>A responder...</span>
                        </div>
                        <MessageContent
                          content={
                            activeRequest.text || "A preparar a resposta..."
                          }
                        />
                      </div>
                    </article>
                  )}
                  {!openai.account?.connected && (
                    <div className="pending-note">
                      <Cpu size={17} />
                      <span>
                        Mensagem guardada. Liga a conta deste ambiente para
                        receber respostas.
                      </span>
                    </div>
                  )}
                  {mode === "chat" &&
                    openai.account?.eligible &&
                    openai.model &&
                    !activeRequest && (
                      <button
                        className="text-button"
                        onClick={() => requestResponse(conversation)}
                      >
                        Pedir resposta à OpenAI
                        <ArrowRight size={14} />
                      </button>
                    )}
                  {mode === "worker" && (
                    <>
                      {!project && (
                        <label className="field worker-assign">
                          Projeto da tarefa
                          <select
                            aria-label="Projeto da tarefa"
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
                            <option value="">Selecionar projeto</option>
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
                        Executar tarefa
                      </button>
                    </>
                  )}
                  {mode === "chat" && (
                    <button
                      className="handoff-button"
                      disabled={!!activeRequest}
                      onClick={handoff}
                    >
                      <Code2 size={16} />
                      Criar tarefa a partir desta conversa
                      <ArrowRight size={15} />
                    </button>
                  )}
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
                  Ir para a última mensagem
                  <ArrowRight size={13} />
                </button>
              </div>
            )}
            <div className="composer-container">
              {activeRequest &&
                activeRequest.conversationId !== conversationId && (
                  <div className="running-notice">
                    <span>
                      Há uma resposta em curso no ambiente{" "}
                      {
                        workspace.environments.find(
                          (item) => item.id === activeRequest.environmentId,
                        )?.name
                      }
                      .
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
                      Ver conversa
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
                      Há uma tarefa Codex em curso
                      {worker.active.status === "awaitingApproval"
                        ? " à espera da tua aprovação"
                        : ""}
                      .
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
                      Ver tarefa
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
                    ? openai.account.email
                    : "Conta por ligar"}
                </span>
                <span className="notice-divider">·</span>
                <span>
                  {mode === "worker"
                    ? worker.runtime?.ready
                      ? "Codex isolado por projeto"
                      : "Prepara o Worker nas definições"
                    : openai.account?.eligible
                      ? "Chat com a tua subscrição"
                      : "Liga a tua subscrição ChatGPT"}
                </span>
                <button onClick={() => openDialog("settings")}>
                  {openai.account?.connected ? "Gerir conta" : "Ligar conta"}
                  <ArrowRight size={12} />
                </button>
              </div>
              {openai.issue && (
                <p className="account-issue" role="status">
                  {openai.issue}
                </p>
              )}
              <form className="composer" onSubmit={saveMessage}>
                <textarea
                  ref={composerRef}
                  aria-label={
                    mode === "chat" ? "Mensagem" : "Descrição da tarefa"
                  }
                  maxLength={100_000}
                  placeholder={
                    mode === "chat"
                      ? openai.account?.eligible
                        ? "O que vamos criar hoje?"
                        : "Escreve uma ideia ou guarda contexto para mais tarde..."
                      : "Descreve o que queres construir..."
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
                    <span>Contexto</span>
                  </button>
                  <div className="composer-controls">
                    {openai.account?.eligible ? (
                      <select
                        className="model-picker"
                        aria-label="Modelo"
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
                            ? "A obter modelos..."
                            : "Selecionar modelo"}
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
                        onClick={() => openDialog("settings")}
                      >
                        <Bot size={14} />
                        {mode === "chat" ? "Ligar OpenAI" : "Configurar Worker"}
                      </button>
                    )}
                    {worker.active ? (
                      <button
                        type="button"
                        className="stop-button"
                        onClick={worker.cancel}
                      >
                        Parar tarefa
                      </button>
                    ) : activeRequest ? (
                      <button
                        type="button"
                        className="stop-button"
                        onClick={cancelResponse}
                      >
                        Parar
                      </button>
                    ) : (
                      <button
                        className="send-button"
                        type="submit"
                        disabled={!draft.trim()}
                        title={
                          mode === "chat" &&
                          openai.account?.eligible &&
                          openai.model
                            ? "Enviar mensagem"
                            : "Guardar mensagem localmente"
                        }
                        aria-label={
                          mode === "chat" &&
                          openai.account?.eligible &&
                          openai.model
                            ? "Enviar mensagem"
                            : "Guardar mensagem localmente"
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
                  {saveStatus}
                </span>
                <span>Enter para enviar · Shift + Enter para nova linha</span>
              </div>
            </div>
          </div>

          {rightPanel && (
            <aside className="context-panel">
              <div className="context-heading">
                <span>Contexto</span>
                <span className="section-chip">
                  {mode === "chat" ? "CHAT" : "WORKER"}
                </span>
              </div>
              <div className="context-section">
                <div className="context-label">
                  <Layers3 size={14} />
                  AMBIENTE
                </div>
                <div className="environment-card">
                  <div className={`context-env-icon ${environment.color}`}>
                    {environment.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <strong>{environment.name}</strong>
                    <span>Histórico separado</span>
                  </div>
                  <LockKeyhole size={14} />
                </div>
              </div>
              <div className="context-section">
                <div className="context-label">
                  <StickyNote size={14} />
                  {project ? "MEMÓRIA DO PROJETO" : "INSTRUÇÕES DO AMBIENTE"}
                  <button
                    title="Editar contexto"
                    aria-label="Editar contexto"
                    onClick={() => openDialog("memory")}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <p className="memory-preview">
                  {(project ? project.memory : environment.instructions) ||
                    "Adiciona preferências e decisões que queres manter neste espaço."}
                </p>
                <button
                  className="text-button"
                  onClick={() => openDialog("memory")}
                >
                  {(project ? project.memory : environment.instructions)
                    ? "Editar contexto"
                    : "Adicionar contexto"}
                  <ArrowRight size={13} />
                </button>
              </div>
              {project && (
                <div className="context-section">
                  <div className="context-label">
                    <Folder size={14} />
                    PROJETO
                  </div>
                  <strong className="project-detail">{project.name}</strong>
                  <p className="path-detail">
                    {project.path || "Sem pasta associada"}
                  </p>
                  <span className="subtle">
                    {mode === "worker"
                      ? "Apenas esta pasta fica disponível durante a execução."
                      : "O Chat não tem acesso aos ficheiros locais."}
                  </span>
                </div>
              )}
              <div className="context-section">
                <div className="context-label">
                  <Cpu size={14} />
                  CONTA DESTE AMBIENTE
                </div>
                <button
                  className="provider-card"
                  onClick={() => openDialog("settings")}
                  aria-label="Gerir conta deste ambiente"
                >
                  <Bot size={20} />
                  <div>
                    <strong>OpenAI</strong>
                    <span>
                      {openai.account?.connected
                        ? openai.account.email
                        : "Sem conta ligada"}
                    </span>
                  </div>
                  <span className="pending-chip">
                    {openai.account?.eligible
                      ? "Ligada"
                      : openai.account?.connected
                        ? "Autorizar"
                        : "Ligar"}
                  </span>
                </button>
                <p className="subtle">
                  {lastUsage?.environmentId === environmentId
                    ? `Última resposta: ${lastUsage.input} tokens de entrada e ${lastUsage.output} de saída.`
                    : "A conta é associada apenas a este ambiente."}
                </p>
              </div>
              <div className="context-bottom">
                <ShieldCheck size={18} />
                <strong>O contexto fica no seu lugar.</strong>
                <p>
                  Chat e Worker têm históricos separados. A passagem de contexto
                  é sempre uma escolha tua.
                </p>
                <button onClick={() => openDialog("settings")}>
                  <CircleHelp size={13} />
                  Sobre esta versão
                </button>
              </div>
            </aside>
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
            className={`modal ${dialog === "settings" ? "settings-modal" : ""}`}
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <button
              className="modal-close icon-button"
              aria-label="Fechar"
              onClick={() => setDialog(null)}
            >
              <X size={19} />
            </button>
            {dialog === "settings" ? (
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
                ? "Um novo ambiente"
                : dialog === "project"
                  ? "Adicionar projeto"
                  : dialog === "projectPath"
                    ? "Pasta do projeto"
                    : dialog === "memory"
                      ? project
                        ? "Memória do projeto"
                        : "Instruções do ambiente"
                      : "A tua conta, neste ambiente"}
            </h2>
            {dialog === "settings" ? (
              <>
                <p className="modal-description">
                  <span className={`settings-environment ${environment.color}`}>
                    {environment.name}
                  </span>{" "}
                  Os outros ambientes mantêm as suas próprias contas.
                </p>
                <ThemeSwitcher
                  value={appearance.preference}
                  onChange={appearance.selectTheme}
                />
                <div
                  className={`settings-account-card ${openai.account?.eligible ? "connected" : ""}`}
                >
                  <div className="provider-icon">
                    <Bot size={20} />
                  </div>
                  <div>
                    <strong>
                      {openai.account?.connected
                        ? openai.account.email
                        : "Ligar a tua subscrição ChatGPT"}
                    </strong>
                    <p>
                      {openai.account?.eligible
                        ? "Conta ligada. Os modelos disponíveis aparecem no seletor do Chat."
                        : "Liga a tua conta no navegador para usar a subscrição, quando elegível. As conversas oficiais ficam no ChatGPT."}
                    </p>
                  </div>
                </div>
                {openai.issue && (
                  <p className="account-issue" role="status">
                    {openai.issue}
                  </p>
                )}
                <div className="account-actions">
                  {openai.loginEnvironment ? (
                    <>
                      <p>Aguarda a conclusão do login no navegador.</p>
                      <button
                        className="secondary-button"
                        onClick={openai.cancelLogin}
                      >
                        Cancelar login
                      </button>
                    </>
                  ) : (
                    <button className="primary-button" onClick={openai.login}>
                      {openai.account?.connected
                        ? "Renovar autorização"
                        : "Continue with ChatGPT"}
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
                          ? "A desligar..."
                          : "Desligar conta"}
                      </button>
                      <button
                        className="text-button"
                        onClick={openai.reloadModels}
                      >
                        Atualizar modelos
                      </button>
                    </>
                  )}
                </div>
                {openai.account?.connected && !openai.account.eligible && (
                  <p className="account-issue">
                    A conta iniciou sessão, mas não concedeu a permissão
                    necessária para usar a subscrição. Renova a autorização e
                    verifica a elegibilidade da conta e do workspace.
                  </p>
                )}
                <div className="settings-privacy">
                  <ShieldCheck size={17} />
                  <p>
                    {openai.account?.connected
                      ? "A conta está ligada apenas a "
                      : "Ao ligares uma conta, ela fica associada apenas a "}
                    <strong>{environment.name}</strong>. Para usar outra conta,
                    escolhe outro ambiente.
                  </p>
                </div>
                <DesktopIntegration />
                <WorkerSetup worker={worker} />
                {worker.issue && (
                  <p className="account-issue" role="alert">
                    {worker.issue}
                  </p>
                )}
                <details className="settings-details">
                  <summary>Privacidade e sobre esta versão</summary>
                  <p>
                    As credenciais ficam protegidas no teu computador. O
                    histórico é local, separado por ambiente e modo. O Chat
                    recebe a conversa atual e o contexto que guardaste neste
                    espaço.
                  </p>
                  <p>
                    Agent Workbench {appVersion} · Chat e Codex Worker com histórico
                    local. O Worker altera diretamente os ficheiros da pasta
                    selecionada. Parar uma tarefa não desfaz alterações já
                    realizadas.
                  </p>
                </details>
                <button
                  className="primary-button full-width"
                  onClick={() => setDialog(null)}
                >
                  Concluir
                </button>
              </>
            ) : (
              <form onSubmit={submitDialog}>
                <p className="modal-description">
                  {dialog === "environment"
                    ? "Mantém projetos, conversas e instruções num espaço próprio."
                    : dialog === "projectPath"
                      ? "Esta será a única pasta do computador disponível para as tarefas deste projeto."
                      : dialog === "project"
                        ? `Este projeto ficará no ambiente ${environment.name}.`
                        : "Guarda apenas informação adequada a este espaço. Não incluas credenciais ou segredos."}
                </p>
                {(dialog === "environment" || dialog === "project") && (
                  <label className="field">
                    Nome
                    <input
                      autoFocus
                      required
                      maxLength={80}
                      value={formName}
                      placeholder={
                        dialog === "environment"
                          ? "Ex.: Nexlo Games"
                          : "Ex.: Agent Workbench"
                      }
                      onChange={(event) => setFormName(event.target.value)}
                    />
                  </label>
                )}
                {dialog === "environment" && (
                  <div className="field">
                    Cor
                    <div className="color-picker">
                      {(["violet", "blue", "green", "orange"] as Color[]).map(
                        (color) => (
                          <button
                            key={color}
                            type="button"
                            aria-label={color}
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
                    Pasta do projeto{" "}
                    <span>(necessária para executar o Worker)</span>
                    <input
                      maxLength={4096}
                      value={formPath}
                      placeholder="/home/utilizador/Projects/meu-projeto"
                      onChange={(event) => setFormPath(event.target.value)}
                    />
                    <small>
                      Ao executar uma tarefa, o Codex poderá ler e alterar os
                      ficheiros desta pasta. Escolhe apenas o projeto que queres
                      disponibilizar.
                    </small>
                  </label>
                )}
                {dialog === "memory" && (
                  <label className="field">
                    {project ? project.name : environment.name}
                    <textarea
                      autoFocus
                      rows={10}
                      maxLength={100_000}
                      value={formText}
                      onChange={(event) => setFormText(event.target.value)}
                      placeholder="Preferências, decisões e contexto importante..."
                    />
                    <small>
                      Este contexto será enviado nos pedidos de Chat e Worker
                      deste ambiente ou projeto.
                    </small>
                  </label>
                )}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setDialog(null)}
                  >
                    Cancelar
                  </button>
                  <button className="primary-button" type="submit">
                    {dialog === "memory"
                      ? "Guardar contexto"
                      : dialog === "projectPath"
                        ? "Guardar pasta"
                        : "Criar"}
                    <ArrowRight size={15} />
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
