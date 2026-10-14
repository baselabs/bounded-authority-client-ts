// The parent side: materializeChild accepts every parent selector the v2 wire profile accepts
// (spec/bap-v2.md §4: an `all` selector on any recognized member set, with inert members, and
// numeric lte/gte bounds, integral or not), and parentContextFromGrant reads a ParentContext from
// a real signed v2 grant. Inheritance carries what the REQ-2 projection can encode: an inherited
// `all` is encoded as `all` (its inert members carry no authority), and an inherited fractional
// bound is refused, because the REQ-2 projection admits integer bounds only.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Tagged } from "@bounded-authority-protocol/verifier";
import { materializeChild, parentContextFromGrant, reauthorizationRequestDigest } from "../src/index.js";
import type { MaterializedChild, ParentContext, RequestedChild } from "../src/index.js";
import { CHILD_THUMBPRINT, INVOCATION, PARENT_THUMBPRINT } from "./helpers.js";
import { GRANT_BASE, craftedGrant, producedGrant, producedV1Grant, tag } from "./grants.js";

const parent = (selectors: unknown[]): ParentContext =>
  ({
    jti: "parent-grant-01",
    contractMajor: 2,
    holderThumbprint: PARENT_THUMBPRINT,
    audiences: ["https://data.example"],
    operations: [{ name: "data.export", selectors }],
    notBefore: 1800000000,
    expiresAt: 1800003600,
  }) as never;

const explicitChild: RequestedChild = {
  holderThumbprint: CHILD_THUMBPRINT,
  audiences: ["https://data.example"],
  operations: [{ name: "data.export", selectors: [{ kind: "lte", path: ["row_count"], value: 500 }] }],
  notBefore: null,
  expiresAt: null,
};
const inheritingChild: RequestedChild = { ...explicitChild, operations: null };

const digestOf = (child: MaterializedChild): string => {
  const d = reauthorizationRequestDigest({
    parent: { jti: "parent-grant-01", contractMajor: 2, holderThumbprint: PARENT_THUMBPRINT },
    invocationId: INVOCATION,
    consumerId: "demo-agent",
    child,
  });
  assert.equal(d.ok, true);
  return d.ok ? d.value.requestSha256 : "";
};

// ---- spec-valid parents --------------------------------------------------------------------

const specValid: [string, unknown[]][] = [
  ["an all selector with inert path and value", [{ kind: "all", path: ["anything"], value: { inert: true } }]],
  ["an all selector with inert path and values", [{ kind: "all", path: ["p"], values: [1, "two"] }]],
  ["an all selector whose inert members are not a valid path or array", [{ kind: "all", path: 7, values: "x" }]],
  ["a fractional lte bound", [{ kind: "lte", path: ["ratio"], value: 2.5 }]],
  ["a fractional gte bound", [{ kind: "gte", path: ["ratio"], value: -0.25 }]],
  ["a bound at the float magnitude limit", [{ kind: "lte", path: ["x"], value: 9007199254740991 }]],
];

for (const [label, selectors] of specValid) {
  test(`parent accepted: ${label} (child gives its own operations)`, () => {
    const r = materializeChild(explicitChild, parent(selectors));
    assert.equal(r.ok, true);
  });
}

test("parent: an inherited all with inert members is encoded exactly as a plain all", () => {
  const inert = materializeChild(inheritingChild, parent([{ kind: "all", path: ["p"], value: 1 }]));
  const plain = materializeChild(inheritingChild, parent([{ kind: "all" }]));
  assert.equal(inert.ok && plain.ok, true);
  if (!inert.ok || !plain.ok) return;
  assert.deepEqual(inert.value.operations, [{ name: "data.export", selectors: [{ kind: "all" }] }]);
  assert.equal(digestOf(inert.value), digestOf(plain.value));
});

test("parent: an inherited fractional bound is refused (REQ-2 bounds are integers)", () => {
  assert.deepEqual(materializeChild(inheritingChild, parent([{ kind: "lte", path: ["ratio"], value: 2.5 }])), { ok: false });
});

test("parent: an inherited integer bound is carried exactly", () => {
  const r = materializeChild(inheritingChild, parent([{ kind: "lte", path: ["row_count"], value: 10000 }]));
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value.operations, [{ name: "data.export", selectors: [{ kind: "lte", path: ["row_count"], value: 10000 }] }]);
});

// ---- spec-invalid parents ------------------------------------------------------------------

const specInvalid: [string, unknown[]][] = [
  ["an all selector with path only (not a recognized member set)", [{ kind: "all", path: ["p"] }]],
  ["an all selector with value and values", [{ kind: "all", path: ["p"], value: 1, values: [1] }]],
  ["an unknown kind", [{ kind: "lt", path: ["p"], value: 1 }]],
  ["a string lte bound", [{ kind: "lte", path: ["p"], value: "5" }]],
  ["a bound beyond the float magnitude", [{ kind: "gte", path: ["p"], value: 9007199254740992.5 * 2 }]],
  ["an equals selector with a non-string path segment", [{ kind: "equals", path: [1], value: 1 }]],
  ["a one_of selector with no values", [{ kind: "one_of", path: ["p"], values: [] }]],
  ["an equals value nested deeper than the selector-value depth", [{ kind: "equals", path: ["p"], value: nest(40) }]],
];

function nest(depth: number): unknown {
  let v: unknown = 1;
  for (let i = 0; i < depth; i++) v = [v];
  return v;
}

for (const [label, selectors] of specInvalid) {
  test(`parent refused: ${label}`, () => {
    assert.deepEqual(materializeChild(explicitChild, parent(selectors)), { ok: false });
  });
}

// ---- parentContextFromGrant ----------------------------------------------------------------

test("parentContextFromGrant: reads the parent context from a signed v2 grant", () => {
  const compact = producedGrant([
    { name: "data.export", selectors: [{ kind: "lte", path: ["row_count"], value: tag.int(10000) }, { kind: "equals", path: ["format"], value: tag.str("csv") }] },
    { name: "docs.read", selectors: ["all"] },
  ]);
  const r = parentContextFromGrant(compact);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value, {
    jti: GRANT_BASE.grantId,
    contractMajor: 2,
    holderThumbprint: GRANT_BASE.holderThumbprint,
    audiences: GRANT_BASE.audiences,
    operations: [
      { name: "data.export", selectors: [{ kind: "lte", path: ["row_count"], value: 10000 }, { kind: "equals", path: ["format"], value: "csv" }] },
      { name: "docs.read", selectors: [{ kind: "all" }] },
    ],
    notBefore: GRANT_BASE.notBefore,
    expiresAt: GRANT_BASE.expiresAt,
  });
  // The context feeds materializeChild and the digest directly.
  const child = materializeChild({ ...inheritingChild, audiences: null }, r.value);
  assert.equal(child.ok, true);
  if (child.ok) assert.equal(digestOf(child.value).length, 43);
});

test("parentContextFromGrant: a fractional bound and an inert all are read as the grant carries them", () => {
  const compact = craftedGrant({
    t: "array",
    v: [
      obj({ name: tag.str("calendar.schedule"), selectors: arr([obj({ kind: tag.str("lte"), path: arr([tag.str("hours")]), value: tag.float(1.5) })]) }),
      obj({ name: tag.str("docs.read"), selectors: arr([obj({ kind: tag.str("all"), path: arr([tag.str("folder")]), value: tag.str("inert") })]) }),
    ],
  });
  const r = parentContextFromGrant(compact);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value.operations, [
    { name: "calendar.schedule", selectors: [{ kind: "lte", path: ["hours"], value: 1.5 }] },
    { name: "docs.read", selectors: [{ kind: "all", path: ["folder"], value: "inert" }] },
  ]);
  // The child may narrow it with its own integer operations; inheriting the fractional bound is refused.
  assert.equal(materializeChild({ ...explicitChild, audiences: null }, r.value).ok, true);
  assert.deepEqual(materializeChild({ ...inheritingChild, audiences: null }, r.value), { ok: false });
});

test("parentContextFromGrant: refuses a v1 grant, a malformed compact, and non-string input", () => {
  assert.deepEqual(parentContextFromGrant(producedV1Grant([{ name: "docs.read", selectors: ["all"] }])), { ok: false });
  const good = producedGrant([{ name: "docs.read", selectors: ["all"] }]);
  assert.equal(parentContextFromGrant(good).ok, true, "baseline: the v2 grant is read");
  for (const bad of [good.slice(0, -1) + "!", good.split(".").slice(0, 2).join("."), "", "a.b.c"]) {
    assert.deepEqual(parentContextFromGrant(bad), { ok: false }, bad.slice(0, 20));
  }
  for (const bad of [undefined, null, 1, {}, new Uint8Array(3)]) assert.deepEqual(parentContextFromGrant(bad as never), { ok: false });
});

function obj(members: Record<string, Tagged>): Tagged {
  return { t: "object", v: new Map(Object.entries(members)) };
}
function arr(items: Tagged[]): Tagged {
  return { t: "array", v: items };
}

