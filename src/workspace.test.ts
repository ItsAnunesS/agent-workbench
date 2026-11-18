import { describe, expect, it } from "vitest";
import {
  createConversation,
  createHandoff,
  visibleConversations,
  type Workspace,
} from "./workspace";

describe("workspace boundaries", () => {
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
