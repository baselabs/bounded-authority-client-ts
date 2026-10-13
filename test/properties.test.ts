// Property tests (fast-check): determinism, order-insensitivity of every set the contract sorts,
// and dedup idempotence. Every generated input is valid, so a refusal is itself a failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { reauthorizationRequestDigest } from "../src/index.js";
import type { CumulativePolicy, JsonValue, Operation, ReauthorizationDigestInput, Selector } from "../src/index.js";
import { CHILD_THUMBPRINT, INVOCATION, PARENT_THUMBPRINT, toHex } from "./helpers.js";

const RUNS = { numRuns: 300 };

// ---- generators ---------------------------------------------------------------------------

// Strings span ASCII, Latin-1, BMP, and astral code points so byte order and UTF-16 order differ.
const text = fc.string({ unit: fc.oneof(
  fc.constantFrom("a", "b", "z", "\u00e9", "\uffff", "\u{1F600}", "-", "."),
  fc.string({ unit: "grapheme-ascii", minLength: 1, maxLength: 1 }),
), minLength: 1, maxLength: 6 });

const jsonValue: fc.Arbitrary<JsonValue> = fc.letrec<{ v: JsonValue }>((tie) => ({
  v: fc.oneof(
    { depthSize: "small", maxDepth: 2 },
    fc.constant(null),
    fc.boolean(),
    fc.integer({ min: -1000, max: 1000 }),
    fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
    text,
    fc.array(tie("v"), { maxLength: 3 }),
    fc.dictionary(text, tie("v"), { maxKeys: 3 }),
  ),
})).v;

const path = fc.array(text, { minLength: 1, maxLength: 3 });
const safeInt = fc.integer({ min: -1_000_000, max: 1_000_000 });

const selector: fc.Arbitrary<Selector> = fc.oneof(
  fc.constant<Selector>({ kind: "all" }),
  fc.record({ kind: fc.constant("equals" as const), path, value: jsonValue }),
  fc.record({ kind: fc.constantFrom("lte" as const, "gte" as const), path, value: safeInt }),
  fc.record({ kind: fc.constant("one_of" as const), path, values: fc.array(jsonValue, { minLength: 1, maxLength: 5 }) }),
);

const operation: fc.Arbitrary<Operation> = fc.record({
  name: text,
  selectors: fc.array(selector, { minLength: 1, maxLength: 5 }),
});

const operations = fc.uniqueArray(operation, { minLength: 1, maxLength: 4, selector: (o) => o.name });

// sumPath/maxSum and distinctPath/maxDistinct appear together; at least one ceiling is present.
const policy = fc.option(
  fc.record({
    windowSeconds: fc.integer({ min: 1, max: 2_678_400 }),
    maxCount: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
    sum: fc.option(fc.record({ sumPath: path, maxSum: fc.integer({ min: 0, max: 1_000_000 }) }), { nil: undefined }),
    distinct: fc.option(fc.record({ distinctPath: path, maxDistinct: fc.integer({ min: 1, max: 1024 }) }), { nil: undefined }),
  }).map((g): CumulativePolicy => {
    const needsCeiling = g.maxCount === undefined && g.sum === undefined && g.distinct === undefined;
    return {
      windowSeconds: g.windowSeconds,
      ...(g.maxCount === undefined && !needsCeiling ? {} : { maxCount: g.maxCount ?? 1 }),
      ...(g.sum ?? {}),
      ...(g.distinct ?? {}),
    };
  }),
  { nil: undefined },
);

const input: fc.Arbitrary<ReauthorizationDigestInput> = fc.record({
  audiences: fc.array(text, { minLength: 1, maxLength: 5 }),
  operations,
  policy,
  consumerId: text,
  notBefore: fc.integer({ min: 0, max: 2_000_000_000 }),
  expiresAt: fc.integer({ min: 0, max: 2_000_000_000 }),
}).map((g) => ({
  parent: { jti: "parent-grant-01", contractMajor: 2, holderThumbprint: PARENT_THUMBPRINT },
  invocationId: INVOCATION,
  consumerId: g.consumerId,
  child: {
    holderThumbprint: CHILD_THUMBPRINT,
    audiences: g.audiences,
    operations: g.operations,
    notBefore: g.notBefore,
    expiresAt: g.expiresAt,
    ...(g.policy === undefined ? {} : { cumulativePolicy: g.policy }),
  },
}));

// A deterministic permutation driven by generated numbers (Fisher-Yates over a copy).
function permute<T>(items: readonly T[], seeds: readonly number[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = (seeds[i % Math.max(seeds.length, 1)] ?? 0) % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
const seeds = fc.array(fc.nat(), { minLength: 1, maxLength: 8 });

function hexOf(i: ReauthorizationDigestInput): string {
  const r = reauthorizationRequestDigest(i);
  assert.equal(r.ok, true, "generated input must be accepted");
  return r.ok ? `${toHex(r.value.projection)}:${r.value.requestSha256}` : "";
}

function withSelectors(i: ReauthorizationDigestInput, f: (s: readonly Selector[]) => Selector[]): ReauthorizationDigestInput {
  return { ...i, child: { ...i.child, operations: i.child.operations.map((o) => ({ name: o.name, selectors: f(o.selectors) })) } };
}

function reorderJson(v: JsonValue, s: readonly number[]): JsonValue {
  if (Array.isArray(v)) return v.map((x) => reorderJson(x, s));
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(permute(Object.entries(v), s).map(([k, x]) => [k, reorderJson(x, s)]));
  }
  return v;
}

// ---- properties ---------------------------------------------------------------------------

test("determinism: the same input yields identical bytes and digest on every call", () => {
  fc.assert(fc.property(input, (i) => hexOf(i) === hexOf(structuredClone(i))), RUNS);
});

test("projection framing: ten framed fields consume the bytes exactly, tag first", () => {
  fc.assert(fc.property(input, (i) => {
    const r = reauthorizationRequestDigest(i);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const p = r.value.projection;
    const view = new DataView(p.buffer, p.byteOffset, p.byteLength);
    const fields: Uint8Array[] = [];
    let at = 0;
    while (at < p.length) {
      const n = view.getUint32(at, false);
      fields.push(p.subarray(at + 4, at + 4 + n));
      at += 4 + n;
    }
    assert.equal(at, p.length, "no trailing bytes and no overrun");
    assert.equal(fields.length, 10);
    assert.equal(new TextDecoder().decode(fields[0]), "BA-REAUTH-REQ-2");
  }), RUNS);
});

test("order-insensitivity: permuting audiences leaves the bytes unchanged", () => {
  fc.assert(fc.property(input, seeds, (i, s) => {
    const permuted = { ...i, child: { ...i.child, audiences: permute(i.child.audiences, s) } };
    return hexOf(permuted) === hexOf(i);
  }), RUNS);
});

test("order-insensitivity: permuting operations leaves the bytes unchanged", () => {
  fc.assert(fc.property(input, seeds, (i, s) => {
    const permuted = { ...i, child: { ...i.child, operations: permute(i.child.operations, s) } };
    return hexOf(permuted) === hexOf(i);
  }), RUNS);
});

test("order-insensitivity: permuting each operation's selectors leaves the bytes unchanged", () => {
  fc.assert(fc.property(input, seeds, (i, s) => hexOf(withSelectors(i, (sel) => permute(sel, s))) === hexOf(i)), RUNS);
});

test("order-insensitivity: permuting one_of values leaves the bytes unchanged", () => {
  fc.assert(fc.property(input, seeds, (i, s) => {
    const permuted = withSelectors(i, (sel) => sel.map((x) => (x.kind === "one_of" ? { ...x, values: permute(x.values, s) } : x)));
    return hexOf(permuted) === hexOf(i);
  }), RUNS);
});

test("order-insensitivity: object member order inside JSON values leaves the bytes unchanged", () => {
  fc.assert(fc.property(input, seeds, (i, s) => {
    const permuted = withSelectors(i, (sel) => sel.map((x) => {
      if (x.kind === "equals") return { ...x, value: reorderJson(x.value, s) };
      if (x.kind === "one_of") return { ...x, values: x.values.map((v) => reorderJson(v, s)) };
      return x;
    }));
    return hexOf(permuted) === hexOf(i);
  }), RUNS);
});

test("dedup idempotence: repeating audiences, selectors, and one_of values changes nothing", () => {
  fc.assert(fc.property(input, seeds, (i, s) => {
    const doubledAud = { ...i, child: { ...i.child, audiences: permute([...i.child.audiences, ...i.child.audiences], s) } };
    assert.equal(hexOf(doubledAud), hexOf(i), "audiences");

    const doubledSel = withSelectors(i, (sel) => permute([...sel, ...sel], s));
    assert.equal(hexOf(doubledSel), hexOf(i), "selectors");

    const doubledVals = withSelectors(i, (sel) => sel.map((x) => (x.kind === "one_of" ? { ...x, values: permute([...x.values, ...x.values], s) } : x)));
    assert.equal(hexOf(doubledVals), hexOf(i), "one_of values");
  }), RUNS);
});

test("sensitivity: changing any one top-level field changes the digest", () => {
  fc.assert(fc.property(input, (i) => {
    const baseline = hexOf(i);
    const variants: ReauthorizationDigestInput[] = [
      { ...i, parent: { ...i.parent, jti: `${i.parent.jti}x` } },
      { ...i, consumerId: `${i.consumerId}x` },
      { ...i, child: { ...i.child, audiences: [...i.child.audiences, "\u0000extra"] } },
      { ...i, child: { ...i.child, notBefore: i.child.notBefore + 1 } },
      { ...i, child: { ...i.child, expiresAt: i.child.expiresAt + 1 } },
    ];
    for (const v of variants) assert.notEqual(hexOf(v), baseline);
  }), RUNS);
});
