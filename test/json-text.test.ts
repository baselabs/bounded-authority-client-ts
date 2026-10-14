// The JSON text reader behind childFromWireText (src/json-text.ts): its size bounds, its string and
// whitespace grammar, its depth limit, and its number rules (those of the verifier's jsonDecode).
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { InvalidError, jsonDecode } from "@bounded-authority-protocol/verifier";
import { childFromWireText } from "../src/index.js";
import { MAX_TEXT_CHARS, MAX_STRING_CHARS, MAX_TEXT_DEPTH, readJsonText } from "../src/json-text.js";
import { CHILD_THUMBPRINT } from "./helpers.js";

const base = (o: { thumbprint?: string; audience?: string; ws?: string } = {}): string =>
  `{"holder_thumbprint":"${o.thumbprint ?? CHILD_THUMBPRINT}",${o.ws ?? ""}"audiences":["${o.audience ?? "https://docs.example"}"],` +
  `"operations":[{"name":"docs.read","selectors":[{"kind":"all"}]}],"not_before":1,"expires_at":2}`;

const refusedByReader = (text: string): boolean => {
  try {
    readJsonText(text);
    return false;
  } catch (e) {
    return e instanceof InvalidError;
  }
};

test("reader baseline: the base child and its escapes are accepted", () => {
  assert.equal(childFromWireText(base()).ok, true);
  assert.equal(childFromWireText(base({ audience: "https:\\/\\/docs.example\\u002Fa\\tb" })).ok, true);
  assert.equal(childFromWireText(base({ ws: " \t\r\n" })).ok, true);
});

// ---- size bounds ---------------------------------------------------------------------------

test("reader bound: a 64 MB string is refused fast, without copying it", () => {
  const huge = base({ thumbprint: "A".repeat(64 * 1024 * 1024) });
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  const r = childFromWireText(huge);
  const ms = performance.now() - started;
  const grew = process.memoryUsage().heapUsed - before;
  assert.equal(r.ok, false);
  assert.ok(ms < 1000, `took ${ms} ms`);
  assert.ok(grew < 16 * 1024 * 1024, `heap grew ${grew} bytes`);
});

test("reader bound: a string longer than any accepted child holds is refused", () => {
  assert.equal(MAX_STRING_CHARS, 8192);
  assert.equal(refusedByReader(`"${"a".repeat(MAX_STRING_CHARS)}"`), false);
  assert.equal(refusedByReader(`"${"a".repeat(MAX_STRING_CHARS + 1)}"`), true);
  // Escapes count as the characters they denote.
  assert.equal(refusedByReader(`"${"\\u0061".repeat(MAX_STRING_CHARS)}"`), false);
  assert.equal(refusedByReader(`"${"\\u0061".repeat(MAX_STRING_CHARS + 1)}"`), true);
});

// The largest child the limits allow, within the text cap: 64 audiences of 512 bytes, and 64
// operations of 64 selectors each, every equals value as long as the cap leaves room for.
function largestChild(valueChars: number): string {
  const audiences = Array.from({ length: 64 }, (_, i) => `https://a.example/${String(i).padStart(2, "0")}/${"x".repeat(512 - 21)}`);
  const operations = Array.from({ length: 64 }, (_, o) => ({
    name: `op.${String(o).padStart(2, "0")}${"n".repeat(128 - 5)}`,
    selectors: Array.from({ length: 64 }, (_, s) => ({ kind: "equals", path: ["p", `s${s}`], value: "v".repeat(valueChars) })),
  }));
  return JSON.stringify({ holder_thumbprint: CHILD_THUMBPRINT, audiences, operations, not_before: 1, expires_at: 2 });
}

test("reader bound: the largest valid child fits under the text cap and is accepted", () => {
  // Each extra value character adds 4,096 characters of text (one per selector).
  const chars = Math.min(MAX_STRING_CHARS, 1 + Math.floor((MAX_TEXT_CHARS - largestChild(1).length) / 4096));
  const text = largestChild(chars);
  assert.ok(text.length <= MAX_TEXT_CHARS && text.length > MAX_TEXT_CHARS - 5000, `${text.length} of ${MAX_TEXT_CHARS}`);
  assert.equal(childFromWireText(text).ok, true);
  // One character over the cap (trailing whitespace) is refused before it is read.
  // `.ok` only: a failure message holding a 4 MB child would swamp the test output.
  assert.equal(childFromWireText(text + " ".repeat(MAX_TEXT_CHARS - text.length + 1)).ok, false);
  assert.equal(childFromWireText(text + " ".repeat(MAX_TEXT_CHARS - text.length)).ok, true);
});

// ---- grammar -------------------------------------------------------------------------------

const grammar: [string, string][] = [
  ["a raw control character in a string", base({ audience: "https://docs.example/\u0001" })],
  ["a raw line feed in a string", base({ audience: "https://docs.example/\n" })],
  ["an unknown escape \\x41", base({ audience: "https://docs.example/\\x41" })],
  ["an unknown escape \\'", base({ audience: "https://docs.example/\\'" })],
  ["a \\u escape with non-hex digits", base({ audience: "https://docs.example/\\u00G1" })],
  ["a \\u escape cut short", base({ audience: "https://docs.example/\\u00" })],
  ["a vertical tab as whitespace", base({ ws: "\u000b" })],
  ["a form feed as whitespace", base({ ws: "\u000c" })],
  ["a byte-order mark as whitespace", base({ ws: "﻿" })],
  ["a byte-order mark before the text", `﻿${base()}`],
  ["a no-break space as whitespace", base({ ws: " " })],
];
for (const [label, text] of grammar) {
  test(`reader refuses: ${label}`, () => assert.deepEqual(childFromWireText(text), { ok: false }));
}

test("reader depth: 128 levels are read, 129 are refused", () => {
  assert.equal(MAX_TEXT_DEPTH, 128);
  assert.equal(refusedByReader(`${"[".repeat(128)}${"]".repeat(128)}`), false);
  assert.equal(refusedByReader(`${"[".repeat(129)}${"]".repeat(129)}`), true);
  // A depth no stack could take is refused as a closed error, not a RangeError.
  assert.equal(refusedByReader(`${"[".repeat(1_000_000)}${"]".repeat(1_000_000)}`), true);
});

// ---- numbers -------------------------------------------------------------------------------

const decoded = (lexeme: string): ReturnType<typeof jsonDecode> | undefined => {
  try {
    return jsonDecode(new TextEncoder().encode(lexeme));
  } catch {
    return undefined;
  }
};
const withValue = (lexeme: string): string => base().replace('{"kind":"all"}', `{"kind":"equals","path":["n"],"value":${lexeme}}`);
const withNotBefore = (lexeme: string): string => base().replace('"not_before":1', `"not_before":${lexeme}`);

test("reader numbers: refused exactly where the verifier's jsonDecode refuses (examples)", () => {
  for (const [lexeme, accepted] of [
    ["9007199254740991", true],
    ["9007199254740992", false], // integer magnitude
    ["-9007199254740991", true],
    ["9007199254740991.4", false], // float magnitude, by exact decimal comparison
    ["1" + "0".repeat(63), false], // over the magnitude
    ["0." + "1".repeat(62), true], // a 64-byte lexeme
    ["0." + "1".repeat(63), false], // a 65-byte lexeme
    ["1e400", false],
    ["2.5", true],
  ] as const) {
    assert.equal(decoded(lexeme) !== undefined, accepted, `decoder on ${lexeme}`);
    assert.equal(childFromWireText(withValue(lexeme)).ok, accepted, `equals value ${lexeme}`);
  }
});

test("reader numbers property: an equals value or an integer field is accepted exactly when jsonDecode accepts its lexeme", () => {
  const lexeme = fc.stringMatching(/^-?(0|[1-9][0-9]{0,70})(\.[0-9]{1,30})?([eE][+-]?[0-9]{1,4})?$/);
  fc.assert(
    fc.property(lexeme, (l) => {
      const t = decoded(l);
      const asValue = childFromWireText(withValue(l)).ok;
      const asInteger = childFromWireText(withNotBefore(l)).ok;
      const integerOk = t !== undefined && t.t === "int" && t.v >= 0;
      return asValue === (t !== undefined) && asInteger === integerOk;
    }),
    { numRuns: 3000 },
  );
});
