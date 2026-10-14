// The repository files the checks read, in one place. The checks import their lists from here,
// and test/ci-paths.test.ts proves that no file listed here is excluded by the CI push filter.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** README.md and docs/*.md: their ts samples run in test/docs.test.ts and tools/check-install.mjs. */
export function sampleDocs(root) {
  const docs = readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).sort().map((f) => `docs/${f}`);
  return ["README.md", ...docs];
}

/** Every Markdown file test/docs.test.ts reads (samples, links, and anchors). */
export function checkedDocs(root) {
  return [...sampleDocs(root), "test/browser/README.md", "CHANGELOG.md", "RELEASING.md"];
}

/** Paths tools/check-pack.mjs requires in the packed file list. */
export const PACK_REQUIRED = [
  "package.json", "LICENSE", "NOTICE", "README.md", "docs/req2-projection.md", "docs/api.md", "docs/guides.md",
  "dist/src/index.js", "dist/src/index.d.ts", "dist/src/boundary.js", "dist/src/projection.js",
];

// ---- code samples ------------------------------------------------------------------------------

/** The fence languages that are executed and typechecked as samples. */
export const SAMPLE_LANGUAGES = ["ts", "typescript"];

/** Fence languages that hold JavaScript or TypeScript; every such fence must be a sample language. */
export const CODE_LANGUAGE = /^(ts|typescript|tsx|mts|cts|js|javascript|jsx|mjs|cjs)$/;

/** Every fenced code block of a Markdown text: its language, first code line (1-based), and code. */
export function fencesOf(markdown) {
  const lines = markdown.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^```([A-Za-z0-9_-]*)/.exec(lines[i]);
    if (open === null) continue;
    let end = i + 1;
    while (end < lines.length && !/^```\s*$/.test(lines[end])) end++;
    out.push({ lang: open[1], line: i + 2, code: lines.slice(i + 1, end).join("\n") });
    i = end;
  }
  return out;
}

/** The samples of one Markdown text: its fences in a sample language. */
export function samplesOf(doc, markdown) {
  return fencesOf(markdown)
    .filter((f) => SAMPLE_LANGUAGES.includes(f.lang))
    .map((f) => ({ doc, line: f.line, code: f.code }));
}

/** Every sample in README.md and docs/*.md, in document order. */
export function docSamples(root) {
  return sampleDocs(root).flatMap((doc) => samplesOf(doc, readFileSync(join(root, doc), "utf8")));
}
