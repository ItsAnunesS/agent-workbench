import semanticRelease from "semantic-release";
import { generateNotes } from "@semantic-release/release-notes-generator";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  analyzeRelease,
  notesOptions,
  releaseCommits,
} from "./release-policy.mjs";

export async function planRelease({
  cwd = process.cwd(),
  env = process.env,
  stdout = process.stderr,
  stderr = process.stderr,
} = {}) {
  const result = await semanticRelease(
    {
      branches: ["release"],
      tagFormat: "v${version}",
      dryRun: true,
      ci: false,
      plugins: [
        { analyzeCommits: analyzeRelease },
        {
          generateNotes: (options, context) =>
            generateNotes(notesOptions, {
              ...context,
              commits: releaseCommits(context.commits),
            }),
        },
      ],
    },
    { cwd, env, stdout, stderr },
  );
  if (!result) return { release: false };
  const current = JSON.parse(
    await readFile(resolve(cwd, "package.json"), "utf8"),
  ).version;
  if (result.lastRelease.version !== current)
    throw new Error(
      "The repository version must match its latest reachable release tag before automatic publication.",
    );
  return {
    release: true,
    version: result.nextRelease.version,
    tag: result.nextRelease.gitTag,
    type: result.nextRelease.type,
    notes: result.nextRelease.notes,
    sourceSha: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
    }).trim(),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [flag, filename] = process.argv.slice(2);
  if (flag !== "--plan" || !filename)
    throw new Error("Usage: node scripts/plan-release.mjs --plan <file>");
  const plan = await planRelease();
  await writeFile(filename, JSON.stringify(plan, null, 2) + "\n");
  if (process.env.GITHUB_OUTPUT) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.GITHUB_OUTPUT, `release=${plan.release}\n`);
  }
}
