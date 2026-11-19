# Contributing

Small changes, clear commits and checks that exercise the changed behavior. This is a small, maintainer-led project; there is no mandatory Gitflow or release branch hierarchy.

## Workflow

- Use `dev` for regular work. Short-lived branches are optional.
- Open external contributions against `dev`. Use `release` for an agreed urgent fix.
- The maintainer may push directly to either branch. CI still runs.
- Merge tested changes from `dev` into `release`.
- After a direct fix or version bump on `release`, merge it back into `dev`. Do not force-push either shared branch.
- Before committing or pushing, update the affected documentation and `CHANGELOG.md` to reflect the final change. Keep the English and pt-BR READMEs synchronized when user-facing behavior changes, and include documentation and changelog updates in the same commit as the behavior they describe.

## Commits and PRs

Use Conventional Commits for commit subjects and PR titles:

```text
feat(worker): add task cancellation
fix(linux): register the application icon
ci(release): attach AppImage checksums
docs(readme): update the installation steps
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. A scope is optional. Mark breaking changes with `!` or a `BREAKING CHANGE:` footer.

Enable the local commit hook once per clone. It uses Node.js when installed, or the existing Docker builder image:

```sh
git config core.hooksPath .githooks
```

PRs should explain the problem, resulting behavior and validation. Include screenshots for visual changes and update the English and pt-BR READMEs together when user-facing instructions change. Record notable behavior changes under `Unreleased` in `CHANGELOG.md`.

## Checks

Prefer the Docker build used by CI:

```sh
bash scripts/build-appimage.sh
```

It runs Vitest, release tooling tests, version/AppImage metadata tests and Rust tests sharing release-profile dependencies, then type-checks once during the production frontend build before packaging. CI caches the Docker builder, npm downloads, Cargo registry and the release target directory, excluding bundles. `release` installs dependencies once before planning and reuses them for validation/build. Application test code uses Cargo package overrides for optimization level 0, 256 codegen units, debug assertions and overflow checks; production build options remain unchanged. No test suite is skipped. Timed log groups show which stages spend time compiling or packaging; cold caches still require dependency compilation. The UI regression scripts under `scripts/ui-*.cjs` use Playwright and the Vite server; they use fixtures instead of real OpenAI credentials. `scripts/worker-smoke.py` exercises the real Codex container with synthetic model responses.

Do not add credentials, local databases, build caches, generated bundles or private project data to commits. Do not weaken approvals or isolation to make a test pass. Ask before adding dependencies or changing authentication contracts.

For native browser or terminal changes, also run `bash scripts/test-native-tools.sh` in the Docker builder. It creates a temporary Xvfb display and disposable XDG data/config/cache directories, then runs the native WebKit/PTY smoke test with synthetic local pages. In Docker, pass `-e WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1` to the test container when WebKit cannot create its nested sandbox; this flag is only for that test process. Run `scripts/ui-tools.cjs` against Vite with Playwright to validate the tool tabs, file previews, diffs, terminal lifecycle and shell configuration interface.

Keep identifiers, database names, code comments and canonical system messages in English. User-facing text belongs in `src/locales/en.json` and `src/locales/pt.json`, including native errors and authentication pages. Use complete messages with named placeholders. Native commands accept an optional `locale` (`en` or `pt`) and default to English; the frontend passes its saved preference. Persist canonical messages and localize response copies so language changes do not rewrite user data. Keep both catalogs in sync and run the i18n tests when adding messages.

## Publishing

1. Push tested changes to `release`. **Publish release** starts automatically; `dev` pushes and pull requests do not publish versions.
2. `semantic-release` runs in planning mode, without writing tags or publishing packages. It selects major for breaking changes, minor for features, and patch for other commits, including docs, CI and maintenance. Multiple commits in a push produce one version using their highest increment. Keep repository versions aligned with the latest reachable version tag.
3. `scripts/version.py` applies the planned version to `package.json`, the npm lockfile, Cargo package/lock versions, Tauri configuration and the changelog. Handwritten `Unreleased` entries are preserved and combined with generated commit notes.
4. The workflow builds and tests an immutable source snapshot before atomically pushing its tag and synchronizing version metadata into `release`. If newer commits arrived, a version-only merge preserves them and makes the snapshot tag reachable for the next semantic-release plan. It uploads assets to a draft release before making it public. Its `chore(release): v...` commits are excluded from automatic publication to avoid loops; the normal `GITHUB_TOKEN` also suppresses recursive push-triggered workflows.
5. The release includes the AppImage, its `.zsync` index and `SHA256SUMS`. Keep both update assets together with their generated names; managers use the embedded `gh-releases-zsync` source to find the latest stable version. The build rejects missing update metadata or an index that does not match the AppImage.
6. Download the AppImage from GitHub Releases. Merge `release` back into `dev` after a version commit.

Tags use `vX.Y.Z` and are not moved. If `release` changes while the workflow is building, the in-flight snapshot still publishes. `scripts/publish-version.py` uses an isolated worktree to synchronize metadata and released changelog entries with the newest head, preserving newer source/dependency changes and pending notes. It retries concurrent pushes and never force-pushes; tags continue to identify exactly the source and version that were built. The queued workflow handles the new head, with GitHub coalescing pending runs when pushes arrive quickly. For manual control, open **Actions > Publish release > Run workflow** on `release` and select `auto`, `patch`, `minor` or `major`. If a tag was pushed but publication failed, run with `current`; the workflow selects the current version tag before rebuilding that snapshot. Draft uploads can be retried; already published assets are retained unchanged. No npm publishing or extra repository secrets are used. The planning container receives the normal `GITHUB_TOKEN` and GitHub Actions context explicitly so semantic-release uses GitHub App token authentication without relying on checkout credential files outside the container.

`dev` and PR builds upload commit artifacts. The release publisher uploads its verified snapshot artifact and performs the full build once, instead of also running the Build workflow for release pushes. Documentation-only pushes to `release` now produce patch releases. Run `npm run test:release` inside Docker when changing the policy, version synchronization or workflows; its Git fixtures verify read-only planning, publication after branch advancement, retries during a push race, immutable snapshot tags, preserved newer dependencies/notes, idempotent retries and the next version plan after synchronization.

## Rights

Source-code contributions are submitted under the project's MIT license. Contribute only material you have the right to submit. The robot, name, logos, icons, original images and brand geometry remain reserved under [the brand license](LICENSE-BRAND.md), including when embedded in source files or generation scripts. MIT does not grant rights to reuse those assets. Third-party font licenses remain unchanged.
