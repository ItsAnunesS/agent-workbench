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
  const [copyState, setCopyState] = useState("Copiar");
  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopyState("Copiado");
    } catch {
      setCopyState("Seleciona o código para copiar");
    }
  }
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{language || "Código"}</span>
        <button onClick={copy} aria-label="Copiar código">
          {copyState === "Copiado" ? <Check size={13} /> : <Copy size={13} />}
          <span role="status">{copyState}</span>
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
