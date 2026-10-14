// Byte-level pins for every ordering, sort, dedup, null-marker, width, and tag rule. Expected
// bytes come from the hand assembler in helpers.ts, written from literal values in the order the
// contract states. Each rule has a case that fails when the rule is broken; tools/mutation-proofs.mjs
// breaks each rule in turn and proves the named case goes red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reauthorizationRequestDigest } from "../src/index.js";
import type { ReauthorizationDigestInput } from "../src/index.js";
import {
  CHILD_THUMBPRINT,
  INVOCATION,
  OTHER_THUMBPRINT,
  PARENT_THUMBPRINT,
  baseInput,
  cat,
  expectedProjection,
  frame,
  seq,
  sha256b64url,
  toHex,
  u32,
  withChild,
} from "./helpers.js";

function project(input: ReauthorizationDigestInput): Uint8Array {
  const r = reauthorizationRequestDigest(input);
  assert.equal(r.ok, true, "input must be accepted");
  if (!r.ok) throw new Error("unreachable");
  return r.value.projection;
}

const op = (name: string, selectors: ReauthorizationDigestInput["child"]["operations"][number]["selectors"]) => ({
  name,
  selectors,
});

// Encoded selector forms, assembled by hand.
const eq = (path: string[], jcs: string) => cat(frame("equals"), frame(seq(path)), frame(jcs));
const cmp = (kind: "lte" | "gte", path: string[], jcs: string) => cat(frame(kind), frame(seq(path)), frame(jcs));
const oneOf = (path: string[], jcsValues: string[]) => cat(frame("one_of"), frame(seq(path)), frame(seq(jcsValues)));
const allSel = frame("all");
const encodedOp = (name: string, selectors: Uint8Array[]) => cat(frame(name), frame(seq(selectors)));

test("pin: a complete projection equals the hand-assembled ten framed fields", () => {
  const expected = expectedProjection({
    audiences: seq(["https://data.example"]),
    operations: seq([
      encodedOp("data.export", [
        cmp("lte", ["row_count"], "2500"),
        eq(["format"], '"csv"'),
      ]),
    ]),
  });
  const r = reauthorizationRequestDigest(baseInput());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(toHex(r.value.projection), toHex(expected));
  assert.equal(r.value.requestSha256, sha256b64url(expected));
});

test("tag: the projection opens with U32(15) and the 15 ASCII bytes BA-REAUTH-REQ-2, no NUL after", () => {
  const p = project(baseInput());
  assert.equal(toHex(p.subarray(0, 4 + 15)), toHex(cat(u32(15), "BA-REAUTH-REQ-2")));
  // the next four bytes are the next frame's length (parent_jti, 10 bytes), not a terminator
  assert.equal(toHex(p.subarray(19, 23)), toHex(u32("parent-grant-01".length)));
});

test("null marker: an absent policy ends the projection with 00000004 6e756c6c and nothing after", () => {
  const p = project(baseInput());
  assert.equal(toHex(p.subarray(p.length - 8)), "000000046e756c6c");
});

test("U32 width and order: a frame longer than 65535 bytes carries a four-byte big-endian length", () => {
  const consumerId = "c".repeat(70000); // 0x00011170
  const p = project({ ...baseInput(), consumerId });
  const header = cat(frame("BA-REAUTH-REQ-2"), frame("parent-grant-01"), frame(INVOCATION));
  assert.equal(toHex(p.subarray(header.length, header.length + 4)), "00011170");
  assert.equal(toHex(p), toHex(expectedProjection({
    consumerId,
    audiences: seq(["https://data.example"]),
    operations: seq([encodedOp("data.export", [
      cmp("lte", ["row_count"], "2500"),
      eq(["format"], '"csv"'),
    ])]),
  })));
});

test("lengths count bytes, not characters: multi-byte UTF-8 identifiers are framed by byte length", () => {
  const consumerId = "caf\u00e9-\u{1F600}"; // 3 + 2 + 1 + 4 = 10 bytes, 6 UTF-16 code points counted differently
  const p = project({ ...baseInput(), consumerId });
  const expected = expectedProjection({
    consumerId,
    audiences: seq(["https://data.example"]),
    operations: seq([encodedOp("data.export", [
      cmp("lte", ["row_count"], "2500"),
      eq(["format"], '"csv"'),
    ])]),
  });
  assert.equal(toHex(p), toHex(expected));
});

// UTF-8 byte order is  z (7a) < e-acute (c3 a9) < U+FFFF (ef bf bf) < U+1F600 (f0 9f 98 80).
// UTF-16 code-unit order would put U+1F600 (d83d ...) BEFORE U+FFFF; byte order does not.
const BYTE_ORDER = ["z", "\u00e9", "\uffff", "\u{1F600}"];

test("audiences sort: ascending by raw UTF-8 bytes, not by UTF-16 code units", () => {
  const p = project(withChild({ audiences: ["\u{1F600}", "\uffff", "\u00e9", "z"] }));
  assert.equal(toHex(p), toHex(expectedProjection({
    audiences: seq(BYTE_ORDER),
    operations: seq([encodedOp("data.export", [
      cmp("lte", ["row_count"], "2500"),
      eq(["format"], '"csv"'),
    ])]),
  })));
});

test("audiences dedup: repeated audiences collapse to one", () => {
  const p = project(withChild({ audiences: ["b", "a", "b", "a", "a"] }));
  assert.equal(toHex(p), toHex(expectedProjection({
    audiences: seq(["a", "b"]),
    operations: seq([encodedOp("data.export", [
      cmp("lte", ["row_count"], "2500"),
      eq(["format"], '"csv"'),
    ])]),
  })));
});

test("operations sort: ascending by raw UTF-8 name bytes, not by UTF-16 code units", () => {
  const sel = [{ kind: "all" as const }];
  const p = project(withChild({
    operations: [op("\u{1F600}", sel), op("\uffff", sel), op("zz", sel), op("a", sel)],
  }));
  assert.equal(toHex(p), toHex(expectedProjection({
    audiences: seq(["https://data.example"]),
    operations: seq([
      encodedOp("a", [allSel]),
      encodedOp("zz", [allSel]),
      encodedOp("\uffff", [allSel]),
      encodedOp("\u{1F600}", [allSel]),
    ]),
  })));
});

test("operations sort: by name bytes, not by the encoded operation (whose first bytes are the name length)", () => {
  // "aa" < "b" by name bytes; the encoded forms start with U32(2) and U32(1), which would put "b" first.
  const sel = [{ kind: "all" as const }];
  const p = project(withChild({ operations: [op("b", sel), op("aa", sel)] }));
  assert.equal(toHex(p), toHex(expectedProjection({
    audiences: seq(["https://data.example"]),
    operations: seq([encodedOp("aa", [allSel]), encodedOp("b", [allSel])]),
  })));
});

test("selector sort: ascending by complete encoded bytes (kind frame first, then path, then value)", () => {
  const p = project(withChild({
    operations: [op("o", [
      { kind: "one_of", path: ["p"], values: ["x"] },
      { kind: "equals", path: ["bb"], value: 1 },
      { kind: "lte", path: ["a"], value: 5 },
      { kind: "equals", path: ["a"], value: 2 },
      { kind: "gte", path: ["a"], value: 5 },
      { kind: "all" },
      { kind: "equals", path: ["a"], value: 1 },
    ])],
  }));
  // kind frames: all/gte/lte (len 3) < equals/one_of (len 6); "all"<"gte"<"lte"; "equals"<"one_of";
  // then the path frame (shorter L(path) first: ["a"] before ["bb"]); then the value frame bytes.
  assert.equal(toHex(p), toHex(expectedProjection({
    audiences: seq(["https://data.example"]),
    operations: seq([encodedOp("o", [
      allSel,
      cmp("gte", ["a"], "5"),
      cmp("lte", ["a"], "5"),
      eq(["a"], "1"),
      eq(["a"], "2"),
      eq(["bb"], "1"),
      oneOf(["p"], ['"x"']),
    ])]),
  })));
});

test("selector dedup: selectors with identical canonical bytes collapse, including re-ordered one_of sets", () => {
  const p = project(withChild({
    operations: [op("o", [
      { kind: "equals", path: ["a"], value: { b: 1, a: 2 } },
      { kind: "equals", path: ["a"], value: { a: 2, b: 1 } },
      { kind: "one_of", path: ["p"], values: ["y", "x", "y"] },
      { kind: "one_of", path: ["p"], values: ["x", "y"] },
      { kind: "all" },
      { kind: "all" },
    ])],
  }));
  assert.equal(toHex(p), toHex(expectedProjection({
    audiences: seq(["https://data.example"]),
    operations: seq([encodedOp("o", [
      allSel,
      eq(["a"], '{"a":2,"b":1}'),
      oneOf(["p"], ['"x"', '"y"']),
    ])]),
  })));
});

test("one_of value sort: ascending by JCS value bytes, as text not as numbers", () => {
  // JCS bytes: "a" 22 61 22 < "b" 22 62 22 < 10 (31 30) < 2 (32) < 9 (39) < null (6e..) < true (74..)
  const p = project(withChild({
    operations: [op("o", [{ kind: "one_of", path: ["p"], values: [true, 9, "b", null, 10, 2, "a"] }])],
  }));
  assert.equal(toHex(p), toHex(expectedProjection({
    audiences: seq(["https://data.example"]),
    operations: seq([encodedOp("o", [
      oneOf(["p"], ['"a"', '"b"', "10", "2", "9", "null", "true"]),
    ])]),
  })));
});

test("one_of value dedup: values with identical JCS bytes collapse", () => {
  const p = project(withChild({
    operations: [op("o", [{ kind: "one_of", path: ["p"], values: ["x", "y", "x", { a: 1, b: 2 }, { b: 2, a: 1 }, 1, 1] }])],
  }));
  assert.equal(toHex(p), toHex(expectedProjection({
    audiences: seq(["https://data.example"]),
    operations: seq([encodedOp("o", [
      oneOf(["p"], ['"x"', '"y"', "1", '{"a":1,"b":2}']),
    ])]),
  })));
});

test("path order: path components keep their given order and are never sorted or deduplicated", () => {
  const p = project(withChild({
    operations: [op("o", [{ kind: "equals", path: ["z", "a", "z"], value: "v" }])],
  }));
  assert.equal(toHex(p), toHex(expectedProjection({
    audiences: seq(["https://data.example"]),
    operations: seq([encodedOp("o", [eq(["z", "a", "z"], '"v"')])]),
  })));
});

test("JCS value form: equals values use canonical JSON (sorted keys, raw UTF-8, shortest numbers)", () => {
  const p = project(withChild({
    operations: [op("o", [{ kind: "equals", path: ["v"], value: { b: [1, 2.5, "\u00e9"], a: null } }])],
  }));
  assert.equal(toHex(p), toHex(expectedProjection({
    audiences: seq(["https://data.example"]),
    operations: seq([encodedOp("o", [eq(["v"], '{"a":null,"b":[1,2.5,"\u00e9"]}')])]),
  })));
});

test("integers use ASCII decimal: negative bounds, zero, and the 2^53-1 maximum", () => {
  const p = project(withChild({
    operations: [op("o", [
      { kind: "gte", path: ["n"], value: -9007199254740991 },
      { kind: "lte", path: ["z"], value: 0 },
      { kind: "lte", path: ["m"], value: 9007199254740991 },
    ])],
    notBefore: 0,
    expiresAt: 9007199254740991,
  }));
  assert.equal(toHex(p), toHex(expectedProjection({
    notBefore: "0",
    expiresAt: "9007199254740991",
    audiences: seq(["https://data.example"]),
    operations: seq([encodedOp("o", [
      cmp("gte", ["n"], "-9007199254740991"),
      cmp("lte", ["m"], "9007199254740991"),
      cmp("lte", ["z"], "0"),
    ])]),
  })));
});

test("policy: six framed fields in order, absent optionals are the framed ASCII null, no names, no count", () => {
  const full = project(withChild({
    cumulativePolicy: {
      windowSeconds: 60, maxCount: 5, sumPath: ["row_count"], maxSum: 10000,
      distinctPath: ["dataset", "x"], maxDistinct: 2,
    },
  }));
  const fullPolicy = cat(
    frame("60"), frame("5"), frame(seq(["row_count"])), frame("10000"),
    frame(seq(["dataset", "x"])), frame("2"),
  );
  const ops = seq([encodedOp("data.export", [cmp("lte", ["row_count"], "2500"), eq(["format"], '"csv"')])]);
  assert.equal(toHex(full), toHex(expectedProjection({ audiences: seq(["https://data.example"]), operations: ops, policy: fullPolicy })));

  const sparse = project(withChild({ cumulativePolicy: { windowSeconds: 2592000, sumPath: ["row_count"], maxSum: 10000 } }));
  const sparsePolicy = cat(
    frame("2592000"), frame("null"), frame(seq(["row_count"])), frame("10000"), frame("null"), frame("null"),
  );
  assert.equal(toHex(sparse), toHex(expectedProjection({ audiences: seq(["https://data.example"]), operations: ops, policy: sparsePolicy })));
});

test("policy: each member moves the digest, and sum/distinct paths keep component order", () => {
  const base = {
    windowSeconds: 60, maxCount: 5, sumPath: ["a", "b"], maxSum: 100, distinctPath: ["c"], maxDistinct: 2,
  };
  const digestOf = (policy: typeof base) => {
    const r = reauthorizationRequestDigest(withChild({ cumulativePolicy: policy }));
    assert.equal(r.ok, true);
    return r.ok ? r.value.requestSha256 : "";
  };
  const baseline = digestOf(base);
  const variants: (typeof base)[] = [
    { ...base, windowSeconds: 61 }, { ...base, maxCount: 6 }, { ...base, sumPath: ["b", "a"] },
    { ...base, maxSum: 101 }, { ...base, distinctPath: ["d"] }, { ...base, maxDistinct: 3 },
  ];
  for (const v of variants) assert.notEqual(digestOf(v), baseline);
});

test("a present policy changes the projection relative to an absent one", () => {
  const without = project(baseInput());
  const withPolicy = project(withChild({ cumulativePolicy: { windowSeconds: 1, maxCount: 1 } }));
  assert.notEqual(toHex(without), toHex(withPolicy));
});

test("every top-level field is bound: changing any one changes the digest", () => {
  const baseline = project(baseInput());
  const changed: ReauthorizationDigestInput[] = [
    { ...baseInput(), parent: { ...baseInput().parent, jti: "other-parent" } },
    { ...baseInput(), invocationId: "5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c5e" },
    { ...baseInput(), consumerId: "other-agent" },
    withChild({ holderThumbprint: OTHER_THUMBPRINT }),
    withChild({ audiences: ["https://data.example/alt"] }),
    withChild({ notBefore: 1800000001 }),
    withChild({ expiresAt: 1800000299 }),
  ];
  for (const input of changed) assert.notEqual(toHex(project(input)), toHex(baseline));
  assert.notEqual(CHILD_THUMBPRINT, PARENT_THUMBPRINT);
});

test("integers use ASCII decimal: an inherited negative time is framed with its minus sign", () => {
  const r = reauthorizationRequestDigest(withChild({ notBefore: -20, expiresAt: -10 }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const hex = toHex(r.value.projection);
  assert.ok(hex.includes(toHex(cat(frame("-20"), frame("-10")))), "the frames hold -20 and -10");
});
