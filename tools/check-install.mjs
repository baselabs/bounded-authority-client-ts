#!/usr/bin/env node
// Installs the package the way the README tells a reader to while it is not on npm (`pnpm pack`,
// then `npm install` of the tarball into a fresh project), then, inside that project:
//   1. typechecks every ts sample of README.md and docs/*.md against the shipped declarations
//      (strict, NodeNext; test/docs.test.ts runs those samples against src/), and
//   2. runs the README quickstart with plain `node` (built-in type stripping, Node.js 22.18 or
//      later) and checks that it prints exactly what its `// prints:` comments say.
// Needs the npm registry: the tarball's runtime dependency is installed from it.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 300_000 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

const fences = (rel) => [...readFileSync(join(ROOT, rel), "utf8").matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map((m) => m[1]);
const docs = ["README.md", ...readdirSync(join(ROOT, "docs")).filter((f) => f.endsWith(".md")).sort().map((f) => `docs/${f}`)];
const samples = docs.flatMap(fences);
// The first ts fence of the README is the quickstart.
const quickstart = fences("README.md")[0];
if (quickstart === undefined || samples.length < 2) {
  console.error(`expected the README quickstart and the docs samples, found ${samples.length} ts fences`);
  process.exit(1);
}
const expected = [...quickstart.matchAll(/\/\/ prints: (.*)$/gm)].map((m) => m[1].trimEnd());
if (!quickstart.includes('from "@bounded-authority/client"') || expected.length === 0) {
  console.error("the quickstart must import @bounded-authority/client and state its output in // prints: comments");
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "client-install-"));
try {
  run("pnpm", ["pack", "--pack-destination", work], ROOT);
  const tarball = readdirSync(work).find((f) => f.endsWith(".tgz"));
  if (tarball === undefined) throw new Error("pnpm pack wrote no tarball");
  console.log(`packed ${tarball}`);

  const app = join(work, "app");
  mkdirSync(app);
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: "install-check", private: true, type: "module" }));
  run("npm", ["install", "--no-audit", "--no-fund", join(work, tarball)], app);
  writeFileSync(join(app, "quickstart.ts"), quickstart);
  const files = ["quickstart.ts"];
  samples.slice(1).forEach((code, i) => {
    files.push(`sample-${i + 1}.ts`);
    writeFileSync(join(app, `sample-${i + 1}.ts`), code);
  });
  writeFileSync(
    join(app, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
        exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, noEmit: true,
        lib: ["ES2022", "DOM"], skipLibCheck: true,
        // Node.js types for the samples that read the vectors file; taken from this repository.
        typeRoots: [join(ROOT, "node_modules", "@types")], types: ["node"],
      },
      files,
    }),
  );

  run(join(ROOT, "node_modules", ".bin", "tsc"), ["-p", join(app, "tsconfig.json")], app);
  console.log(`${files.length} docs samples typecheck against the installed package`);

  const printed = run(process.execPath, ["quickstart.ts"], app).split("\n").filter((l) => l !== "");
  if (JSON.stringify(printed) !== JSON.stringify(expected)) {
    throw new Error(`quickstart printed ${JSON.stringify(printed)}, its comments say ${JSON.stringify(expected)}`);
  }
  console.log(`quickstart ran against the installed package and printed: ${printed.join(" | ")}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
