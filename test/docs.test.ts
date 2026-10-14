// The documentation runs as written. Every ```ts fence in README.md and docs/*.md is executed
// against src/ (its "@bounded-authority/client" import is pointed at src/index.ts), and every
// `// prints: <text>` comment in a sample must equal, in order, the lines the sample logs.
// Every relative link and its #anchor must resolve. tools/check-install.mjs runs the README
// quickstart again against the packed tarball installed the way a reader installs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format } from "node:util";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PACKAGE = "@bounded-authority/client";
const SRC_ENTRY = pathToFileURL(join(ROOT, "src", "index.ts")).href;
// Inside node_modules so the samples resolve the verifier package the way the repo does.
const WORK = join(ROOT, "node_modules", ".cache", "doc-samples");

const DOCS = [
  "README.md",
  ...readdirSync(join(ROOT, "docs")).filter((f) => f.endsWith(".md")).sort().map((f) => `docs/${f}`),
  "test/browser/README.md",
  "CHANGELOG.md",
];

export interface Sample {
  readonly doc: string;
  readonly line: number;
  readonly code: string;
}

/** Every ```ts (or ```typescript) fence in a Markdown text. */
export function extractSamples(doc: string, markdown: string): Sample[] {
  const out: Sample[] = [];
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/^```(ts|typescript)\s*$/.test(lines[i]!)) continue;
    const start = i + 1;
    let end = start;
    while (end < lines.length && !/^```\s*$/.test(lines[end]!)) end++;
    out.push({ doc, line: start, code: lines.slice(start, end).join("\n") });
    i = end;
  }
  return out;
}

/** The `// prints: <text>` comments of a sample, in order. */
export const expectedOutput = (code: string): string[] =>
  [...code.matchAll(/\/\/ prints: (.*)$/gm)].map((m) => m[1]!.trimEnd());

const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const samples = DOCS.flatMap((doc) => extractSamples(doc, read(doc)));

test("docs: the scan finds the samples (a scan of zero samples is a vacuous pass)", () => {
  assert.ok(samples.some((s) => s.doc === "README.md"), "README.md has a ts sample");
  assert.ok(samples.some((s) => s.doc === "docs/api.md"), "docs/api.md has ts samples");
  assert.ok(samples.some((s) => s.doc === "docs/guides.md"), "docs/guides.md has ts samples");
  // Known-positive probe of the extractor and the prints parser.
  const probe = extractSamples("probe", "x\n```ts\nconsole.log(1); // prints: 1\n```\n```bash\nls\n```\n");
  assert.deepEqual(probe.map((s) => s.code), ["console.log(1); // prints: 1"]);
  assert.deepEqual(expectedOutput(probe[0]!.code), ["1"]);
});

for (const sample of samples) {
  test(`docs: ${sample.doc}:${sample.line} runs and prints what its comments say`, async () => {
    assert.ok(sample.code.includes(`from "${PACKAGE}"`), "the sample imports the package by its name");
    const expected = expectedOutput(sample.code);
    assert.ok(expected.length > 0, "the sample states its output in // prints: comments");

    mkdirSync(WORK, { recursive: true });
    const file = join(WORK, `${sample.doc.replace(/[^A-Za-z0-9]+/g, "-")}-${sample.line}.mts`);
    writeFileSync(file, sample.code.split(`from "${PACKAGE}"`).join(`from "${SRC_ENTRY}"`));

    const logged: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { logged.push(format(...args)); };
    try {
      await import(pathToFileURL(file).href);
    } finally {
      console.log = original;
    }
    assert.deepEqual(logged, expected);
  });
}

// ---- links ----------------------------------------------------------------------------------

/** GitHub's heading anchors: lowercase, punctuation dropped, spaces to hyphens, repeats numbered. */
export function anchorsOf(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^```/.test(line)) fenced = !fenced;
    const m = !fenced && /^#{1,6} (.*)$/.exec(line);
    if (!m) continue;
    const base = m[1]!.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

/** Relative links of a Markdown file that do not resolve to a file or to a heading anchor. */
export function brokenLinks(doc: string, markdown: string, root: string): string[] {
  const broken: string[] = [];
  const prose = markdown.replace(/^```[\s\S]*?^```/gm, "");
  for (const m of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1]!;
    if (/^(https?:|mailto:)/.test(target)) continue;
    const [path, anchor] = target.split("#") as [string, string | undefined];
    if (path === "") {
      if (!anchorsOf(markdown).has(anchor ?? "")) broken.push(target);
      continue;
    }
    const file = resolve(dirname(join(root, doc)), path);
    if (!existsSync(file)) {
      broken.push(target);
      continue;
    }
    if (anchor !== undefined && !anchorsOf(readFileSync(file, "utf8")).has(anchor)) broken.push(target);
  }
  return broken;
}

test("docs: the link check detects a broken path and a broken anchor (known-positive probe)", () => {
  const md = "# Title\n\n[ok](#title) [bad anchor](#nope) [bad path](missing.md) [ext](https://example.com)\n";
  assert.deepEqual(brokenLinks("README.md", md, ROOT), ["#nope", "missing.md"]);
  assert.deepEqual([...anchorsOf("## A `b` (c)\n## A `b` (c)\n")], ["a-b-c", "a-b-c-1"]);
});

for (const doc of DOCS) {
  test(`docs: every relative link and anchor in ${doc} resolves`, () => {
    assert.deepEqual(brokenLinks(doc, read(doc), ROOT), []);
  });
}
