#!/usr/bin/env node
// Proves a clean publish ships code: `npm pack --dry-run` runs the prepack script (which builds
// dist/), and the file list it reports must contain the compiled entry point and declarations,
// the license files, and the contract document, and none of the source, tests, tools, or maps.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const r = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: ROOT, encoding: "utf8" });
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(1);
}
const start = r.stdout.indexOf("[");
const packed = JSON.parse(r.stdout.slice(start))[0];
const files = packed.files.map((f) => f.path);

const required = [
  "package.json", "LICENSE", "NOTICE", "README.md", "docs/req2-projection.md",
  "dist/src/index.js", "dist/src/index.d.ts", "dist/src/boundary.js", "dist/src/projection.js",
];
const forbidden = [/^src\//, /^test\//, /^tools\//, /^\.github\//, /\.map$/, /^pnpm-lock/, /^tsconfig/];

const problems = [
  ...required.filter((f) => !files.includes(f)).map((f) => `missing from the package: ${f}`),
  ...files.filter((f) => forbidden.some((re) => re.test(f))).map((f) => `must not be in the package: ${f}`),
];
console.log(`${packed.name}@${packed.version}: ${files.length} files`);
console.log(files.join("\n"));
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("pack contents ok (dist present, no source, tests, tools, or maps)");
