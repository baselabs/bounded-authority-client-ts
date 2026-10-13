// Exhaustive sweep, outside the *.test.ts glob so the mutation script (which reruns that glob once per
// mutation) does not pay its ~35 s each time. Run by pnpm test:exhaustive and in CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reauthorizationRequestDigest } from "../src/index.js";
import { baseInput } from "./helpers.js";

// unicode.test.ts samples. This sweep visits all 1,112,064 Unicode scalar values (U+0000 through U+10FFFF
// without the surrogate range), so the claim is exhaustive and independent of the seed.
test("exhaustive: all 1,112,064 Unicode scalar values are accepted as an equals value", () => {
  const input = baseInput();
  let visited = 0;
  const refused: string[] = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    visited++;
    const ch = String.fromCodePoint(cp);
    const r = reauthorizationRequestDigest({
      ...input,
      child: { ...input.child, operations: [{ name: "o", selectors: [{ kind: "equals", path: ["p"], value: ch }] }] },
    });
    if (!r.ok) refused.push(`U+${cp.toString(16)}`);
  }
  assert.equal(visited, 1_112_064);
  assert.deepEqual(refused.slice(0, 10), [], `${refused.length} scalar values refused`);
});
