import { t } from "../i18n";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { messageBlocks } from "../message-content";

function CodeBlock({
  content,
  language,
}: {
  content: string;
  language: string;
}) {
  const [copyState, setCopyState] = useState("Copy");
  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopyState("Copied");
    } catch {
      setCopyState("Select the code to copy");
    }
  }
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{language || t("Code")}</span>
        <button onClick={copy} aria-label={t("Copy code")}>
          {copyState === "Copied" ? <Check size={13} /> : <Copy size={13} />}
          <span role="status">{t(copyState)}</span>
        </button>
      </div>
      <pre>
        <code>{content}</code>
      </pre>
    </div>
  );
}

export function MessageContent({ content }: { content: string }) {
  return (
    <div className="message-content">
      {messageBlocks(content).map((block, index) =>
        block.type === "code" ? (
          <CodeBlock
            key={index}
            content={block.content}
            language={block.language}
          />
        ) : (
          <p key={index}>{block.content}</p>
        ),
      )}
    </div>
  );
}
