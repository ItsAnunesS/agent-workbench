import { describe, expect, it } from "vitest";
import {
  createConversation,
  createHandoff,
  visibleConversations,
  removeConversation,
  removeProject,
  duplicateConversation,
  type Workspace,
} from "./workspace";

describe("workspace boundaries", () => {
  it("keeps archived projects and conversations out of active lists", () => {
    const chat = createConversation("personal", "chat", "p");
    const workspace: Workspace = {
      version: 1,
      environments: [],
      projects: [
        {
          id: "p",
          environmentId: "personal",
          name: "Project",
          path: "",
          memory: "",
          archived: true,
        },
      ],
      conversations: [chat],
    };
    expect(visibleConversations(workspace, "personal", "chat", "p")).toEqual(
      [],
    );
    expect(
      visibleConversations(workspace, "personal", "chat", "p", true),
    ).toEqual([chat]);
    const removed = removeProject(workspace, "p");
    expect(removed.conversations[0].projectId).toBeNull();
    expect(removed.conversations[0].archived).toBe(true);
    expect(workspace.conversations[0].projectId).toBe("p");
  });

  it("deletes a conversation without losing the copied handoff context", () => {
    const source = createConversation("personal", "chat", null);
    source.messages.push({
      id: "message",
      content: "Keep this context",
      createdAt: "now",
    });
    const task = createHandoff(source);
    const workspace: Workspace = {
      version: 1,
      environments: [],
      projects: [],
      conversations: [source, task],
    };
    const result = removeConversation(workspace, source.id);
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0].sourceId).toBeNull();
    expect(result.conversations[0].messages[0].content).toBe(
      "Keep this context",
    );
  });

  it("duplicates messages independently without linking unrelated task runs", () => {
    const source = createConversation("personal", "worker", "project");
    source.archived = true;
    source.messages.push({
      id: "message",
      content: "Answer",
      createdAt: "now",
      workerRunId: "old-run",
    });
    const copy = duplicateConversation(source);
    expect(copy.id).not.toBe(source.id);
    expect(copy.messages[0].id).not.toBe("message");
    expect(copy.messages[0].workerRunId).toBeUndefined();
    expect(copy.archived).toBe(false);
    expect(source.archived).toBe(true);
  });
  it("keeps environments, modes and projects in separate lists", () => {
    const chat = createConversation("personal", "chat", null);
    const worker = createConversation("personal", "worker", null);
    const work = createConversation("work", "chat", null);
    const project = createConversation("personal", "chat", "project");
    const workspace: Workspace = {
      version: 1,
      environments: [],
      projects: [],
      conversations: [chat, worker, work, project],
    };
    expect(visibleConversations(workspace, "personal", "chat", null)).toEqual([
      chat,
    ]);
    expect(visibleConversations(workspace, "personal", "worker", null)).toEqual(
      [worker],
    );
    expect(visibleConversations(workspace, "work", "chat", null)).toEqual([
      work,
    ]);
    expect(
      visibleConversations(workspace, "personal", "chat", "project"),
    ).toEqual([project]);
  });

  it("creates an independent worker task and preserves the original chat", () => {
    const source = createConversation("personal", "chat", "project");
    source.messages.push({
      id: "message",
      content: "Implement authentication",
      createdAt: new Date().toISOString(),
    });
    const task = createHandoff(source);
    expect(task.mode).toBe("worker");
    expect(task.sourceId).toBe(source.id);
    expect(task.environmentId).toBe(source.environmentId);
    expect(task.projectId).toBe(source.projectId);
    task.messages[0].content = "Changed task";
    expect(source.messages[0].content).toBe("Implement authentication");
    expect(source.mode).toBe("chat");
  });

  it("rejects a worker as the source of another handoff", () => {
    expect(() =>
      createHandoff(createConversation("personal", "worker", null)),
    ).toThrow();
  });
});
