import { describe, expect, it } from "vitest";
import { messageBlocks } from "./message-content";

describe("message formatting", () => {
  it("separates fenced code without changing the code text", () => {
    expect(
      messageBlocks("Exemplo:\n```ts\nconst value = '<script>';\n```\nFim."),
    ).toEqual([
      { type: "text", content: "Exemplo:" },
      { type: "code", content: "const value = '<script>';", language: "ts" },
      { type: "text", content: "Fim." },
    ]);
  });
  it("shows an unfinished code block while a response streams", () => {
    expect(messageBlocks("```rust\nfn main() {")).toEqual([
      { type: "code", content: "fn main() {", language: "rust" },
    ]);
  });
  it("keeps HTML as text and preserves line breaks", () => {
    expect(messageBlocks("<img src=x onerror=alert(1)>\nLinha 2")).toEqual([
      { type: "text", content: "<img src=x onerror=alert(1)>\nLinha 2" },
    ]);
  });
});
