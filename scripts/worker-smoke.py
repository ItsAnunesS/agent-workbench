#!/usr/bin/env python3
"""Exercise the real Codex runtime with synthetic inference and disposable projects."""
import base64
import json
import os
import pathlib
import queue
import subprocess
import tempfile
import threading
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
IMAGE = "agent-workbench-codex:0.4.0"


def run_case(decision):
    with tempfile.TemporaryDirectory(prefix="worker-smoke-", dir=ROOT / ".build-cache") as directory:
        project = pathlib.Path(directory)
        name = f"awb-smoke-{uuid.uuid4()}"
        process = subprocess.Popen([
            "docker", "run", "--rm", "-i", "--name", name,
            "--network", "none", "--read-only", "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges", "--pids-limit", "256",
            "--memory", "4g", "--cpus", "2", "--user", f"{os.getuid()}:{os.getgid()}",
            "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m,mode=1777",
            "--tmpfs", "/home/worker:rw,nosuid,nodev,size=128m,mode=1777",
            "--mount", f"type=bind,src={project},dst=/workspace", IMAGE,
        ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        messages = queue.Queue()
        diagnostics = []
        def consume():
            for line in process.stdout:
                try:
                    messages.put(json.loads(line))
                except json.JSONDecodeError:
                    messages.put({"invalid": line[:200]})
        threading.Thread(target=consume, daemon=True).start()
        threading.Thread(target=lambda: diagnostics.extend(process.stderr), daemon=True).start()
        def send(value):
            process.stdin.write(json.dumps(value) + "\n")
            process.stdin.flush()
        calls = 0
        approvals = 0
        thread_id = None
        try:
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                try:
                    value = messages.get(timeout=2)
                except queue.Empty:
                    if process.poll() is not None:
                        raise AssertionError(f"Runtime exited: {''.join(diagnostics)[-2500:]}")
                    continue
                if value.get("workbenchReady"):
                    send({"id": "init", "method": "initialize", "params": {"clientInfo": {"name": "agent_workbench_test", "version": "0.4.0"}, "capabilities": {"experimentalApi": True}}})
                elif value.get("id") == "init" and "result" in value:
                    send({"method": "initialized"})
                    send({"id": "thread", "method": "thread/start", "params": {"cwd": "/workspace", "model": "gpt-5.1-codex", "modelProvider": "workbench", "ephemeral": True, "approvalPolicy": "untrusted", "approvalsReviewer": "user", "config": {"sandbox_mode": "danger-full-access", "web_search": "disabled", "features.multi_agent": False}}})
                elif value.get("id") == "thread" and "result" in value:
                    thread_id = value["result"]["thread"]["id"]
                    send({"id": "turn", "method": "turn/start", "params": {"threadId": thread_id, "cwd": "/workspace", "approvalPolicy": "untrusted", "approvalsReviewer": "user", "sandboxPolicy": {"type": "externalSandbox", "networkAccess": "restricted"}, "input": [{"type": "text", "text": "Create result.txt. Never request escalation.", "text_elements": []}]}})
                elif "workbenchBridge" in value:
                    request = value["workbenchBridge"]
                    assert request["method"] == "POST" and request["path"] == "/v1/responses", request["path"]
                    body = json.loads(request["body"])
                    calls += 1
                    if calls == 1:
                        tools = [tool["name"] for tool in body["tools"] if tool.get("type") == "function"]
                        tool = next((name for name in ["exec_command", "shell_command", "shell"] if name in tools), None)
                        assert tool, f"Missing shell tool: {tools}"
                        command = "printf 'worker-ok' > /workspace/result.txt"
                        args = {"cmd": command} if tool == "exec_command" else {"command": command}
                        if tool == "shell":
                            args = {"command": ["sh", "-c", command]}
                        item = {"id": "fc_1", "type": "function_call", "call_id": "call_1", "name": tool, "arguments": json.dumps(args)}
                    else:
                        item = {"id": "msg_1", "type": "message", "role": "assistant", "status": "completed", "content": [{"type": "output_text", "text": "Fixture completed.", "annotations": []}]}
                    response = {"id": f"resp_{calls}", "object": "response", "status": "completed", "output": [item], "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}}
                    events = [
                        {"type": "response.created", "response": {**response, "status": "in_progress", "output": []}},
                        {"type": "response.output_item.added", "output_index": 0, "item": item},
                    ]
                    if item["type"] == "message":
                        events.append({"type": "response.output_text.delta", "item_id": item["id"], "output_index": 0, "content_index": 0, "delta": "Fixture completed."})
                    events.extend([{"type": "response.output_item.done", "output_index": 0, "item": item}, {"type": "response.completed", "response": response}])
                    data = "".join("data: " + json.dumps(event) + "\n\n" for event in events)
                    send({"workbenchBridgeResponse": {"id": request["id"], "status": 200, "contentType": "text/event-stream", "data": base64.b64encode(data.encode()).decode(), "end": True}})
                elif "id" in value and "method" in value:
                    assert value["method"] == "item/commandExecution/requestApproval", value
                    approvals += 1
                    assert not (project / "result.txt").exists(), "Command ran before approval"
                    if decision == "interrupt":
                        send({"id": "interrupt", "method": "turn/interrupt", "params": {"threadId": thread_id, "turnId": value["params"]["turnId"]}})
                    else:
                        send({"id": value["id"], "result": {"decision": decision}})
                elif value.get("method") == "turn/completed":
                    assert value["params"]["turn"]["status"] == ("interrupted" if decision == "interrupt" else "completed"), value
                    assert approvals == 1, f"Expected one approval, got {approvals}"
                    assert (project / "result.txt").exists() == (decision == "accept")
                    if decision == "accept":
                        assert (project / "result.txt").read_text() == "worker-ok"
                    inspected = json.loads(subprocess.check_output(["docker", "inspect", name]))[0]
                    assert inspected["HostConfig"]["NetworkMode"] == "none"
                    assert inspected["HostConfig"]["ReadonlyRootfs"]
                    assert len([mount for mount in inspected["Mounts"] if mount["Type"] == "bind"]) == 1
                    print(f"PASS: real Codex command {decision}, file boundary, network isolation, read-only root")
                    return
                elif "error" in value:
                    raise AssertionError(value["error"])
            raise AssertionError(f"Timeout, calls={calls}, approvals={approvals}, diagnostics={''.join(diagnostics)[-2000:]}")
        finally:
            subprocess.run(["docker", "rm", "--force", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
            process.communicate(timeout=10)


if __name__ == "__main__":
    run_case("accept")
    run_case("decline")
    run_case("interrupt")
