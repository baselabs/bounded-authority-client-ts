// The CI push filter must never skip a push that changes a file a check reads. The filter lives in
// .github/workflows/ci.yml (on.push.paths); the files the checks read are listed once in
// tools/checked-files.mjs, which the checks themselves import.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PACK_REQUIRED, checkedDocs, sampleDocs } from "../tools/checked-files.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The `on.push.paths` list of a workflow (a small reader for this file's block style). */
export function pushPaths(yaml: string): string[] {
  const lines = yaml.split("\n");
  const push = lines.findIndex((l) => /^ {2}push:\s*$/.test(l));
  assert.ok(push >= 0, "the workflow has an on.push block");
  const out: string[] = [];
  let inPaths = false;
  for (const line of lines.slice(push + 1)) {
    if (/^ {0,2}\S/.test(line)) break; // the next key of `on:` (or a top-level key) ends the block
    if (/^ {4}paths-ignore:/.test(line)) assert.fail("use on.push.paths; paths-ignore cannot re-include a file");
    if (/^ {4}\S/.test(line)) inPaths = /^ {4}paths:\s*$/.test(line);
    const item = inPaths ? /^ {6}- "([^"]+)"\s*$/.exec(line) : null;
    if (item) out.push(item[1]!);
  }
  return out;
}

/** GitHub's filter glob: `*` stays within a path segment, `**` crosses segments. */
function globRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Whether a push changing `file` runs the workflow: patterns apply in order, the last match wins. */
export function triggers(patterns: readonly string[], file: string): boolean {
  let included = false;
  for (const p of patterns) {
    const negated = p.startsWith("!");
    if (globRegExp(negated ? p.slice(1) : p).test(file)) included = !negated;
  }
  return included;
}

const workflow = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
const patterns = pushPaths(workflow);
const checked = [...new Set([...checkedDocs(ROOT), ...sampleDocs(ROOT), ...PACK_REQUIRED])].sort();

test("ci paths: the reader and matcher work (known-positive probes)", () => {
  assert.deepEqual(pushPaths('on:\n  push:\n    branches: [main]\n    paths:\n      - "**"\n      - "!x"\n  pull_request:\n'), ["**", "!x"]);
  assert.ok(patterns.length > 0, "the CI workflow has a push paths filter");
  assert.ok(triggers(["**"], "src/index.ts"));
  assert.ok(!triggers(["**", "!**/*.md"], "README.md"), "**/*.md covers a root file");
  assert.ok(!triggers(["**", "!**/*.md"], "docs/a/b.md"));
  assert.ok(triggers(["**", "!**/*.md", "docs/**"], "docs/a/b.md"), "a later pattern re-includes");
  assert.ok(!triggers(["**", "!**/*.md", "docs/**", "!docs/**"], "docs/api.md"));
  assert.ok(!triggers(["*.md"], "docs/api.md"), "* stays within one segment");
});

test("ci paths: the check lists are the real ones (not empty)", () => {
  for (const f of ["README.md", "docs/api.md", "docs/guides.md", "docs/req2-projection.md", "CHANGELOG.md", "LICENSE", "package.json"]) {
    assert.ok(checked.includes(f), f);
  }
});

test("ci paths: no file a check reads is excluded from the push filter", () => {
  assert.deepEqual(checked.filter((f) => !triggers(patterns, f)), []);
});

test("ci paths: source changes run CI, and Markdown no check reads stays skipped", () => {
  for (const f of ["src/index.ts", "test/vectors/reauthorization-req2.json", "package.json", "pnpm-lock.yaml", ".github/workflows/ci.yml", "tools/check-install.mjs"]) {
    assert.ok(triggers(patterns, f), f);
  }
  for (const f of ["CONTRIBUTING.md", "notes/plan.md"]) assert.ok(!triggers(patterns, f), f);
});
