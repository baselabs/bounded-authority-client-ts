// The documentation runs as written. Every ```ts fence in README.md and docs/*.md is executed
// against src/ (its "@bounded-authority/client" import is pointed at src/index.ts), and every
// `// prints: <text>` comment in a sample must equal, in order, the lines the sample logs.
// Every relative link and its #anchor must resolve. tools/check-install.mjs typechecks the same
// samples against the packed tarball installed the way the README says, and runs the quickstart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format } from "node:util";
import { CODE_LANGUAGE, SAMPLE_LANGUAGES, checkedDocs, docSamples, fencesOf, samplesOf } from "../tools/checked-files.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PACKAGE = "@bounded-authority/client";
const SRC_ENTRY = pathToFileURL(join(ROOT, "src", "index.ts")).href;
// Inside node_modules so the samples resolve the verifier package the way the repo does.
const WORK = join(ROOT, "node_modules", ".cache", "doc-samples");

const DOCS = checkedDocs(ROOT);

/** The `// prints: <text>` comments of a sample, in order. */
export const expectedOutput = (code: string): string[] =>
  [...code.matchAll(/\/\/ prints: (.*)$/gm)].map((m) => m[1]!.trimEnd());

const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const samples = DOCS.flatMap((doc) => samplesOf(doc, read(doc)));

test("docs: the scan finds the samples (a scan of zero samples is a vacuous pass)", () => {
  assert.ok(samples.some((s) => s.doc === "README.md"), "README.md has a ts sample");
  assert.ok(samples.some((s) => s.doc === "docs/api.md"), "docs/api.md has ts samples");
  assert.ok(samples.some((s) => s.doc === "docs/guides.md"), "docs/guides.md has ts samples");
  // Known-positive probe of the extractor and the prints parser.
  const probe = samplesOf("probe", "x\n```ts\nconsole.log(1); // prints: 1\n```\n```bash\nls\n```\n```typescript\n2\n```\n");
  assert.deepEqual(probe.map((s) => [s.line, s.code]), [[3, "console.log(1); // prints: 1"], [9, "2"]]);
  assert.deepEqual(expectedOutput(probe[0]!.code), ["1"]);
});

test("docs: this test and tools/check-install.mjs collect the same samples, and no code fence escapes them", () => {
  // check-install typechecks docSamples(); this test runs the samples of every checked document.
  assert.deepEqual(docSamples(ROOT), samples);
  const escaped = DOCS.flatMap((doc) =>
    fencesOf(read(doc)).filter((f) => CODE_LANGUAGE.test(f.lang) && !SAMPLE_LANGUAGES.includes(f.lang)).map((f) => `${doc}:${f.line} (${f.lang})`),
  );
  assert.deepEqual(escaped, [], "a JavaScript or TypeScript fence in a language the checks do not run");
  assert.ok(CODE_LANGUAGE.test("js") && !CODE_LANGUAGE.test("bash") && !CODE_LANGUAGE.test("text"), "known-positive probe");
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
