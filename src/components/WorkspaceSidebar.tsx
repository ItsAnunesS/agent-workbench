import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  Archive,
  ChevronRight,
  Code2,
  Folder,
  FolderPlus,
  Hash,
  MessageSquare,
  MoreHorizontal,
  Pin,
  Plus,
  Search,
} from "lucide-react";
import { t } from "../i18n";
import {
  isArchived,
  type Conversation,
  type Mode,
  type Workspace,
} from "../workspace";

export type SidebarTarget = { type: "conversation" | "project"; id: string };
export type SidebarAction =
  | "rename"
  | "pin"
  | "duplicate"
  | "move"
  | "archive"
  | "delete"
  | "newChat"
  | "newTask"
  | "memory"
  | "folder";
interface Props {
  workspace: Workspace;
  environmentId: string;
  mode: Mode;
  projectId: string | null;
  conversationId: string | null;
  query: string;
  onQuery: (value: string) => void;
  onScope: (
    environmentId: string,
    projectId: string | null,
    mode: Mode,
    conversationId?: string | null,
  ) => void;
  onNew: () => void;
  onProject: () => void;
  onAction: (target: SidebarTarget, action: SidebarAction) => void;
  busyIds: string[];
}

function readExpanded(): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem("workbench.expandedProjects") || "{}",
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).filter(
            ([, entry]) => typeof entry === "boolean",
          ),
        )
      : {};
  } catch {
    return {};
  }
}

function ContextMenu({
  x,
  y,
  target,
  archived,
  pinned,
  busy,
  restoreProject,
  onAction,
  onClose,
}: {
  x: number;
  y: number;
  target: SidebarTarget;
  archived: boolean;
  pinned: boolean;
  busy: boolean;
  restoreProject?: boolean;
  onAction: (action: SidebarAction) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const scroll = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("resize", onClose);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", onClose);
      document.removeEventListener("scroll", scroll, true);
      previous?.focus();
    };
  }, [onClose]);
  const entries: { action: SidebarAction; label: string }[] =
    target.type === "project"
      ? [
          { action: "newChat", label: t("New conversation") },
          { action: "newTask", label: t("New task") },
          { action: "rename", label: t("Rename") },
          { action: "pin", label: t(pinned ? "Unpin" : "Pin") },
          { action: "memory", label: t("Edit context") },
          { action: "folder", label: t("Set folder") },
        ]
      : [
          { action: "rename", label: t("Rename") },
          { action: "pin", label: t(pinned ? "Unpin" : "Pin") },
          { action: "duplicate", label: t("Duplicate") },
          { action: "move", label: t("Move to project") },
        ];
  entries.push(
    {
      action: "archive",
      label: t(
        restoreProject ? "Restore project" : archived ? "Restore" : "Archive",
      ),
    },
    { action: "delete", label: t("Delete") },
  );
  return (
    <div
      ref={ref}
      className="sidebar-context-menu"
      role="menu"
      aria-label={t("Actions")}
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 228)),
        top: Math.max(
          8,
          Math.min(y, window.innerHeight - entries.length * 37 - 16),
        ),
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          onClose();
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const buttons = [
            ...ref.current!.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          ];
          const current = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const index =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (current +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    buttons.length) %
                  buttons.length;
          buttons[index]?.focus();
        }
      }}
    >
      {entries.map(({ action, label }) => (
        <button
          type="button"
          role="menuitem"
          key={action}
          className={action === "delete" ? "danger-action" : ""}
          disabled={
            busy ||
            (restoreProject && action === "duplicate") ||
            (archived &&
              ["newChat", "newTask", "folder", "memory"].includes(action))
          }
          onClick={() => {
            onClose();
            onAction(action);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function WorkspaceSidebar(props: Props) {
  const {
    workspace,
    environmentId,
    mode,
    projectId,
    conversationId,
    onScope,
    onAction,
    busyIds,
  } = props;
  const [expanded, setExpanded] = useState(readExpanded);
  const [archived, setArchived] = useState(false);
  const [menu, setMenu] = useState<{
    target: SidebarTarget;
    x: number;
    y: number;
  } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const scopeKey = (id: string) => `${environmentId}:${mode}:${id}`;
  useEffect(() => {
    if (projectId)
      setExpanded((previous) => ({ ...previous, [scopeKey(projectId)]: true }));
  }, [environmentId, mode, projectId]);
  useEffect(() => {
    try {
      localStorage.setItem(
        "workbench.expandedProjects",
        JSON.stringify(expanded),
      );
    } catch {
      /* Keep disclosure state in memory when storage is unavailable. */
    }
  }, [expanded]);
  useEffect(() => {
    setArchived(false);
    setMenu(null);
  }, [environmentId, mode]);
  const query = props.query.trim().toLocaleLowerCase();
  const matches = (value: string) => value.toLocaleLowerCase().includes(query);
  const sort = <T extends { pinned?: boolean; createdAt?: string }>(
    items: T[],
  ) =>
    [...items].sort(
      (left, right) =>
        Number(!!right.pinned) - Number(!!left.pinned) ||
        (right.createdAt || "").localeCompare(left.createdAt || ""),
    );
  const conversations = workspace.conversations.filter(
    (item) => item.environmentId === environmentId && item.mode === mode,
  );
  const projects = sort(
    workspace.projects.filter(
      (item) =>
        item.environmentId === environmentId &&
        (archived
          ? item.archived ||
            conversations.some(
              (chat) => chat.projectId === item.id && chat.archived,
            )
          : !item.archived),
    ),
  );
  const standalone = sort(
    conversations.filter(
      (item) =>
        !item.projectId && !!item.archived === archived && matches(item.title),
    ),
  );
  const showMenu = (event: MouseEvent, target: SidebarTarget) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ target, x: event.clientX, y: event.clientY });
  };
  const keyboardMenu = (event: React.KeyboardEvent, target: SidebarTarget) => {
    if (
      event.key === "ContextMenu" ||
      (event.shiftKey && event.key === "F10")
    ) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu({ target, x: rect.left + 20, y: rect.bottom });
    }
  };
  const more = (target: SidebarTarget) => (
    <button
      type="button"
      className="sidebar-more"
      aria-label={t("More actions")}
      title={t("More actions")}
      aria-haspopup="menu"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        event.stopPropagation();
        setMenu({ target, x: rect.left, y: rect.bottom });
      }}
    >
      <MoreHorizontal size={15} />
    </button>
  );
  const row = (item: Conversation, nested = false) => (
    <div
      key={item.id}
      className={`sidebar-item ${nested ? "nested-conversation" : ""}`}
      onContextMenu={(event) =>
        showMenu(event, { type: "conversation", id: item.id })
      }
    >
      <button
        type="button"
        className={`conversation-row ${conversationId === item.id ? "selected" : ""}`}
        onKeyDown={(event) =>
          keyboardMenu(event, { type: "conversation", id: item.id })
        }
        onClick={() =>
          onScope(environmentId, item.projectId, item.mode, item.id)
        }
      >
        {mode === "chat" ? <MessageSquare size={14} /> : <Code2 size={14} />}
        <span>{item.title}</span>
        {item.pinned && <Pin size={11} />}
        {busyIds.includes(item.id) && (
          <span className="sidebar-running" aria-label={t("Running")} />
        )}
      </button>
      {more({ type: "conversation", id: item.id })}
    </div>
  );
  const selected = workspace.conversations.find(
    (item) => item.id === conversationId,
  );
  const selectedArchived = selected
    ? isArchived(workspace, selected)
    : workspace.projects.find((item) => item.id === projectId)?.archived;
  useEffect(() => {
    setArchived(!!selectedArchived);
  }, [conversationId, projectId]);
  const target =
    menu?.target.type === "project"
      ? workspace.projects.find((item) => item.id === menu.target.id)
      : workspace.conversations.find((item) => item.id === menu?.target.id);
  const menuBusy =
    !!menu &&
    (menu.target.type === "conversation"
      ? busyIds.includes(menu.target.id)
      : workspace.conversations.some(
          (item) =>
            item.projectId === menu.target.id && busyIds.includes(item.id),
        ));
  return (
    <>
      <button
        className="new-button"
        onClick={props.onNew}
        disabled={archived || !!selectedArchived}
      >
        <Plus size={17} />
        {t(mode === "chat" ? "New conversation" : "New task")}
        <span aria-hidden="true">+</span>
      </button>
      <div className="mode-tabs" aria-label={t("Conversation type")}>
        <button
          className={mode === "chat" ? "selected" : ""}
          aria-pressed={mode === "chat"}
          onClick={() => onScope(environmentId, projectId, "chat")}
        >
          <MessageSquare size={15} />
          {t("Chat")}
        </button>
        <button
          className={mode === "worker" ? "selected" : ""}
          aria-pressed={mode === "worker"}
          onClick={() => onScope(environmentId, projectId, "worker")}
        >
          <Code2 size={16} />
          {t("Worker")}
        </button>
      </div>
      <label className="search">
        <Search size={15} />
        <input
          aria-label={t("Search conversations")}
          placeholder={t("Search this workspace")}
          value={props.query}
          onChange={(event) => props.onQuery(event.target.value)}
        />
      </label>
      <button
        className={`project-row general-row ${!projectId ? "selected" : ""}`}
        onClick={() => onScope(environmentId, null, mode)}
      >
        <Hash size={16} />
        {t("General")}
      </button>
      <div className="section-label project-label">
        <span>{t(archived ? "ARCHIVED PROJECTS" : "PROJECTS")}</span>
        <button
          title={t("Create project")}
          aria-label={t("Create project")}
          onClick={props.onProject}
        >
          <Plus size={15} />
        </button>
      </div>
      {projects.map((project) => {
        const allChildren = conversations.filter(
          (item) =>
            item.projectId === project.id &&
            isArchived(workspace, item) === archived,
        );
        const children = sort(
          allChildren.filter(
            (item) => matches(item.title) || matches(project.name),
          ),
        );
        if (query && !matches(project.name) && !children.length) return null;
        const open = !!expanded[scopeKey(project.id)] || !!query;
        return (
          <section className="sidebar-project" key={project.id}>
            <div
              className="sidebar-item"
              onContextMenu={(event) =>
                showMenu(event, { type: "project", id: project.id })
              }
            >
              <button
                type="button"
                className={`project-row ${projectId === project.id ? "selected" : ""}`}
                aria-expanded={open}
                aria-controls={`project-${project.id}`}
                onKeyDown={(event) =>
                  keyboardMenu(event, { type: "project", id: project.id })
                }
                onClick={() => {
                  setExpanded((previous) => ({
                    ...previous,
                    [scopeKey(project.id)]: !open,
                  }));
                  if (projectId !== project.id)
                    onScope(environmentId, project.id, mode);
                }}
              >
                <ChevronRight
                  size={13}
                  className={`project-chevron ${open ? "expanded" : ""}`}
                />
                <Folder size={16} />
                <span className="project-name">{project.name}</span>
                {project.pinned && <Pin size={11} />}
              </button>
              {more({ type: "project", id: project.id })}
            </div>
            {open && (
              <div
                id={`project-${project.id}`}
                className="project-conversations"
              >
                {children.map((item) => row(item, true))}
                {!children.length && (
                  <p className="sidebar-empty project-empty">
                    {t(
                      query
                        ? "No results."
                        : mode === "chat"
                          ? "No chats"
                          : "No tasks",
                    )}
                  </p>
                )}
              </div>
            )}
          </section>
        );
      })}
      {!projects.length && !archived && (
        <button className="empty-project" onClick={props.onProject}>
          <FolderPlus size={16} />
          <span>{t("Add your first project")}</span>
        </button>
      )}
      <div className="section-label conversations-label">
        <span>
          {t(
            archived ? "ARCHIVED" : mode === "chat" ? "CONVERSATIONS" : "TASKS",
          )}
        </span>
        <span>{standalone.length.toString().padStart(2, "0")}</span>
      </div>
      <div className="conversation-list">
        {standalone.map((item) => row(item))}
        {!standalone.length && (
          <p className="sidebar-empty">
            {t(
              query
                ? "No results."
                : mode === "chat"
                  ? "Your conversations appear here."
                  : "Your tasks appear here.",
            )}
          </p>
        )}
      </div>
      <button
        type="button"
        className="sidebar-archive-toggle"
        aria-pressed={archived}
        onClick={() => setArchived(!archived)}
      >
        <Archive size={14} />
        {t(archived ? "Show active" : "Show archived")}
      </button>
      {menu && target && (
        <ContextMenu
          {...menu}
          target={menu.target}
          restoreProject={
            menu.target.type === "conversation" &&
            !!workspace.projects.find(
              (item) => item.id === (target as Conversation).projectId,
            )?.archived
          }
          archived={
            menu.target.type === "conversation"
              ? isArchived(workspace, target as Conversation)
              : !!target.archived
          }
          pinned={!!target.pinned}
          busy={menuBusy}
          onClose={closeMenu}
          onAction={(action) => {
            const parent =
              menu.target.type === "conversation"
                ? workspace.projects.find(
                    (item) => item.id === (target as Conversation).projectId,
                  )
                : null;
            onAction(
              action === "archive" && parent?.archived
                ? { type: "project", id: parent.id }
                : menu.target,
              action,
            );
          }}
        />
      )}
    </>
  );
}
