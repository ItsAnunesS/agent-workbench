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

export async function analyzeRelease(_options, context) {
  // Even a net-reverted batch gets a patch: every release-branch push is publishable.
  return (
    (await analyzeCommits(commitOptions, context)) ||
    (context.commits.length ? "patch" : null)
  );
}
