// The CI push filter must not skip a push that changes anything a check reads. The filter is
// on.push.paths in .github/workflows/ci.yml, read here with a real YAML parser. Every tracked
// file (`git ls-files`) must run CI, except the Markdown no check reads; the files the checks read
// are listed once in tools/checked-files.mjs, which the checks themselves import.
//
// GitHub's filter rules, from "Workflow syntax for GitHub Actions", sections "on.push.paths" and
// "Filter pattern cheat sheet" (https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax,
// read October 14, 2026):
//   - "`*`: Matches zero or more characters, but does not match the `/` character."
//   - "`**`: Matches zero or more of any character." The page's examples also show `**/` matching
//     zero directories ('**/README.md' matches `README.md`; 'docs/**/*.md' matches
//     `docs/README.md`). Nothing on the page excludes names that start with a dot, so this test
//     treats `**` as matching `.github/workflows/ci.yml` like any other path; the page has no
//     example with a dot directory, and no live run has isolated that case.
//   - "`?`: Matches zero or one of the preceding character." "`+`: Matches one or more of the
//     preceding character." "`[]` Matches one alphanumeric character listed in the brackets or
//     included in ranges."
//   - "Patterns are checked sequentially. A pattern that negates a previous pattern will re-include
//     file paths." A later match decides.
//   - The diff limit: "If the generated diff contains more than 3,000 files and the files the
//     workflow filter matches are not in the first 3,000 returned by the filter, the workflow will
//     not run." A push that large is outside what this test can check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { PACK_REQUIRED, checkedDocs } from "../tools/checked-files.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The on.push.paths list of a workflow. paths-ignore is refused: it cannot re-include a file. */
export function pushPaths(yamlText: string): string[] {
  const doc = parse(yamlText) as { on?: { push?: { paths?: unknown; "paths-ignore"?: unknown } } };
  const push = doc.on?.push;
  assert.ok(push !== undefined && push !== null, "the workflow has an on.push trigger");
  assert.equal(push["paths-ignore"], undefined, "use on.push.paths; paths-ignore cannot re-include a file");
  const paths = push.paths;
  assert.ok(Array.isArray(paths) && paths.every((p) => typeof p === "string"), "on.push.paths is a list of strings");
  return paths as string[];
}

/** One GitHub filter pattern (without its leading `!`) as a regular expression. */
export function globRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*" && glob[i + 2] === "/") {
      re += "(?:.*/)?"; // zero or more directories: the docs' '**/README.md' matches README.md
      i += 2;
    } else if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "?";
    else if (c === "+") re += "+";
    else if (c === "[") {
      const end = glob.indexOf("]", i);
      assert.ok(end > i, `unclosed [ in ${glob}`);
      re += glob.slice(i, end + 1);
      i = end;
    } else re += c.replace(/[.^${}()|\\/]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Whether a push that changes `file` runs the workflow: patterns apply in order, a later match decides. */
export function triggers(patterns: readonly string[], file: string): boolean {
  let included = false;
  for (const p of patterns) {
    const negated = p.startsWith("!");
    if (globRegExp(negated ? p.slice(1) : p).test(file)) included = !negated;
  }
  return included;
}

const workflow = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter((f) => f !== "");
const checked = new Set([...checkedDocs(ROOT), ...PACK_REQUIRED]);
// Markdown no check reads: the only files a push may change without running CI.
const unreadMarkdown = (file: string): boolean => file.endsWith(".md") && !checked.has(file);

test("ci paths: the parser and matcher follow GitHub's rules (known-positive probes)", () => {
  assert.deepEqual(pushPaths('on:\n  push:\n    branches: [main]\n    paths:\n      - "**"\n      # a comment\n      - \'!x\'\n  pull_request:\n'), ["**", "!x"]);
  assert.throws(() => pushPaths('on:\n  push:\n    paths-ignore:\n      - "docs/**"\n'));
  assert.ok(triggers(["**"], ".github/workflows/ci.yml"), "** matches a dot directory");
  assert.ok(triggers(["**"], ".gitignore"), "** matches a dotfile");
  // The rows of the docs' "Patterns to match file paths" table, with their listed matches.
  const table: [string, string[]][] = [
    ["**", ["all/the/files.md"]],
    ["**.js", ["index.js", "js/index.js", "src/js/app.js"]],
    ["docs/**", ["docs/README.md", "docs/mona/octocat.txt"]],
    ["docs/**/*.md", ["docs/README.md", "docs/mona/hello-world.md", "docs/a/markdown/file.md"]],
    ["**/docs/**", ["docs/hello.md", "dir/docs/my-file.txt", "space/docs/plan/space.doc"]],
    ["**/README.md", ["README.md", "js/README.md"]],
    ["**/*src/**", ["a/src/app.js", "my-src/code/js/app.js"]],
    ["**/*-post.md", ["my-post.md", "path/their-post.md"]],
    ["**/migrate-*.sql", ["migrate-10909.sql", "db/migrate-v1.0.sql", "db/sept/migrate-v1.sql"]],
  ];
  for (const [pattern, matches] of table) for (const f of matches) assert.ok(triggers([pattern], f), `${pattern} matches ${f}`);
  assert.ok(!triggers(["**", "!**/*.md"], "README.md"), "**/*.md covers a root file");
  assert.ok(triggers(["*.md"], "README.md") && !triggers(["*.md"], "docs/api.md"), "* stays within one segment");
  assert.ok(triggers(["**", "!**/*.md", "docs/**"], "docs/a/b.md"), "a later pattern re-includes");
  assert.ok(!triggers(["**", "!docs/**"], "docs/api.md"));
  assert.ok(triggers(["docs/ap?i.md"], "docs/api.md") && triggers(["docs/ap?i.md"], "docs/ai.md"), "? makes the preceding character optional");
  assert.ok(triggers(["v[0-9]+.md"], "v12.md") && !triggers(["v[0-9]+.md"], "v.md"), "+ and [] as documented");
  assert.ok(tracked.includes("src/index.ts") && tracked.includes(".github/workflows/ci.yml"), "git ls-files sees the tree");
});

test("ci paths: every tracked file except unread Markdown runs CI", () => {
  const patterns = pushPaths(workflow);
  const skipped = tracked.filter((f) => !unreadMarkdown(f) && !triggers(patterns, f));
  assert.deepEqual(skipped, []);
});

test("ci paths: every file a check reads runs CI, tracked or built", () => {
  const patterns = pushPaths(workflow);
  assert.ok(checked.has("README.md") && checked.has("docs/api.md") && checked.has("LICENSE"), "the check lists are the real ones");
  assert.deepEqual([...checked].filter((f) => !triggers(patterns, f)), []);
});

test("ci paths: Markdown no check reads stays skipped", () => {
  const patterns = pushPaths(workflow);
  for (const f of ["CONTRIBUTING.md", "notes/plan.md", ...tracked.filter(unreadMarkdown)]) assert.ok(!triggers(patterns, f), f);
});
