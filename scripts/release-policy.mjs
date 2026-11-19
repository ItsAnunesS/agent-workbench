import { analyzeCommits } from "@semantic-release/commit-analyzer";

export const commitOptions = {
  preset: "conventionalcommits",
  releaseRules: [
    { breaking: true, release: "major" },
    { type: "feat", release: "minor" },
    { release: "patch" },
  ],
};

export const notesOptions = {
  preset: "conventionalcommits",
  presetConfig: {
    types: [
      ["feat", "Features"],
      ["fix", "Bug Fixes"],
      ["perf", "Performance"],
      ["refactor", "Refactoring"],
      ["docs", "Documentation"],
      ["test", "Tests"],
      ["build", "Build"],
      ["ci", "Continuous Integration"],
      ["chore", "Maintenance"],
      ["style", "Style"],
      ["revert", "Reverts"],
    ].map(([type, section]) => ({ type, section, hidden: false })),
  },
};

export function releaseCommits(commits) {
  return commits.filter(
    ({ message }) => !/^chore\(release\): v\d+\.\d+\.\d+(?:\s|$)/.test(message),
  );
}

export async function analyzeRelease(_options, context) {
  const commits = releaseCommits(context.commits);
  // Even a net-reverted batch gets a patch: every release-branch push is publishable.
  return (
    (await analyzeCommits(commitOptions, { ...context, commits })) ||
    (commits.length ? "patch" : null)
  );
}
