// A property over Unicode scalar values, as an equals value (a fast-check sample; the exhaustive sweep is
// test/unicode-exhaustive.ts, run by pnpm test:exhaustive). It runs against verifier 0.7.0 or later, which
// accepts every scalar. Verifier 0.5.0 refused U+0400-047F, U+8000-87FF and U+100000-10FFFF: this property
// failed on U+100000 before the dependency moved to 0.7.0.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { reauthorizationRequestDigest } from "../src/index.js";
import { baseInput, enc, toHex } from "./helpers.js";

const scalar = fc.integer({ min: 0, max: 0x10ffff }).filter((cp) => cp < 0xd800 || cp > 0xdfff);

test("every Unicode scalar value is accepted as an equals value and appears as its UTF-8 bytes", () => {
  fc.assert(fc.property(scalar, (cp) => {
    const ch = String.fromCodePoint(cp);
    const input = baseInput();
    const r = reauthorizationRequestDigest({
      ...input,
      child: { ...input.child, operations: [{ name: "o", selectors: [{ kind: "equals", path: ["p"], value: ch }] }] },
    });
    assert.equal(r.ok, true, `U+${cp.toString(16)}`);
    if (!r.ok) return;
    assert.ok(toHex(r.value.projection).includes(toHex(enc.encode(JSON.stringify(ch)))), `U+${cp.toString(16)}`);
  }), { numRuns: 2000 });
});
