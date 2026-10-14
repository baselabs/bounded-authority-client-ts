// The two child entry points refuse the same inputs. childFromWire(JSON.parse(text)) and
// childFromWireText(text) must agree on accept or refuse, and on the value when both accept, for
// every text without duplicate member names or non-integer spellings of integer fields (the two
// things only the text shows). Every selector value is checked against its canonical-JSON bounds
// up front, on both paths, and the text reader adds no whole-document limit of its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { childFromWire, childFromWireText } from "../src/index.js";
import { CHILD_THUMBPRINT } from "./helpers.js";

const agree = (child: unknown): { wire: boolean; text: boolean } => {
  const text = JSON.stringify(child);
  const wire = childFromWire(JSON.parse(text));
  const fromText = childFromWireText(text);
  if (wire.ok && fromText.ok) assert.deepEqual(fromText.value, wire.value);
  return { wire: wire.ok, text: fromText.ok };
};

const child = (selectors: unknown[], extra: Record<string, unknown> = {}) => ({
  holder_thumbprint: CHILD_THUMBPRINT,
  audiences: ["https://data.example"],
  operations: [{ name: "data.export", selectors }],
  not_before: 1800000000,
  expires_at: 1800000300,
  ...extra,
});

const nest = (depth: number): unknown => {
  let v: unknown = "x";
  for (let i = 1; i < depth; i++) v = [v];
  return v;
};

test("parity: a 16-operation, 64-selectors-each child of about 42 KB is accepted by both paths", () => {
  const operations = Array.from({ length: 16 }, (_, o) => ({
    name: `data.export.${o}`,
    selectors: Array.from({ length: 64 }, (_, s) => ({ kind: "equals", path: ["field", `f${s}`], value: `value-${o}-${s}-padding` })),
  }));
  const big = { ...child([]), operations };
  assert.ok(JSON.stringify(big).length > 40_000, `child is ${JSON.stringify(big).length} bytes`);
  assert.deepEqual(agree(big), { wire: true, text: true });
});

test("parity: a value at each canonical-JSON bound is accepted, and one past it is refused, by both paths", () => {
  const cases: [string, unknown, unknown][] = [
    ["string bytes", "a".repeat(8192), "a".repeat(8193)],
    ["array items", Array(256).fill(1), Array(257).fill(1)],
    ["object members", Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`k${i}`, i])), Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, i]))],
    ["member-name bytes", { ["k".repeat(128)]: 1 }, { ["k".repeat(129)]: 1 }],
    ["integer magnitude", 9007199254740991, 9007199254740993],
    ["nesting depth", nest(32), nest(33)],
  ];
  for (const [label, within, beyond] of cases) {
    assert.deepEqual(agree(child([{ kind: "equals", path: ["v"], value: within }])), { wire: true, text: true }, `${label}: within`);
    assert.deepEqual(agree(child([{ kind: "equals", path: ["v"], value: beyond }])), { wire: false, text: false }, `${label}: beyond`);
    assert.deepEqual(agree(child([{ kind: "one_of", path: ["v"], values: [beyond] }])), { wire: false, text: false }, `${label}: beyond, in one_of`);
  }
});

test("parity: total nodes in one value are bounded at 4,096 on both paths", () => {
  // Every other bound respected: 15 arrays of 255 integers are 15 * 256 + 1 = 3,841 nodes; 17 are
  // 17 * 256 + 1 = 4,353.
  const within = Array.from({ length: 15 }, () => Array(255).fill(1));
  const beyond = Array.from({ length: 17 }, () => Array(255).fill(1));
  assert.deepEqual(agree(child([{ kind: "equals", path: ["v"], value: within }])), { wire: true, text: true });
  assert.deepEqual(agree(child([{ kind: "equals", path: ["v"], value: beyond }])), { wire: false, text: false });
});

// ---- the property --------------------------------------------------------------------------

// Mostly valid children, so that the bounds on selector values decide often: each generator puts
// most of its weight on a valid choice and some on an invalid one.
const label = fc.oneof({ weight: 8, arbitrary: fc.string({ minLength: 1, maxLength: 3 }) }, { weight: 1, arbitrary: fc.constant("") });
const jsonValue = fc.oneof(
  { weight: 4, arbitrary: fc.jsonValue({ maxDepth: 3 }) },
  { weight: 1, arbitrary: fc.integer({ min: 28, max: 36 }).map(nest) },
  { weight: 1, arbitrary: fc.integer({ min: 8190, max: 8194 }).map((n) => "s".repeat(n)) },
  { weight: 1, arbitrary: fc.integer({ min: 254, max: 258 }).map((n) => Array(n).fill(0)) },
  { weight: 1, arbitrary: fc.integer({ min: 62, max: 66 }).map((n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`m${i}`, i]))) },
  { weight: 1, arbitrary: fc.integer({ min: 126, max: 130 }).map((n) => ({ ["k".repeat(n)]: 1 })) },
  { weight: 1, arbitrary: fc.integer({ min: 14, max: 18 }).map((n) => Array.from({ length: n }, () => Array(255).fill(1))) },
  { weight: 1, arbitrary: fc.oneof(fc.double(), fc.constantFrom(2 ** 53 - 1, 2 ** 53, -(2 ** 53), 1e300, 0.5)) },
);
const path = fc.oneof({ weight: 8, arbitrary: fc.array(label, { minLength: 1, maxLength: 3 }) }, { weight: 1, arbitrary: fc.constant([]) });
const bound = fc.oneof({ weight: 4, arbitrary: fc.integer() }, { weight: 1, arbitrary: fc.double() }, { weight: 1, arbitrary: fc.constantFrom(2 ** 53 - 1, 2 ** 53) });
const selector = fc.oneof(
  { weight: 2, arbitrary: fc.constant({ kind: "all" }) },
  { weight: 6, arbitrary: fc.record({ kind: fc.constant("equals"), path, value: jsonValue }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constantFrom("lte", "gte"), path, value: bound }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant("one_of"), path, values: fc.array(jsonValue, { minLength: 1, maxLength: 3 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constantFrom("all", "lt", "equals"), path, values: fc.array(jsonValue, { maxLength: 2 }) }) },
);
const policy = fc.record(
  {
    window_seconds: fc.oneof({ weight: 4, arbitrary: fc.integer({ min: 1, max: 2_678_400 }) }, { weight: 1, arbitrary: fc.constantFrom(0, 2_678_401, 1.5) }),
    max_count: fc.integer({ min: 0, max: 5 }),
    sum_path: path,
    max_sum: fc.integer({ min: -1, max: 5 }),
    distinct_path: path,
    max_distinct: fc.integer({ min: 0, max: 1025 }),
  },
  { requiredKeys: ["window_seconds"] },
);
const operations = fc.uniqueArray(
  fc.record({ name: fc.oneof(label, fc.constant("op")), selectors: fc.array(selector, { minLength: 1, maxLength: 3 }) }),
  { minLength: 1, maxLength: 3, selector: (o) => o.name },
);
const generatedChild = fc.record(
  {
    holder_thumbprint: fc.oneof({ weight: 8, arbitrary: fc.constant(CHILD_THUMBPRINT) }, { weight: 1, arbitrary: fc.constantFrom("short", CHILD_THUMBPRINT + "=") }),
    audiences: fc.oneof({ weight: 1, arbitrary: fc.constant(null) }, { weight: 6, arbitrary: fc.array(fc.oneof(label, fc.constant("https://a.example")), { minLength: 1, maxLength: 3 }) }),
    operations: fc.oneof({ weight: 1, arbitrary: fc.constant(null) }, { weight: 8, arbitrary: operations }),
    not_before: fc.oneof({ weight: 1, arbitrary: fc.constant(null) }, { weight: 6, arbitrary: fc.integer({ min: 0, max: 5 }) }, { weight: 1, arbitrary: fc.constantFrom(-1, 1.5) }),
    expires_at: fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 2 ** 31 })),
    cumulative_policy: policy,
  },
  { requiredKeys: ["holder_thumbprint", "audiences", "operations", "not_before", "expires_at"] },
);

test("parity property: both paths accept or refuse every generated child alike, with equal values", () => {
  let accepted = 0;
  fc.assert(
    fc.property(generatedChild, (c) => {
      const r = agree(c);
      if (r.wire) accepted++;
      return r.wire === r.text;
    }),
    { numRuns: 2000 },
  );
  // Known positive: the generator reaches both outcomes (a property over refusals alone is vacuous).
  assert.ok(accepted > 50, `accepted ${accepted} of 2000`);
});
