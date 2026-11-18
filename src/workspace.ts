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
}
export interface Message {
  id: string;
  content: string;
  createdAt: string;
  role?: "user" | "assistant";
  status?: "completed" | "interrupted" | "failed";
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
) {
  return workspace.conversations.filter(
    (conversation) =>
      conversation.environmentId === environmentId &&
      conversation.mode === mode &&
      conversation.projectId === projectId,
  );
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
    title: mode === "chat" ? "Nova conversa" : "Nova tarefa",
    messages: [],
    createdAt: new Date().toISOString(),
    sourceId: null,
  };
}

export function createHandoff(source: Conversation): Conversation {
  if (source.mode !== "chat")
    throw new Error("A origem deve ser uma conversa de Chat.");
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
