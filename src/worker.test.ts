import { describe, expect, it } from "vitest";
import { coalesceEvents, type WorkerEvent } from "./worker";

describe("worker timeline", () => {
  it("updates a tool in place while preserving interleaved commentary", () => {
    const start: WorkerEvent = {
      kind: "activity",
      text: "",
      item: { id: "command", type: "commandExecution", status: "inProgress" },
    };
    const commentary: WorkerEvent = {
      kind: "activity",
      text: "",
      item: {
        id: "message",
        type: "agentMessage",
        text: "Checking the result",
      },
    };
    const end: WorkerEvent = {
      ...start,
      item: { ...start.item!, status: "completed", output: "Passed" },
    };
    expect(coalesceEvents([start, commentary, end])).toEqual([end, commentary]);
  });
});
