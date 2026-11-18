# Security policy

## Supported versions

Security fixes target the latest tagged release. Upgrade before reporting a problem against an older build. `dev` and commit artifacts are development builds.

## Report privately

Use GitHub's private vulnerability reporting when available on this repository. Otherwise email **hello@anuness.dev**, with subject `Agent Workbench security`.

Include the affected version, OS, reproduction steps, impact and a minimal example. Redact tokens, account details, private prompts and company data. Do not disclose an unpatched vulnerability in a public issue or PR.

There is no guaranteed response SLA. The maintainer will investigate and coordinate a fix and disclosure when the report is confirmed.

## Relevant boundaries

- OpenAI credentials stay in the native app's local storage. They are not passed to the Worker container or browser UI.
- Docker is the Worker isolation boundary. Only the selected project folder is mounted, with write access.
- Worker commands have no external network access. Model requests are forwarded by the host to fixed OpenAI endpoints.
- Approval grants are one-time and scoped to the active task. They do not add host mounts or network access.
- Do not select a home directory or place credentials inside a project folder. Mounted project contents are available to the Worker.
- Chat and Worker keep independent local histories. An explicit handoff copies selected conversation context.

Signing, sandboxing and approvals address different risks. This policy does not claim that downloaded builds are notarized or that Docker makes arbitrary project code safe.
