# Changelog

Notable changes are recorded here. Versions use Semantic Versioning. Entries before the first public tag describe local builds produced during development.

## [Unreleased]

### Added

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
