import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { Writable } from "node:stream";
import { analyzeRelease } from "./release-policy.mjs";
import { planRelease } from "./plan-release.mjs";

const logger = { log() {}, error() {}, warn() {}, success() {} };
test("Conventional Commits select major/minor/patch and release docs and maintenance", async () => {
  for (const [message, expected] of [
    ["feat(branding): add interactive Three.js logo", "minor"],
    ["fix(settings): repair routing", "patch"],
    ["docs: update guide", "patch"],
    ["chore: maintain tooling", "patch"],
    ["ci: update workflow", "patch"],
    ["feat!: replace public API", "major"],
    ["fix: change contract\n\nBREAKING CHANGE: replace fields", "major"],
  ]) {
    assert.equal(
      await analyzeRelease(
        {},
        {
          cwd: process.cwd(),
          logger,
          commits: [{ hash: "a".repeat(40), message }],
        },
      ),
      expected,
    );
  }
  assert.equal(
    await analyzeRelease(
      {},
      {
        cwd: process.cwd(),
        logger,
        commits: [{ hash: "b".repeat(40), message: "chore(release): v1.2.3" }],
      },
    ),
    null,
  );
  assert.equal(
    await analyzeRelease({}, { cwd: process.cwd(), logger, commits: [] }),
    null,
  );
});

test("semantic-release plans from real tags without pushing tags or version commits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "awb-release-"));
  const cwd = join(directory, "work");
  const remote = join(directory, "remote.git");
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^(CI$|GITHUB_|GH_TOKEN$|GIT_CONFIG_)/.test(key)) delete env[key];
  Object.assign(env, {
    GIT_AUTHOR_NAME: "Release fixture",
    GIT_AUTHOR_EMAIL: "release@example.test",
    GIT_COMMITTER_NAME: "Release fixture",
    GIT_COMMITTER_EMAIL: "release@example.test",
  });
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    await mkdir(cwd);
    execFileSync("git", ["init", "--bare", remote], { env, stdio: "ignore" });
    execFileSync(
      "git",
      ["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/release"],
      { env, stdio: "ignore" },
    );
    git("init", "-b", "release");
    const repositoryUrl = "https://github.com/example/release-fixture.git";
    git("remote", "add", "origin", repositoryUrl);
    git("config", `url.${remote}.insteadOf`, repositoryUrl);
    await writeFile(join(cwd, ".gitignore"), "node_modules\n");
    await symlink(resolve("node_modules"), join(cwd, "node_modules"), "dir");
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "release-fixture",
        version: "0.7.0",
        private: true,
      }),
    );
    git("add", ".");
    git("commit", "-m", "chore: initial version");
    git("tag", "v0.7.0");
    git("push", "-u", "origin", "release", "--tags");
    git(
      "commit",
      "--allow-empty",
      "-m",
      "feat(branding): add interactive Three.js logo",
    );
    git("push", "origin", "release");
    const before = git("rev-parse", "HEAD");
    const tags = git("tag");
    const sink = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const result = await planRelease({ cwd, env, stdout: sink, stderr: sink });
    assert.equal(result.release, true);
    assert.equal(result.version, "0.8.0");
    assert.equal(result.tag, "v0.8.0");
    assert.match(result.notes, /interactive Three\.js logo/);
    assert.equal(result.sourceSha, before);
    assert.equal(git("rev-parse", "HEAD"), before);
    assert.equal(git("tag"), tags);
    assert.equal(
      git("ls-remote", "--heads", "origin", "release").split(/\s/)[0],
      before,
    );
    const repeated = await planRelease({
      cwd,
      env,
      stdout: sink,
      stderr: sink,
    });
    assert.equal(repeated.version, result.version);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "release-fixture",
        version: "0.8.0",
        private: true,
      }),
    );
    git("add", "package.json");
    git("commit", "-m", "chore(release): v0.8.0");
    git("tag", "v0.8.0");
    const releasedSnapshot = git("rev-parse", "HEAD");
    git("checkout", "--detach", before);
    git("commit", "--allow-empty", "-m", "fix: retain a newer source change");
    git("merge", "--no-ff", "--no-commit", "-s", "ours", releasedSnapshot);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "release-fixture",
        version: "0.8.0",
        private: true,
      }),
    );
    git("add", "package.json");
    git("commit", "-m", "chore(release): v0.8.0");
    git("checkout", "-B", "release");
    git("push", "origin", "release", "--tags");
    const followup = await planRelease({
      cwd,
      env,
      stdout: sink,
      stderr: sink,
    });
    assert.equal(followup.version, "0.8.1");
    assert.match(followup.notes, /retain a newer source change/);
    assert.doesNotMatch(followup.notes, /chore\(release\)/);
    const synchronizedTags = git("tag");
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "release-fixture",
        version: "0.6.0",
        private: true,
      }),
    );
    await assert.rejects(
      planRelease({ cwd, env, stdout: sink, stderr: sink }),
      /latest reachable release tag/,
    );
    assert.equal(git("tag"), synchronizedTags);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
