// The repository files the checks read, in one place. The checks import their lists from here,
// and test/ci-paths.test.ts proves that no file listed here is excluded by the CI push filter.
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** README.md and docs/*.md: their ts samples run in test/docs.test.ts and tools/check-install.mjs. */
export function sampleDocs(root) {
  const docs = readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).sort().map((f) => `docs/${f}`);
  return ["README.md", ...docs];
}

/** Every Markdown file test/docs.test.ts reads (samples, links, and anchors). */
export function checkedDocs(root) {
  return [...sampleDocs(root), "test/browser/README.md", "CHANGELOG.md"];
}

/** Paths tools/check-pack.mjs requires in the packed file list. */
export const PACK_REQUIRED = [
  "package.json", "LICENSE", "NOTICE", "README.md", "docs/req2-projection.md", "docs/api.md", "docs/guides.md",
  "dist/src/index.js", "dist/src/index.d.ts", "dist/src/boundary.js", "dist/src/projection.js",
];
