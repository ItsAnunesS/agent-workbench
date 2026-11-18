export type MessageBlock =
  | { type: "text"; content: string }
  | { type: "code"; content: string; language: string };

export function messageBlocks(content: string): MessageBlock[] {
  const result: MessageBlock[] = [];
  let code: string[] | null = null;
  let text: string[] = [];
  let language = "";
  for (const line of content.split("\n")) {
    if (!code && /^\s*```/.test(line)) {
      if (text.length) result.push({ type: "text", content: text.join("\n") });
      text = [];
      code = [];
      language = line.trim().slice(3).trim();
    } else if (code && /^\s*```\s*$/.test(line)) {
      result.push({ type: "code", content: code.join("\n"), language });
      code = null;
    } else if (code) code.push(line);
    else text.push(line);
  }
  if (code) result.push({ type: "code", content: code.join("\n"), language });
  if (text.length) result.push({ type: "text", content: text.join("\n") });
  return result;
}
