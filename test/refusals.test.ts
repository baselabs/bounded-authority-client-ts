// Refusals: every input the contract rejects returns the single closed error. Each case starts from
// a baseline proven valid in this file, so a refusal can only come from the defect under test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { childFromWire, materializeChild, reauthorizationRequestDigest } from "../src/index.js";
import type { ParentContext } from "../src/index.js";
import { CHILD_THUMBPRINT, PARENT_THUMBPRINT, baseInput, seedThumbprint } from "./helpers.js";

// The refusal tables poke deliberately malformed shapes through the typed boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

const refused = (r: { ok: boolean }): boolean => r.ok === false;

function digestRefuses(label: string, mutate: (input: Loose) => void): void {
  test(`refuses: ${label}`, () => {
    const input: Loose = baseInput();
    mutate(input);
    const r = reauthorizationRequestDigest(input);
    assert.deepEqual(r, { ok: false }, "the closed error carries no detail");
  });
}

test("baseline: the unmodified input is accepted (so every refusal below is caused by its defect)", () => {
  assert.equal(reauthorizationRequestDigest(baseInput()).ok, true);
});

// ---- the inputs the task names ---------------------------------------------------------------

digestRefuses("a float lte bound", (i) => { i.child.operations[0].selectors[1].value = 2500.5; });
digestRefuses("a float gte bound", (i) => { i.child.operations[0].selectors[1] = { kind: "gte", path: ["a"], value: 0.1 }; });
digestRefuses("a NaN bound", (i) => { i.child.operations[0].selectors[1].value = Number.NaN; });
digestRefuses("an infinite bound", (i) => { i.child.operations[0].selectors[1].value = Number.POSITIVE_INFINITY; });
digestRefuses("a bound beyond 2^53-1", (i) => { i.child.operations[0].selectors[1].value = 2 ** 53; });
digestRefuses("a string bound", (i) => { i.child.operations[0].selectors[1].value = "2500"; });
digestRefuses("a bigint bound", (i) => { i.child.operations[0].selectors[1].value = 2500n; });

digestRefuses("an uppercase invocation_id", (i) => { i.invocationId = "5B1F2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D"; });
digestRefuses("a mixed-case invocation_id", (i) => { i.invocationId = "5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4D"; });
digestRefuses("an invocation_id that is not a UUID", (i) => { i.invocationId = "not-a-uuid"; });
digestRefuses("an invocation_id without hyphens", (i) => { i.invocationId = "5b1f2c3d4e5f4a6b8c7d9e0f1a2b3c4d"; });
digestRefuses("a braced invocation_id", (i) => { i.invocationId = "{5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d}"; });
digestRefuses("a non-string invocation_id", (i) => { i.invocationId = 1; });

digestRefuses("an explicit null cumulative policy", (i) => { i.child.cumulativePolicy = null; });
digestRefuses("an explicitly undefined cumulative policy member", (i) => { i.child.cumulativePolicy = undefined; });

digestRefuses("a holder thumbprint equal to the parent's", (i) => { i.child.holderThumbprint = PARENT_THUMBPRINT; });
digestRefuses("a holder thumbprint of 31 bytes", (i) => { i.child.holderThumbprint = seedThumbprint(0x20, 31); });
digestRefuses("a holder thumbprint of 33 bytes", (i) => { i.child.holderThumbprint = seedThumbprint(0x20, 33); });
digestRefuses("a padded holder thumbprint", (i) => { i.child.holderThumbprint = `${CHILD_THUMBPRINT}=`; });
digestRefuses("a standard-alphabet holder thumbprint", (i) => { i.child.holderThumbprint = Buffer.alloc(32, 0xfb).toString("base64").replace(/=+$/, ""); });
// 32 bytes encode to 43 characters; the last carries 4 data bits and 2 trailing zero bits. Bumping
// the final character to the next alphabet letter sets a trailing bit: same length, non-canonical.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const bumpedLast = ALPHABET.charAt(ALPHABET.indexOf(CHILD_THUMBPRINT.slice(-1)) + 1);
digestRefuses("a non-canonical holder thumbprint (nonzero trailing bits)", (i) => { i.child.holderThumbprint = `${CHILD_THUMBPRINT.slice(0, 42)}${bumpedLast}`; });
digestRefuses("an empty holder thumbprint", (i) => { i.child.holderThumbprint = ""; });
digestRefuses("a non-string holder thumbprint", (i) => { i.child.holderThumbprint = 42; });
digestRefuses("a missing holder thumbprint", (i) => { delete i.child.holderThumbprint; });

digestRefuses("a v1 parent carrying a cumulative policy", (i) => {
  i.parent.contractMajor = 1;
  i.child.cumulativePolicy = { windowSeconds: 60, maxCount: 1 };
});
digestRefuses("a v1 parent without a policy (REQ-1 is not implemented here)", (i) => { i.parent.contractMajor = 1; });
digestRefuses("a v1 parent with a range selector", (i) => { i.parent.contractMajor = 1; });
digestRefuses("a major-3 parent", (i) => { i.parent.contractMajor = 3; });
digestRefuses("an unknown parent major", (i) => { i.parent.contractMajor = 4; });
digestRefuses("a missing parent major", (i) => { delete i.parent.contractMajor; });
digestRefuses("a string parent major", (i) => { i.parent.contractMajor = "2"; });
digestRefuses("a fractional parent major", (i) => { i.parent.contractMajor = 2.5; });
digestRefuses("a null parent major", (i) => { i.parent.contractMajor = null; });

// ---- unknown and missing members -------------------------------------------------------------

digestRefuses("an unknown top-level member", (i) => { i.extra = 1; });
digestRefuses("an unknown parent member", (i) => { i.parent.extra = 1; });
digestRefuses("an unknown child member", (i) => { i.child.extra = 1; });
digestRefuses("a wire-case child member (holder_thumbprint) on the typed input", (i) => { i.child.holder_thumbprint = CHILD_THUMBPRINT; });
digestRefuses("an unknown operation member", (i) => { i.child.operations[0].extra = 1; });
digestRefuses("an unknown selector member", (i) => { i.child.operations[0].selectors[0].extra = 1; });
digestRefuses("an unknown policy member", (i) => { i.child.cumulativePolicy = { windowSeconds: 60, maxCount: 1, extra: 1 }; });
digestRefuses("a selector kind outside the five", (i) => { i.child.operations[0].selectors[0] = { kind: "between", path: ["a"], value: 1 }; });
digestRefuses("an all selector with extra members", (i) => { i.child.operations[0].selectors[0] = { kind: "all", path: ["a"] }; });
digestRefuses("an equals selector without a value", (i) => { i.child.operations[0].selectors[0] = { kind: "equals", path: ["a"] }; });
digestRefuses("an equals selector carrying values", (i) => { i.child.operations[0].selectors[0] = { kind: "equals", path: ["a"], value: 1, values: [1] }; });
digestRefuses("a one_of selector carrying value", (i) => { i.child.operations[0].selectors[0] = { kind: "one_of", path: ["a"], values: [1], value: 1 }; });
digestRefuses("a missing top-level member", (i) => { delete i.consumerId; });
digestRefuses("a missing parent jti", (i) => { delete i.parent.jti; });
test("refuses: non-object inputs", () => {
  for (const bad of [undefined, null, 1, "x", [], [baseInput()], () => 1]) {
    assert.deepEqual(reauthorizationRequestDigest(bad as never), { ok: false });
  }
});
digestRefuses("a class-instance child", (i) => { i.child = new (class Child {})(); });
digestRefuses("a null child", (i) => { i.child = null; });
digestRefuses("a null materialized audiences (must be materialized first)", (i) => { i.child.audiences = null; });
digestRefuses("a null materialized operations", (i) => { i.child.operations = null; });
digestRefuses("a null materialized notBefore", (i) => { i.child.notBefore = null; });
digestRefuses("a null materialized expiresAt", (i) => { i.child.expiresAt = null; });

// ---- sets, paths, strings, numbers ------------------------------------------------------------

digestRefuses("empty audiences", (i) => { i.child.audiences = []; });
digestRefuses("empty operations", (i) => { i.child.operations = []; });
digestRefuses("an operation with no selectors", (i) => { i.child.operations[0].selectors = []; });
digestRefuses("a one_of with no values", (i) => { i.child.operations[0].selectors[0] = { kind: "one_of", path: ["a"], values: [] }; });
digestRefuses("duplicate operation names", (i) => { i.child.operations.push({ name: "data.export", selectors: [{ kind: "all" }] }); });
digestRefuses("an empty selector path", (i) => { i.child.operations[0].selectors[0].path = []; });
digestRefuses("a 33-component selector path", (i) => { i.child.operations[0].selectors[0].path = Array.from({ length: 33 }, (_, n) => `p${n}`); });
digestRefuses("a non-string path component", (i) => { i.child.operations[0].selectors[0].path = ["a", 1]; });
digestRefuses("a lone surrogate in an audience", (i) => { i.child.audiences = ["\ud800"]; });
digestRefuses("a lone surrogate in an operation name", (i) => { i.child.operations[0].name = "a\udc00"; });
digestRefuses("a lone surrogate in a JSON value", (i) => { i.child.operations[0].selectors[0].value = "\ud800"; });
digestRefuses("a lone surrogate in a JSON object key", (i) => { i.child.operations[0].selectors[0].value = { "\ud800": 1 }; });
digestRefuses("a lone surrogate in the consumer id", (i) => { i.consumerId = "\ud800"; });
digestRefuses("a non-string audience", (i) => { i.child.audiences = [1]; });
digestRefuses("a sparse audiences array", (i) => { i.child.audiences = new Array(2); });
digestRefuses("a function as an equals value", (i) => { i.child.operations[0].selectors[0].value = () => 1; });
digestRefuses("undefined as an equals value", (i) => { i.child.operations[0].selectors[0].value = undefined; });
digestRefuses("a Map as an equals value", (i) => { i.child.operations[0].selectors[0].value = new Map(); });
digestRefuses("a NaN equals value", (i) => { i.child.operations[0].selectors[0].value = Number.NaN; });
digestRefuses("a cyclic equals value", (i) => { const o: Loose = {}; o.self = o; i.child.operations[0].selectors[0].value = o; });
// A materialized child may carry a negative time inherited from a v2 parent (nbf and exp are any
// integers within 2^53 - 1), and the service encodes it as signed decimal; only the magnitude bound
// applies here. A child's own explicit time is non-negative (materializeChild refuses -1; see
// test/parent.test.ts).
digestRefuses("a notBefore below -(2^53-1)", (i) => { i.child.notBefore = -(2 ** 53); });
digestRefuses("a fractional expiresAt", (i) => { i.child.expiresAt = 1800000300.5; });
digestRefuses("an expiresAt beyond 2^53-1", (i) => { i.child.expiresAt = 2 ** 53; });
digestRefuses("a string expiresAt", (i) => { i.child.expiresAt = "1800000300"; });
digestRefuses("an empty-string-keyed, non-string parent jti", (i) => { i.parent.jti = 7; });

// ---- cumulative policy shape (contract section 6) -----------------------------------------------

const policy = (patch: Loose) => (i: Loose) => { i.child.cumulativePolicy = { windowSeconds: 60, maxCount: 1, ...patch }; };

test("baseline: the policy table's base policy is accepted", () => {
  const i: Loose = baseInput();
  policy({})(i);
  assert.equal(reauthorizationRequestDigest(i).ok, true);
  for (const valid of [
    { windowSeconds: 1, maxCount: 1 },
    { windowSeconds: 2_678_400, sumPath: ["a"], maxSum: 0 },
    { windowSeconds: 60, distinctPath: ["a"], maxDistinct: 1024 },
    { windowSeconds: 60, maxCount: 9007199254740991, sumPath: ["a"], maxSum: 9007199254740991 },
  ]) {
    const j: Loose = baseInput();
    j.child.cumulativePolicy = valid;
    assert.equal(reauthorizationRequestDigest(j).ok, true, JSON.stringify(valid));
  }
});

digestRefuses("an empty policy object", (i) => { i.child.cumulativePolicy = {}; });
digestRefuses("a policy without windowSeconds", (i) => { i.child.cumulativePolicy = { maxCount: 1 }; });
digestRefuses("windowSeconds 0", policy({ windowSeconds: 0 }));
digestRefuses("windowSeconds above 31 days", policy({ windowSeconds: 2_678_401 }));
digestRefuses("a fractional windowSeconds", policy({ windowSeconds: 60.5 }));
digestRefuses("a policy with no ceiling", (i) => { i.child.cumulativePolicy = { windowSeconds: 60 }; });
digestRefuses("maxCount 0", policy({ maxCount: 0 }));
digestRefuses("a float maxCount", policy({ maxCount: 1.5 }));
digestRefuses("maxCount above 2^53-1", policy({ maxCount: 2 ** 53 }));
digestRefuses("sumPath without maxSum", (i) => { i.child.cumulativePolicy = { windowSeconds: 60, maxCount: 1, sumPath: ["a"] }; });
digestRefuses("maxSum without sumPath", policy({ maxSum: 5 }));
digestRefuses("a negative maxSum", policy({ sumPath: ["a"], maxSum: -1 }));
digestRefuses("maxSum above 2^53-1", policy({ sumPath: ["a"], maxSum: 2 ** 53 }));
digestRefuses("distinctPath without maxDistinct", policy({ distinctPath: ["a"] }));
digestRefuses("maxDistinct without distinctPath", policy({ maxDistinct: 2 }));
digestRefuses("maxDistinct 0", policy({ distinctPath: ["a"], maxDistinct: 0 }));
digestRefuses("maxDistinct 1025", policy({ distinctPath: ["a"], maxDistinct: 1025 }));
digestRefuses("an empty sumPath", policy({ sumPath: [], maxSum: 1 }));
digestRefuses("a 33-component sumPath", policy({ sumPath: Array.from({ length: 33 }, (_, n) => `p${n}`), maxSum: 1 }));
digestRefuses("a non-string distinctPath component", policy({ distinctPath: [1], maxDistinct: 1 }));
digestRefuses("an explicit null optional policy member", policy({ maxCount: null }));
digestRefuses("an explicit undefined optional policy member", policy({ sumPath: undefined }));

// ---- the wire boundary (childFromWire) ----------------------------------------------------------

const wireChild = (): Loose => ({
  holder_thumbprint: CHILD_THUMBPRINT,
  audiences: ["https://data.example"],
  operations: [{ name: "data.export", selectors: [{ kind: "all" }] }],
  not_before: 1800000000,
  expires_at: 1800000300,
});

function wireRefuses(label: string, mutate: (child: Loose) => void): void {
  test(`wire refuses: ${label}`, () => {
    const child = wireChild();
    mutate(child);
    assert.deepEqual(childFromWire(child), { ok: false });
  });
}

test("wire baseline: the unmodified wire child parses, and omitted cumulative_policy stays absent", () => {
  const r = childFromWire(wireChild());
  assert.equal(r.ok, true);
  if (r.ok) assert.equal("cumulativePolicy" in r.value, false);
});

test("wire: a snake_case policy maps to the typed policy", () => {
  const child = wireChild();
  child.cumulative_policy = { window_seconds: 60, max_count: 2, sum_path: ["a"], max_sum: 9, distinct_path: ["b"], max_distinct: 3 };
  const r = childFromWire(child);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.value.cumulativePolicy, {
      windowSeconds: 60, maxCount: 2, sumPath: ["a"], maxSum: 9, distinctPath: ["b"], maxDistinct: 3,
    });
  }
});

wireRefuses("an explicit null cumulative_policy", (c) => { c.cumulative_policy = null; });
wireRefuses("a null optional policy member", (c) => { c.cumulative_policy = { window_seconds: 60, max_count: null, max_sum: 1, sum_path: ["a"] }; });
wireRefuses("an unknown child member", (c) => { c.extra = 1; });
wireRefuses("a camelCase child member", (c) => { c.holderThumbprint = CHILD_THUMBPRINT; });
wireRefuses("an unknown policy member", (c) => { c.cumulative_policy = { window_seconds: 60, max_count: 1, extra: 1 }; });
wireRefuses("a camelCase policy member", (c) => { c.cumulative_policy = { windowSeconds: 60, max_count: 1 }; });
wireRefuses("a missing audiences member (null inherits; absence is not null)", (c) => { delete c.audiences; });
wireRefuses("a missing operations member", (c) => { delete c.operations; });
wireRefuses("a missing not_before member", (c) => { delete c.not_before; });
wireRefuses("a missing expires_at member", (c) => { delete c.expires_at; });
wireRefuses("a missing holder_thumbprint member", (c) => { delete c.holder_thumbprint; });
wireRefuses("a null holder_thumbprint", (c) => { c.holder_thumbprint = null; });
wireRefuses("a float lte bound", (c) => { c.operations = [{ name: "o", selectors: [{ kind: "lte", path: ["a"], value: 1.5 }] }]; });
wireRefuses("an empty audiences array", (c) => { c.audiences = []; });

test("wire: a non-object child is refused", () => {
  for (const bad of [null, undefined, 1, "x", [], [wireChild()]]) assert.deepEqual(childFromWire(bad), { ok: false });
});

// ---- materialization --------------------------------------------------------------------------------

const parentContext = (): ParentContext => ({
  jti: "parent-grant-01",
  contractMajor: 2,
  holderThumbprint: PARENT_THUMBPRINT,
  audiences: ["https://data.example", "other"],
  operations: [{ name: "o", selectors: [{ kind: "lte", path: ["n"], value: 9 }] }],
  notBefore: 100,
  expiresAt: 200,
});

const requested = (): Loose => ({
  holderThumbprint: CHILD_THUMBPRINT,
  audiences: null,
  operations: null,
  notBefore: null,
  expiresAt: null,
});

test("materialize: null audiences, operations, notBefore, expiresAt inherit the parent's exact values", () => {
  const r = materializeChild(requested(), parentContext());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value, {
    holderThumbprint: CHILD_THUMBPRINT,
    audiences: ["https://data.example", "other"],
    operations: [{ name: "o", selectors: [{ kind: "lte", path: ["n"], value: 9 }] }],
    notBefore: 100,
    expiresAt: 200,
  });
});

test("materialize: explicit values override inheritance member by member", () => {
  const r = materializeChild({ ...requested(), audiences: ["https://data.example"], notBefore: 150 }, parentContext());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value.audiences, ["https://data.example"]);
  assert.equal(r.value.notBefore, 150);
  assert.equal(r.value.expiresAt, 200);
});

test("materialize: the policy is never inherited and is carried through when present", () => {
  const withPolicy = materializeChild({ ...requested(), cumulativePolicy: { windowSeconds: 5, maxCount: 1 } }, parentContext());
  assert.equal(withPolicy.ok, true);
  if (withPolicy.ok) assert.deepEqual(withPolicy.value.cumulativePolicy, { windowSeconds: 5, maxCount: 1 });
  const without = materializeChild(requested(), parentContext());
  assert.equal(without.ok && "cumulativePolicy" in without.value, false);
});

function materializeRefuses(label: string, mutateChild: (c: Loose) => void, mutateParent: (p: Loose) => void = () => undefined): void {
  test(`materialize refuses: ${label}`, () => {
    const child = requested();
    const parent: Loose = parentContext();
    mutateChild(child);
    mutateParent(parent);
    assert.deepEqual(materializeChild(child, parent), { ok: false });
  });
}

materializeRefuses("a thumbprint equal to the parent's", (c) => { c.holderThumbprint = PARENT_THUMBPRINT; });
materializeRefuses("a v1 parent with a child policy", (c) => { c.cumulativePolicy = { windowSeconds: 5, maxCount: 1 }; }, (p) => { p.contractMajor = 1; });
materializeRefuses("a v1 parent", () => undefined, (p) => { p.contractMajor = 1; });
materializeRefuses("a major-3 parent", () => undefined, (p) => { p.contractMajor = 3; });
materializeRefuses("a missing parent major", () => undefined, (p) => { delete p.contractMajor; });
materializeRefuses("a null child policy", (c) => { c.cumulativePolicy = null; });
materializeRefuses("an unknown child member", (c) => { c.extra = 1; });
materializeRefuses("an unknown parent member", () => undefined, (p) => { p.extra = 1; });
materializeRefuses("a parent whose own thumbprint is not canonical", () => undefined, (p) => { p.holderThumbprint = "abc"; });
materializeRefuses("a parent with empty audiences when the child inherits", () => undefined, (p) => { p.audiences = []; });
materializeRefuses("a parent with a float bound when the child inherits", () => undefined, (p) => { p.operations = [{ name: "o", selectors: [{ kind: "lte", path: ["n"], value: 1.5 }] }]; });
materializeRefuses("a parent with a null expiry when the child inherits", () => undefined, (p) => { p.expiresAt = null; });

test("materialize: an explicit child value shadows an invalid parent value it does not use", () => {
  // The parent's values are validated even when unused: the parent context is caller input too.
  const parent: Loose = parentContext();
  parent.expiresAt = null;
  assert.deepEqual(materializeChild({ ...requested(), expiresAt: 300 }, parent), { ok: false });
});

test("explicit inherited values and their null forms produce the same digest", () => {
  const parent = parentContext();
  const viaNull = materializeChild(requested(), parent);
  const viaExplicit = materializeChild({
    holderThumbprint: CHILD_THUMBPRINT,
    audiences: [...parent.audiences].reverse(), // order is irrelevant to the digest
    operations: structuredClone(parent.operations) as never,
    notBefore: parent.notBefore,
    expiresAt: parent.expiresAt,
  }, parent);
  assert.equal(viaNull.ok && viaExplicit.ok, true);
  if (!viaNull.ok || !viaExplicit.ok) return;
  const input = (child: typeof viaNull.value) => ({
    parent: { jti: parent.jti, contractMajor: parent.contractMajor, holderThumbprint: parent.holderThumbprint },
    invocationId: "5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    consumerId: "demo-agent",
    child,
  });
  const a = reauthorizationRequestDigest(input(viaNull.value));
  const b = reauthorizationRequestDigest(input(viaExplicit.value));
  assert.equal(a.ok && b.ok, true);
  if (a.ok && b.ok) assert.equal(a.value.requestSha256, b.value.requestSha256);
});

test("refusals never throw: hostile inputs return the closed error", () => {
  const hostile: unknown[] = [
    undefined, null, 0, "", [], () => 1, Symbol("x"), 1n,
    { get parent() { return 1; } },
    Object.create(null),
    new Proxy({}, {}),
  ];
  for (const h of hostile) {
    assert.equal(refused(reauthorizationRequestDigest(h as never)), true);
    assert.equal(refused(childFromWire(h)), true);
    assert.equal(refused(materializeChild(h as never, h as never)), true);
  }
});

// Every trap throws: caller input is untrusted, and the public boundary turns even a failure that
// is not a protocol refusal into the closed error.
const trap = (): never => { throw new Error("hostile trap"); };
const throwingProxy = (target: object = {}): object =>
  new Proxy(target, {
    get: trap, has: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap, set: trap,
    defineProperty: trap, deleteProperty: trap, isExtensible: trap, preventExtensions: trap, setPrototypeOf: trap,
  });

test("a throwing Proxy anywhere in the input returns the closed error, never a throw", () => {
  const nested = (path: (i: Loose) => void): Loose => { const i: Loose = baseInput(); path(i); return i; };
  const inputs: Loose[] = [
    throwingProxy(),
    throwingProxy([]),
    nested((i) => { i.child = throwingProxy(); }),
    nested((i) => { i.parent = throwingProxy(); }),
    nested((i) => { i.child.audiences = throwingProxy([]); }),
    nested((i) => { i.child.operations = throwingProxy([]); }),
    nested((i) => { i.child.operations[0].selectors[0] = throwingProxy(); }),
    nested((i) => { i.child.operations[0].selectors[0].value = throwingProxy(); }),
    nested((i) => { i.child.cumulativePolicy = throwingProxy(); }),
  ];
  for (const input of inputs) {
    assert.deepEqual(reauthorizationRequestDigest(input), { ok: false });
    assert.deepEqual(childFromWire(input), { ok: false });
    assert.deepEqual(materializeChild(input, input), { ok: false });
    assert.deepEqual(materializeChild(requested(), input), { ok: false });
    assert.deepEqual(materializeChild(input, parentContext()), { ok: false });
  }
});
