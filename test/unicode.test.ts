// A property over every Unicode scalar value, as an equals value. SKIPPED until the verifier's
// canonical-JSON UTF-8 check is fixed: it currently rejects some valid scalars (Cyrillic
// U+0400-047F, U+8000-87FF, and plane 16), which this package surfaces as the closed error. The
// fix belongs in the verifier; this test goes live when the dependency carries it. See
// test/browser/README.md ("Pending") for the tracking note.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { reauthorizationRequestDigest } from "../src/index.js";
import { baseInput, enc, toHex } from "./helpers.js";

const SKIP = "pending verifier fix: its canonical-JSON UTF-8 validation rejects some valid scalars (U+0400-047F, U+8000-87FF, plane 16); see test/browser/README.md";

const scalar = fc.integer({ min: 0, max: 0x10ffff }).filter((cp) => cp < 0xd800 || cp > 0xdfff);

test("every Unicode scalar value is accepted as an equals value and appears as its UTF-8 bytes", { skip: SKIP }, () => {
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
