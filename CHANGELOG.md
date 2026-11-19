# Changelog

Notable changes are recorded here. Versions use Semantic Versioning. Entries before the first public tag describe local builds produced during development.

## [Unreleased]

## [0.12.0] - 2026-11-19

### Changed

- Download and install newer stable GitHub releases automatically on startup by default, preserving existing opt-outs and manual controls. Keep periodic checks informational and activate installed updates when the user reopens the app.

- Replace manual project folder path inputs with a native directory selector, read-only selected paths, cancellation-safe selection and explicit folder detachment. Preserve selected paths exactly, including spaces.

### Features

* **projects:** add native folder selection ([eaaf645](https://github.com/ItsAnunesS/agent-workbench/commit/eaaf645a5e3291982df8e2f31742ada40aa95d0c))

## [0.11.0] - 2026-11-19

### Added

- Built-in Linux x86_64 AppImage updates from stable GitHub Releases: optional startup/six-hour checks, an update notification and manual download/install with progress in global settings. Validate the GitHub SHA-256 digest, size and AppImage header before atomic replacement at the existing path; preserve running work until the user closes and reopens the app. No new dependencies or release secrets.

### Features

* **updates:** add in-app GitHub release updates ([5904e2d](https://github.com/ItsAnunesS/agent-workbench/commit/5904e2d089634d48495b77f6d02579985807d260))

### Maintenance

* **release:** merge published version metadata ([b328ba3](https://github.com/ItsAnunesS/agent-workbench/commit/b328ba3091512e9922eb24bb7d7535803dd4e3ba))

## [0.10.0] - 2026-11-19

### Changed

- Subtle eye blinking across robot marks in Chat, Worker, project welcome screens and message avatars, including the interactive 3D rail logo. Preserve the original artwork and pointer tracking, respect reduced motion and pause 3D blinking in hidden windows.

### Features

* **branding:** add robot eye blinking ([970aa2b](https://github.com/ItsAnunesS/agent-workbench/commit/970aa2bc26078f2f8f57188a218cf9404237ef97))

## [0.9.2] - 2026-11-19

### Changed

- Reject dependency, configuration or source edits hidden inside a snapshot version patch before synchronizing it with newer commits.

### Bug Fixes

* **release:** validate snapshot manifest version patches ([91b541e](https://github.com/ItsAnunesS/agent-workbench/commit/91b541e8133e53db88c0e6a48b371b15af441278))

## [0.9.1] - 2026-11-19

### Changed

- Publish verified release snapshots even when newer commits arrive during the build, synchronizing version metadata without losing newer code, dependencies or unreleased notes, and retrying push races without rewriting history.
- Avoid duplicate release-branch AppImage builds, npm installs, type checks and release-tooling tests. Reuse release-profile Rust compilation and add Docker/npm/Cargo CI caches plus stage timings while retaining all test suites.

### Bug Fixes

* **release:** publish snapshots across concurrent pushes ([116ed20](https://github.com/ItsAnunesS/agent-workbench/commit/116ed20dc3d00bb082ac62a1c606193fd8775830))

## [0.9.0] - 2026-11-19

### Changed

- Removed the separate request-response link below Chat messages; sending a message through the composer remains the way to request a response.

### Added

- Automatic root AGENTS.md detection as project-specific workspace instructions for Chat and Worker, with source preview, refresh, lowercase fallback, bounded safe reads and per-request reloads. Global/manual settings remain separate and project rules cannot expand runtime permissions.
- Visible rename action beside conversation and task titles, sharing the existing sidebar rename dialog and persisted workspace names. Custom names are preserved when sending the first message.
- Usage panel with persisted, account/environment-scoped token counts from Chat, Worker and automatic approval reviews, daily history and recent reported responses. Missing counts remain unknown; cached/reasoning subsets are not double-counted. Plan allowance and credits link to the official ChatGPT usage page because the current connection does not expose those values.

### Features

* **chat:** expose conversation and task renaming ([b11fcea](https://github.com/ItsAnunesS/agent-workbench/commit/b11fcea9c29464685fd9f7928c9375c1b72a1d05))
* **settings:** detect project root AGENTS.md instructions ([862c4a8](https://github.com/ItsAnunesS/agent-workbench/commit/862c4a8bd89d08204ae6d5b1694b171d9a019e87))
* **usage:** track reported tokens by account and environment ([15d0671](https://github.com/ItsAnunesS/agent-workbench/commit/15d06711308b21410fd5ba84a3a27b48b4e4d08a))

### Bug Fixes

* **chat:** remove redundant response request action ([b3fc201](https://github.com/ItsAnunesS/agent-workbench/commit/b3fc2013362f6a0f784e0957546f9f87ee9a4614))

## [0.8.0] - 2026-11-19

### Added

- Automatic releases on pushes to `release`, using semantic-release Conventional Commit analysis, synchronized application versions, generated notes, immutable tags and draft-first AppImage publication. Planning receives GitHub Actions token authentication inside Docker. Documentation and maintenance changes also trigger patch releases; generated version commits do not recurse.
- Tabbed workspace tools with a dashboard, scoped recent pages, lazy project file tree and read-only text previews, Worker-run diff inspection and an expandable panel.
- Interactive local PTY terminal with bounded output flow, persistent global shell preferences and per-environment overrides, independent of the isolated AI Worker.
- Native integrated browser with persistent project/conversation profiles for cookies, cache and site storage, HTTP/HTTPS navigation and explicit denial of native IPC to remote pages.
- Native Xvfb/WebKit regression coverage for profile isolation, cookie persistence, IPC rejection and real PTY command input/output.
- Three.js 3D rail logo using the original artwork, with pointer-following eyes, subtle tilt, on-demand rendering, reduced-motion support and SVG fallback when WebGL is unavailable or lost.
- Persistent global AGENTS.md instructions and editable commit, pull request and branch naming conventions, applied to Chat and Worker across workspaces. Workspace settings now expose the selected project's folder and memory alongside its environment account and instructions.
- Separate global and workspace settings: application preferences and shared runtime in the rail settings button, with account and environment instructions in the OpenAI workspace card.
- Contribution guidance requiring documentation and changelog updates before committing or pushing changes.
- Inline assistant/Worker activity with public progress summaries and persisted elapsed time.
- Project accordions, separate unassigned conversations, and context actions for renaming, pinning, duplication, moving, archiving, restoring and deletion.
- Ask for approval and model-reviewed low-risk automatic approval modes, retaining Docker isolation and manual fallback.
- Application-wide English/Portuguese localization with English defaults, persistent language selection, localized native API errors, Worker statuses and authentication callback pages.
- Standard AppImage update metadata for Gear Lever and AppImageUpdate, with verified `.zsync` indexes included in CI artifacts and GitHub Releases.
- Root-level `LICENSE-BRAND.md` for original images and visual identity terms.
- Explicit restrictions on republication of original images and brand assets, including both downloadable brand kits.
- English and Portuguese brand kit downloads with localized PDF guides and interface examples.
- English and pt-BR documentation, contribution and security policies.
- MIT licensing for source code, with reserved rights for original branding and separate third-party notices.
- Docker-based GitHub Actions builds, manual version publication and Conventional Commit checks.
- A small `dev` / `release` workflow with direct fixes supported.

### Features

* **app:** localize and improve chat and project workflows ([cae947e](https://github.com/ItsAnunesS/agent-workbench/commit/cae947e8e5017d57e7f127bf9b805a75e8e44b9e))
* **branding:** add ICO favicon fallback ([96a2ee3](https://github.com/ItsAnunesS/agent-workbench/commit/96a2ee3060ecbe3a626873a9bfe130c3a8d83fe7))
* **branding:** add interactive Three.js logo ([e200757](https://github.com/ItsAnunesS/agent-workbench/commit/e2007578536bd4b40445e85374a89ea74f189bd0))
* **linux:** support AppImage updates in compatible managers ([03ccd34](https://github.com/ItsAnunesS/agent-workbench/commit/03ccd340bfe1463f6ef35ccc4db4019fbbf468f1))
* **settings:** add global instructions and Git conventions ([ade1baf](https://github.com/ItsAnunesS/agent-workbench/commit/ade1baf3c635d956a8109ec8cf2fe2aeaaa9e8ba))
* **tools:** add scoped files, terminal and browser tabs ([127e4c8](https://github.com/ItsAnunesS/agent-workbench/commit/127e4c8b77aa2fb0468d529e6582ada8e9706693))

### Bug Fixes

* **branding:** correct favicon declarations and refresh cache ([7f77ad3](https://github.com/ItsAnunesS/agent-workbench/commit/7f77ad3708ce73cfeacd2d1b5a7dd86c0d3d534b))
* **branding:** restore original favicon configuration ([e532bba](https://github.com/ItsAnunesS/agent-workbench/commit/e532bba877c5af204345e4b51074b32d01da3017))
* **release:** forward GitHub Actions token context to Docker ([36ece18](https://github.com/ItsAnunesS/agent-workbench/commit/36ece184c6865ba761479fe4b3a41f8c3a596df4))
* **settings:** separate global and workspace preferences ([e871934](https://github.com/ItsAnunesS/agent-workbench/commit/e871934444cf610fe516668e44766dafb9a53be7))

### Documentation

* add project guides and reserved brand licensing ([1549cd4](https://github.com/ItsAnunesS/agent-workbench/commit/1549cd4756efa0a58770b3d949aa533c1ec3d04b))
* **branding:** add English kit and localized downloads ([ca9ec2e](https://github.com/ItsAnunesS/agent-workbench/commit/ca9ec2e8749f075c3e92c3514aa3e19fe48b8fca))
* **contributing:** require documentation updates before delivery ([9d0ad7a](https://github.com/ItsAnunesS/agent-workbench/commit/9d0ad7ac9e68ba44b30d3e6942ede4b37d520ae6))
* **license:** adopt MIT for source code ([829daee](https://github.com/ItsAnunesS/agent-workbench/commit/829daee59ddb2f32763626266a4750941185e401))
* **license:** move brand terms to repository root ([2d2a219](https://github.com/ItsAnunesS/agent-workbench/commit/2d2a219056b587a0bc8ad41e88e87c0ea9b00ee6))
* **license:** prohibit republication of original brand assets ([ec277eb](https://github.com/ItsAnunesS/agent-workbench/commit/ec277ebf7c91743c039567d7b1a58658e0e494f4))
* **readme:** add status badges and flag language buttons ([e11d329](https://github.com/ItsAnunesS/agent-workbench/commit/e11d329fc9a7b6fadb36763940b129e1eb2bd045))

### Continuous Integration

* add Docker builds and versioned release workflows ([e4616b5](https://github.com/ItsAnunesS/agent-workbench/commit/e4616b5c470ddfbab0119f3d33af0f92ef2b9917))
* **release:** publish versioned builds automatically ([bfad457](https://github.com/ItsAnunesS/agent-workbench/commit/bfad45756f352aa4dd2d8baa7357bff964dddff4))

### Maintenance

* remove Dependabot configuration ([049f32b](https://github.com/ItsAnunesS/agent-workbench/commit/049f32b4fb1ae1ef2a83e7297efede918fe3907c))

## [0.7.0] - 2026-11-18

### Added

- Native PNG, ICO and ICNS icon assets.
- Automatic per-user Linux launcher registration, integration repair and aligned GTK / Wayland application identity.

## [0.6.0] - 2026-11-18

### Changed

- Replaced the native title bar with integrated drag, minimize, maximize and close controls.

## [0.5.0] - 2026-11-18

### Added

- Neutral dark and warm light themes, system appearance and persisted selection.
- Theme-aware wordmarks and login callback styling.

## [0.4.0] - 2026-11-18

### Added

- Codex Worker execution in a Docker container scoped to the selected project.
- One-time approvals, cancellation, activity, file diffs and task history.
- Host-side model transport that keeps OpenAI credentials outside the container.

## [0.3.0] - 2026-11-18

### Changed

- Applied the orange robot identity, local fonts, app icons and account/login design.

## [0.2.0] - 2026-11-18

### Added

- OpenAI account connections per environment, model selection and streaming Chat.

## [0.1.0] - 2026-11-18

### Added

- Tauri desktop shell, environments, projects, local context and SQLite persistence.
- Separate Chat and Worker histories with explicit handoff.
