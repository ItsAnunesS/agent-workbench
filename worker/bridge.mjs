import http from "node:http";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// The container has no network. Only these inference requests cross its stdio boundary.
const MAX_BODY = 8 * 1024 * 1024;
const pending = new Map();
let nextId = 0;
let child;
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const server = http.createServer(async (request, response) => {
  if (
    !(
      (request.method === "POST" && request.url === "/v1/responses") ||
      (request.method === "GET" && request.url === "/v1/models")
    )
  ) {
    response.writeHead(403).end("Endpoint unavailable");
    return;
  }
  if (pending.size >= 2) {
    response.writeHead(429).end("Too many requests");
    return;
  }
  let size = 0;
  const chunks = [];
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BODY) {
        response.writeHead(413).end("Request too large");
        return;
      }
      chunks.push(chunk);
    }
  } catch {
    response.destroy();
    return;
  }
  if (pending.size >= 2) {
    response.writeHead(429).end("Too many requests");
    return;
  }
  const id = String(++nextId);
  const timer = setTimeout(() => {
    pending.delete(id);
    response.destroy();
  }, 300_000);
  pending.set(id, { response, timer });
  response.on("close", () => {
    clearTimeout(timer);
    pending.delete(id);
  });
  send({
    workbenchBridge: {
      id,
      method: request.method,
      path: request.url,
      body: Buffer.concat(chunks).toString("utf8"),
    },
  });
});

server.maxConnections = 4;
server.requestTimeout = 15_000;
server.headersTimeout = 5_000;

createInterface({ input: process.stdin, crlfDelay: Infinity })
  .on("line", (line) => {
    if (line.length > MAX_BODY * 2) {
      process.exitCode = 1;
      shutdown();
      return;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      shutdown();
      return;
    }
    if (message.workbenchBridgeResponse) {
      const result = message.workbenchBridgeResponse;
      const entry = pending.get(result.id);
      if (!entry) return;
      if (!entry.response.headersSent)
        entry.response.writeHead(result.status || 200, {
          "content-type": result.contentType || "application/json",
          "cache-control": "no-store",
        });
      if (result.data) entry.response.write(Buffer.from(result.data, "base64"));
      if (result.end) {
        clearTimeout(entry.timer);
        pending.delete(result.id);
        entry.response.end();
      }
    } else if (child?.stdin.writable) {
      child.stdin.write(`${line}\n`);
    }
  })
  .on("close", shutdown);

function shutdown() {
  for (const { response, timer } of pending.values()) {
    clearTimeout(timer);
    response.destroy();
  }
  pending.clear();
  server.close();
  child?.kill("SIGTERM");
  setTimeout(() => process.exit(), 500).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
server.listen(4096, "127.0.0.1", () => {
  mkdirSync(process.env.CODEX_HOME, { recursive: true, mode: 0o700 });
  child = spawn(
    "codex",
    [
      "app-server",
      "--listen",
      "stdio://",
      "-c",
      'model_provider="workbench"',
      "-c",
      'model_providers.workbench.name="ChatGPT plan"',
      "-c",
      'model_providers.workbench.base_url="http://127.0.0.1:4096/v1"',
      "-c",
      'model_providers.workbench.env_key="WORKBENCH_LOCAL_KEY"',
      "-c",
      'model_providers.workbench.wire_api="responses"',
      "-c",
      "model_providers.workbench.requires_openai_auth=false",
      "-c",
      "model_providers.workbench.supports_websockets=false",
      "-c",
      'web_search="disabled"',
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, WORKBENCH_LOCAL_KEY: "local-transport-only" },
    },
  );
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on(
    "line",
    (line) => process.stdout.write(`${line}\n`),
  );
  child.stderr.pipe(process.stderr);
  child.on("error", () => {
    process.stderr.write("Codex could not start\n");
    process.exit(1);
  });
  child.on("exit", (code) => {
    server.close();
    process.exit(code || 0);
  });
  send({ workbenchReady: true });
});
