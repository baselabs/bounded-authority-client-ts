// childFromWireText: the text-level entry. It sees the JSON spelling, so it can refuse what a
// parsed value hides: duplicate member names, and integer fields spelled with a fraction or
// exponent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { childFromWire, childFromWireText, materializeChild, reauthorizationRequestDigest } from "../src/index.js";
import { CHILD_THUMBPRINT, PARENT_THUMBPRINT, loadVectors, toHex } from "./helpers.js";

const T = CHILD_THUMBPRINT;
const child = (o: { nb?: string; exp?: string; val?: string; extra?: string; policy?: string; equals?: string } = {}): string =>
  `{"holder_thumbprint":"${T}","audiences":["a"],${o.extra ?? ""}"not_before":${o.nb ?? "1"},"expires_at":${o.exp ?? "2"},` +
  `"operations":[{"name":"o","selectors":[{"kind":"lte","path":["p"],"value":${o.val ?? "5"}}${o.equals === undefined ? "" : `,{"kind":"equals","path":["q"],"value":${o.equals}}`}]}]` +
  `${o.policy === undefined ? "" : `,"cumulative_policy":${o.policy}`}}`;

const refuses = (label: string, text: string): void => {
  test(`text refuses: ${label}`, () => assert.deepEqual(childFromWireText(text), { ok: false }));
};

test("text baseline: a plain child parses to the same value as the parsed object", () => {
  const text = childFromWireText(child());
  assert.equal(text.ok, true);
  assert.deepEqual(text, childFromWire(JSON.parse(child())));
});

test("text: -0 is the integer zero (the service reads it as an integer)", () => {
  const r = childFromWireText(child({ val: "-0" }));
  assert.equal(r.ok, true);
});

refuses("a duplicate member name in the child", child({ extra: '"audiences":["b"],' }));
refuses("a duplicate member name in a selector", child().replace('"kind":"lte"', '"kind":"lte","kind":"lte"'));
refuses("a duplicate member name in a policy", child({ policy: '{"window_seconds":1,"max_count":1,"max_count":2}' }));
refuses("an lte bound spelled 5.0", child({ val: "5.0" }));
refuses("an lte bound spelled 1E2", child({ val: "1E2" }));
refuses("an lte bound spelled 1e2", child({ val: "1e2" }));
refuses("an lte bound spelled -0.0", child({ val: "-0.0" }));
refuses("a not_before spelled 1.0", child({ nb: "1.0" }));
refuses("an expires_at spelled 2e0", child({ exp: "2e0" }));
refuses("a policy window spelled 60.0", child({ policy: '{"window_seconds":60.0,"max_count":1}' }));
refuses("a max_count spelled 1e0", child({ policy: '{"window_seconds":60,"max_count":1e0}' }));
refuses("a max_sum spelled 5.0", child({ policy: '{"window_seconds":60,"sum_path":["a"],"max_sum":5.0}' }));
refuses("a true float bound", child({ val: "1.5" }));
refuses("a number with a leading zero", child({ val: "05" }));
refuses("invalid JSON", "{");
refuses("trailing bytes after the value", `${child()} x`);
refuses("a non-object value", "[]");
refuses("an explicit null policy", child({ policy: "null" }));
refuses("an unknown member", child({ extra: '"extra":1,' }).replace('"extra":1,', '"extra":1,'));
refuses("a lone surrogate in the text", child().replace('"a"', '"\ud800"'));
refuses("an escaped lone surrogate", child().replace('"a"', '"\\ud800"'));

test("text refuses non-string input", () => {
  for (const bad of [undefined, null, 1, {}, [], Symbol("x")]) assert.deepEqual(childFromWireText(bad as never), { ok: false });
});

test("text: float spellings are fine inside equals values and canonicalize to the same bytes", () => {
  const base = { holderThumbprint: "x" };
  void base;
  const digestOf = (equals: string): string => {
    const r = childFromWireText(child({ equals }));
    assert.equal(r.ok, true, equals);
    if (!r.ok) return "";
    const m = materializeChild(r.value, {
      jti: "j", contractMajor: 2, holderThumbprint: PARENT_THUMBPRINT, audiences: ["a"],
      operations: [{ name: "o", selectors: [{ kind: "all" }] }], notBefore: 1, expiresAt: 2,
    });
    assert.equal(m.ok, true);
    if (!m.ok) return "";
    const d = reauthorizationRequestDigest({
      parent: { jti: "j", contractMajor: 2, holderThumbprint: PARENT_THUMBPRINT },
      invocationId: "5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", consumerId: "c", child: m.value,
    });
    assert.equal(d.ok, true);
    return d.ok ? toHex(d.value.projection) : "";
  };
  assert.equal(digestOf("2.0"), digestOf("2"));
  assert.equal(digestOf("1E2"), digestOf("100"));
  assert.equal(digestOf("-0.0"), digestOf("0"));
  assert.notEqual(digestOf("2.5"), digestOf("2"));
});

test("text: every vector child parses identically from its JSON text and from the parsed value", () => {
  for (const v of loadVectors().vectors) {
    const text = childFromWireText(JSON.stringify(v.child));
    assert.equal(text.ok, true, v.name);
    assert.deepEqual(text, childFromWire(v.child), v.name);
  }
});
