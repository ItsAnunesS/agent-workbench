import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const pattern =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^()\r\n]+\))?!?: \S[^\r\n]*$/u;
const args = process.argv.slice(2);
let subjects;
if (args[0] === "--file")
  subjects = [readFileSync(args[1], "utf8").split(/\r?\n/u)[0]];
else if (args[0] === "--title-env") subjects = [process.env[args[1]] || ""];
else if (args[0] === "--range") {
  const [before, after] = args.slice(1);
  if (![before, after].every((value) => /^[a-f\d]{40,64}$/u.test(value)))
    throw new Error("Invalid commit range");
  const range = /^0+$/u.test(before) ? ["-1", after] : [`${before}..${after}`];
  subjects = execFileSync(
    "git",
    ["log", "--no-merges", "--format=%s", ...range],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
} else
  throw new Error("Use --file PATH, --title-env NAME or --range BEFORE AFTER");
const invalid = subjects.filter((subject) => !pattern.test(subject));
if (invalid.length) {
  console.error(
    "Use Conventional Commits, for example: fix(worker): handle cancellation",
  );
  for (const subject of invalid) console.error(`Invalid subject: ${subject}`);
  process.exit(1);
}
