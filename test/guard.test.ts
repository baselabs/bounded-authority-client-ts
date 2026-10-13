// Guard: src/ must stay browser-safe. No "node:" specifier and no Buffer identifier anywhere in
// src/. The guard scans raw text, comments included, so src/ comments avoid those words too.
// tools/mutation-proofs.mjs injects each violation into src/ and proves this test goes red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.(ts|tsx|js|mjs|cjs)$/.test(name) ? [full] : [];
  });
}

const files = sourceFiles(SRC);

test("guard: the scan sees the source files (a scan of zero files is a vacuous pass)", () => {
  assert.ok(files.length >= 3, `expected the src/ modules, found ${files.length}`);
  assert.ok(files.some((f) => f.endsWith("index.ts")));
});

test("guard: src/ contains no node: specifier", () => {
  const offenders = files.filter((f) => /node:/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});

test("guard: src/ contains no Buffer identifier", () => {
  const offenders = files.filter((f) => /\bBuffer\b/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});

test("guard: the patterns do detect a violation (known-positive probe)", () => {
  assert.ok(/node:/.test('import { x } from "node:crypto";'));
  assert.ok(/\bBuffer\b/.test("const b = Buffer.from([1]);"));
  assert.ok(!/\bBuffer\b/.test("const b = Uint8Array.from([1]);"));
});
