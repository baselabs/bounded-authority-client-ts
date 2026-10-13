// The service's size and count limits, mirrored at the boundary so a client refuses what the
// service would refuse. Each limit is tested at the limit (accepted) and one past it (refused),
// counting bytes (not characters) where the limit is in bytes and counting before deduplication
// where the limit is a count.
import { test } from "node:test";
import assert from "node:assert/strict";
import { childFromWire, reauthorizationRequestDigest } from "../src/index.js";
import { CHILD_THUMBPRINT, baseInput } from "./helpers.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

const accepts = (mutate: (i: Loose) => void): boolean => {
  const i: Loose = baseInput();
  mutate(i);
  return reauthorizationRequestDigest(i).ok;
};
const distinct = (n: number, prefix: string): string[] => Array.from({ length: n }, (_, k) => `${prefix}${k}`);
const sel = (n: number) => Array.from({ length: n }, (_, k) => ({ kind: "equals", path: [`p${k}`], value: k }));

test("limits baseline: the unmodified input is accepted", () => {
  assert.equal(accepts(() => undefined), true);
});

test("audiences: at most 64 (counted before deduplication)", () => {
  assert.equal(accepts((i) => { i.child.audiences = distinct(64, "https://a.example/"); }), true);
  assert.equal(accepts((i) => { i.child.audiences = distinct(65, "https://a.example/"); }), false);
  assert.equal(accepts((i) => { i.child.audiences = Array(64).fill("x"); }), true);
  assert.equal(accepts((i) => { i.child.audiences = Array(65).fill("x"); }), false, "65 identical values are still 65");
});

test("audience: at most 512 bytes (bytes, not characters)", () => {
  assert.equal(accepts((i) => { i.child.audiences = ["a".repeat(512)]; }), true);
  assert.equal(accepts((i) => { i.child.audiences = ["a".repeat(513)]; }), false);
  assert.equal(accepts((i) => { i.child.audiences = ["é".repeat(256)]; }), true, "256 two-byte characters are 512 bytes");
  assert.equal(accepts((i) => { i.child.audiences = ["é".repeat(257)]; }), false, "257 characters are 514 bytes");
});

test("operations: at most 64", () => {
  const ops = (n: number) => distinct(n, "op").map((name) => ({ name, selectors: [{ kind: "all" }] }));
  assert.equal(accepts((i) => { i.child.operations = ops(64); }), true);
  assert.equal(accepts((i) => { i.child.operations = ops(65); }), false);
});

test("operation name: at most 128 bytes (bytes, not characters)", () => {
  const named = (name: string) => (i: Loose) => { i.child.operations = [{ name, selectors: [{ kind: "all" }] }]; };
  assert.equal(accepts(named("n".repeat(128))), true);
  assert.equal(accepts(named("n".repeat(129))), false);
  assert.equal(accepts(named("é".repeat(64))), true);
  assert.equal(accepts(named("é".repeat(65))), false);
});

test("selectors per operation: at most 64 (counted before deduplication)", () => {
  assert.equal(accepts((i) => { i.child.operations[0].selectors = sel(64); }), true);
  assert.equal(accepts((i) => { i.child.operations[0].selectors = sel(65); }), false);
  assert.equal(accepts((i) => { i.child.operations[0].selectors = Array(64).fill({ kind: "all" }); }), true);
  assert.equal(accepts((i) => { i.child.operations[0].selectors = Array(65).fill({ kind: "all" }); }), false, "65 identical selectors are still 65");
});

test("one_of values: at most 256 (counted before deduplication)", () => {
  const oneOf = (values: unknown[]) => (i: Loose) => { i.child.operations[0].selectors = [{ kind: "one_of", path: ["p"], values }]; };
  assert.equal(accepts(oneOf(Array.from({ length: 256 }, (_, k) => k))), true);
  assert.equal(accepts(oneOf(Array.from({ length: 257 }, (_, k) => k))), false);
  assert.equal(accepts(oneOf(Array(256).fill("same"))), true);
  assert.equal(accepts(oneOf(Array(257).fill("same"))), false, "257 identical values are still 257");
});

test("path: at most 32 components, each 1 to 128 bytes (selector paths and policy paths)", () => {
  const selPath = (path: string[]) => (i: Loose) => { i.child.operations[0].selectors = [{ kind: "equals", path, value: 1 }]; };
  const sumPath = (path: string[]) => (i: Loose) => { i.child.cumulativePolicy = { windowSeconds: 60, sumPath: path, maxSum: 1 }; };
  const distinctPath = (path: string[]) => (i: Loose) => { i.child.cumulativePolicy = { windowSeconds: 60, distinctPath: path, maxDistinct: 1 }; };
  for (const [label, at] of [["selector", selPath], ["sum", sumPath], ["distinct", distinctPath]] as const) {
    assert.equal(accepts(at(distinct(32, "c"))), true, `${label}: 32 components`);
    assert.equal(accepts(at(distinct(33, "c"))), false, `${label}: 33 components`);
    assert.equal(accepts(at(["c".repeat(128)])), true, `${label}: 128-byte component`);
    assert.equal(accepts(at(["c".repeat(129)])), false, `${label}: 129-byte component`);
    assert.equal(accepts(at(["é".repeat(64)])), true, `${label}: 64 two-byte characters`);
    assert.equal(accepts(at(["é".repeat(65)])), false, `${label}: 65 two-byte characters`);
  }
});

test("the same limits apply to a child parsed from the wire", () => {
  const wire = (patch: Record<string, unknown>) => ({
    holder_thumbprint: CHILD_THUMBPRINT, audiences: ["a"], operations: [{ name: "o", selectors: [{ kind: "all" }] }],
    not_before: 1, expires_at: 2, ...patch,
  });
  assert.equal(childFromWire(wire({})).ok, true);
  assert.equal(childFromWire(wire({ audiences: distinct(65, "a") })).ok, false);
  assert.equal(childFromWire(wire({ audiences: ["a".repeat(513)] })).ok, false);
  assert.equal(childFromWire(wire({ operations: [{ name: "n".repeat(129), selectors: [{ kind: "all" }] }] })).ok, false);
  assert.equal(childFromWire(wire({ cumulative_policy: { window_seconds: 1, max_distinct: 1, distinct_path: ["c".repeat(129)] } })).ok, false);
});
