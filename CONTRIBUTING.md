# Contributing

Small changes, clear commits and checks that exercise the changed behavior. This is a small, maintainer-led project; there is no mandatory Gitflow or release branch hierarchy.

## Workflow

- Use `dev` for regular work. Short-lived branches are optional.
- Open external contributions against `dev`. Use `release` for an agreed urgent fix.
- The maintainer may push directly to either branch. CI still runs.
- Merge tested changes from `dev` into `release`.
- After a direct fix or version bump on `release`, merge it back into `dev`. Do not force-push either shared branch.

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

It runs TypeScript checks, Vitest and Rust tests before packaging. The UI regression scripts under `scripts/ui-*.cjs` use Playwright and the Vite server; they use fixtures instead of real OpenAI credentials. `scripts/worker-smoke.py` exercises the real Codex container with synthetic model responses.

Do not add credentials, local databases, build caches, generated bundles or private project data to commits. Do not weaken approvals or isolation to make a test pass. Ask before adding dependencies or changing authentication contracts.

## Publishing

1. Ensure the intended changes are on `release` and its Build workflow is green.
2. Open **Actions > Publish release > Run workflow**, selecting branch `release`.
3. Choose `current` to publish the version already in the repository, or `patch`, `minor` or `major` to create a new version. Initial publication uses `current`.
4. The workflow updates `package.json`, the npm lockfile, Cargo package/lock versions, Tauri configuration and the changelog. It builds and tests before pushing the version commit and tag.
5. The release includes the AppImage, its `.zsync` index and `SHA256SUMS`. Keep both update assets together with their generated names; managers use the embedded `gh-releases-zsync` source to find the latest stable version. The build rejects missing update metadata or an index that does not match the AppImage.
6. Download the AppImage from GitHub Releases. Merge `release` back into `dev` after a version commit.

Tags use `vX.Y.Z` and are not moved. If `release` changes while the workflow is building, publication stops rather than attaching a build to the wrong commit. If a tag was pushed but the GitHub Release failed, rerun with `current` at that same tagged commit.

Every push also has its own build artifact. A build artifact is not a published version, and documentation-only changes do not automatically consume version numbers.

## Rights

Source-code contributions are submitted under the project's MIT license. Contribute only material you have the right to submit. The robot, name, logos, icons, original images and brand geometry remain reserved under [the brand license](LICENSE-BRAND.md), including when embedded in source files or generation scripts. MIT does not grant rights to reuse those assets. Third-party font licenses remain unchanged.
