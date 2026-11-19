import { t } from "./i18n";
export type Mode = "chat" | "worker";
export type Color = "violet" | "blue" | "green" | "orange";
export interface Environment {
  id: string;
  name: string;
  color: Color;
  instructions: string;
}
export interface Project {
  id: string;
  environmentId: string;
  name: string;
  path: string;
  memory: string;
  archived?: boolean;
  pinned?: boolean;
}
export interface Message {
  id: string;
  content: string;
  createdAt: string;
  role?: "user" | "assistant";
  status?: "completed" | "interrupted" | "failed";
  durationMs?: number;
  summary?: string;
  workerRunId?: string;
}
export interface Conversation {
  id: string;
  environmentId: string;
  projectId: string | null;
  mode: Mode;
  title: string;
  messages: Message[];
  createdAt: string;
  sourceId: string | null;
  archived?: boolean;
  pinned?: boolean;
}
export interface Workspace {
  version: number;
  environments: Environment[];
  projects: Project[];
  conversations: Conversation[];
}

export function visibleConversations(
  workspace: Workspace,
  environmentId: string,
  mode: Mode,
  projectId: string | null,
  archived = false,
) {
  return workspace.conversations.filter(
    (conversation) =>
      conversation.environmentId === environmentId &&
      conversation.mode === mode &&
      conversation.projectId === projectId &&
      isArchived(workspace, conversation) === archived,
  );
}

export function isArchived(workspace: Workspace, conversation: Conversation) {
  return (
    !!conversation.archived ||
    !!workspace.projects.find(
      (project) => project.id === conversation.projectId,
    )?.archived
  );
}

export function removeConversation(
  workspace: Workspace,
  id: string,
): Workspace {
  return {
    ...workspace,
    conversations: workspace.conversations
      .filter((item) => item.id !== id)
      .map((item) =>
        item.sourceId === id ? { ...item, sourceId: null } : item,
      ),
  };
}

export function removeProject(workspace: Workspace, id: string): Workspace {
  const project = workspace.projects.find((item) => item.id === id);
  return {
    ...workspace,
    projects: workspace.projects.filter((item) => item.id !== id),
    conversations: workspace.conversations.map((item) =>
      item.projectId === id
        ? {
            ...item,
            projectId: null,
            archived: !!item.archived || !!project?.archived,
          }
        : item,
    ),
  };
}

export function duplicateConversation(source: Conversation): Conversation {
  return {
    ...source,
    id: crypto.randomUUID(),
    title: Array.from(t("{title} (copy)", { title: source.title })).slice(0, 100).join(""),
    archived: false,
    pinned: false,
    createdAt: new Date().toISOString(),
    messages: source.messages.map(({ workerRunId: _run, ...message }) => ({
      ...message,
      id: crypto.randomUUID(),
    })),
  };
}

export function createConversation(
  environmentId: string,
  mode: Mode,
  projectId: string | null,
): Conversation {
  return {
    id: crypto.randomUUID(),
    environmentId,
    projectId,
    mode,
    title: mode === "chat" ? t("New conversation") : t("New task"),
    messages: [],
    createdAt: new Date().toISOString(),
    sourceId: null,
  };
}

export function createHandoff(source: Conversation): Conversation {
  if (source.mode !== "chat")
    throw new Error("The source must be a Chat conversation.");
  return {
    ...createConversation(source.environmentId, "worker", source.projectId),
    title: source.title,
    sourceId: source.id,
    messages: source.messages.map((message) => ({
      ...message,
      id: crypto.randomUUID(),
    })),
  };
}
