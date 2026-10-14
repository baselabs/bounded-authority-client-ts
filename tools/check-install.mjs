#!/usr/bin/env node
// Follows the README's install steps the way a reader does while the package is not on npm, then
// checks the docs samples against what got installed:
//   1. `pnpm pack` in this clone (the last command of the README's clone-and-pack block; the clone
//      and `pnpm install` before it are already done here);
//   2. the README's project block, as written (`mkdir my-app && cd my-app`, `npm init -y`,
//      `npm pkg set type=module`, `npm install ../bounded-authority-client-ts/<tarball>`), run by
//      `sh -e` in a fresh directory where `bounded-authority-client-ts` names this clone;
//   3. every docs sample (tools/checked-files.mjs docSamples, the same list test/docs.test.ts
//      runs) typechecked in that project against the installed declarations;
//   4. the README quickstart saved as quickstart.ts and run with the README's run block, which
//      must print exactly what its `// prints:` comments say.
// Needs the npm registry: the tarball's runtime dependency is installed from it.
//
// CHECK_INSTALL_TARBALL=<path> skips step 1 and tests that tarball instead (copied into the clone
// under the README's name), so the release workflow checks the exact file it publishes.
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { docSamples, fencesOf } from "./checked-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const TARBALL = `${PACKAGE.name.replace(/^@/, "").replace("/", "-")}-${PACKAGE.version}.tgz`;
// The commands run with this Node.js first on PATH, so `node` in the README is the one running this.
const env = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}` };

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout: 300_000 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

const readme = fencesOf(readFileSync(join(ROOT, "README.md"), "utf8"));
const block = (needle) => {
  const found = readme.filter((f) => f.lang === "bash" && f.code.includes(needle));
  if (found.length !== 1) throw new Error(`README.md needs exactly one bash block with "${needle}", found ${found.length}`);
  return found[0].code;
};
const samples = docSamples(ROOT);
const quickstart = samples.find((s) => s.doc === "README.md");

const work = mkdtempSync(join(tmpdir(), "client-install-"));
const tarballInClone = join(ROOT, TARBALL);
const tarballExisted = existsSync(tarballInClone);
try {
  const cloneBlock = block("pnpm pack");
  if (!/^pnpm pack\b/m.test(cloneBlock)) throw new Error("the clone block does not run pnpm pack");
  if (!cloneBlock.includes(TARBALL)) throw new Error(`the clone block does not name ${TARBALL}`);
  const projectBlock = block("npm init -y");
  const runBlock = block("node quickstart.ts");
  if (quickstart === undefined) throw new Error("README.md has no ts sample");
  const expected = [...quickstart.code.matchAll(/\/\/ prints: (.*)$/gm)].map((m) => m[1].trimEnd());
  if (expected.length === 0) throw new Error("the quickstart states no // prints: output");

  const given = process.env.CHECK_INSTALL_TARBALL;
  if (given) {
    if (tarballExisted) throw new Error(`${TARBALL} already exists in the clone; not overwriting it`);
    copyFileSync(given, tarballInClone);
    console.log(`testing the given tarball ${given}`);
  } else {
    run("pnpm", ["pack"], ROOT);
    if (!existsSync(tarballInClone)) throw new Error(`pnpm pack did not write ${TARBALL}`);
    console.log(`packed ${TARBALL}`);
  }
  console.log(`tarball sha256 ${createHash("sha256").update(readFileSync(tarballInClone)).digest("hex")}`);

  symlinkSync(ROOT, join(work, "bounded-authority-client-ts"), "dir");
  run("sh", ["-e", "-c", projectBlock], work);
  const app = join(work, "my-app");
  const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  console.log(`README project block: ${pkg.name} ("type": "${pkg.type}") with ${Object.keys(pkg.dependencies ?? {}).join(", ")}`);

  const files = samples.map((s, i) => {
    const name = i === 0 ? "quickstart.ts" : `sample-${i}.ts`;
    writeFileSync(join(app, name), s.code);
    return name;
  });
  if (samples[0] !== quickstart) throw new Error("the README quickstart must be the first docs sample");
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

  const printed = run("sh", ["-e", "-c", runBlock], app).split("\n").filter((l) => l !== "");
  if (JSON.stringify(printed) !== JSON.stringify(expected)) {
    throw new Error(`quickstart printed ${JSON.stringify(printed)}, its comments say ${JSON.stringify(expected)}`);
  }
  console.log(`README run block (${process.version}) printed: ${printed.join(" | ")}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
  if (!tarballExisted) rmSync(tarballInClone, { force: true });
}
