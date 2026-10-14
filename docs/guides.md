# Guides

Task-by-task instructions for `@bounded-authority/client`. The [API reference](api.md) lists every
member and refusal; the [REQ-2 projection](req2-projection.md) specifies the bytes. Every sample on
this page runs in `pnpm test` (`test/docs.test.ts`), and each `// prints:` comment is what the
sample prints.

- [Where the inputs come from](#where-the-inputs-come-from)
- [Bind the digest into a v2 proof](#bind-the-digest-into-a-v2-proof)
- [Inherit values from the parent](#inherit-values-from-the-parent)
- [Handle a refusal](#handle-a-refusal)
- [Test your integration against the vectors](#test-your-integration-against-the-vectors)
- [Use it in a browser](#use-it-in-a-browser)

## Where the inputs come from

A reauthorization request asks the service to issue a child grant under a parent grant that the
holder already has. The digest needs these values:

| Input | Source |
|---|---|
| `parent` (`jti`, `contractMajor`, `holderThumbprint`, `audiences`, `operations`, `notBefore`, `expiresAt`) | The parent grant itself: `parentContextFromGrant(parentGrantCompact)` reads them from its `jti`, `cnf.jkt`, `aud`, `operations`, `nbf`, and `exp` claims. |
| `child` | The child you are asking for: the `child` member of the request body. |
| `invocationId` | The request's invocation ID, a canonical lowercase UUID. `crypto.randomUUID()` returns this form. |
| `consumerId` | The submitting consumer's stable handle, not its credential identifier. |

The parent's audiences, operations, and validity window matter only for members the child sends
as `null`: see [Inherit values from the parent](#inherit-values-from-the-parent). From the parent
grant to the digest:

```ts
import { childFromWireText, materializeChild, parentContextFromGrant, reauthorizationRequestDigest } from "@bounded-authority/client";

// The parent grant the holder already has (a demo v2 grant signed with a demo issuer key).
const parentGrant = [
  "eyJhbGciOiJFZERTQSIsImtpZCI6ImRlbW8taXNzdWVyLWtleS0xIiwidHlwIjoiYmErY2FwIn0.eyJhdWQiOlsiaHR0cHM6",
  "Ly9kYXRhLmV4YW1wbGUiXSwiY25mIjp7ImprdCI6IkFBRUNBd1FGQmdjSUNRb0xEQTBPRHhBUkVoTVVGUllYR0JrYUd4d2RI",
  "aDgifSwiZXhwIjoxODAwMDAzNjAwLCJpYXQiOjE3OTk5OTk5OTAsImlzcyI6Imh0dHBzOi8vaXNzdWVyLmV4YW1wbGUiLCJq",
  "dGkiOiJwYXJlbnQtZ3JhbnQtMDEiLCJuYmYiOjE4MDAwMDAwMDAsIm9wZXJhdGlvbnMiOlt7Im5hbWUiOiJkYXRhLmV4cG9y",
  "dCIsInNlbGVjdG9ycyI6W3sia2luZCI6Imx0ZSIsInBhdGgiOlsicm93X2NvdW50Il0sInZhbHVlIjoxMDAwMH0seyJraW5k",
  "IjoiZXF1YWxzIiwicGF0aCI6WyJmb3JtYXQiXSwidmFsdWUiOiJjc3YifV19XSwidiI6Mn0.lVEYkefNdCUy6s1BYqpYBMkb",
  "rqfUYBE1XPnh5XSogSfJ6lwn8xNX5FU9ryXrFAu0nFf8Qi9XnmDVE0HlQbkrBw",
].join("");

const parent = parentContextFromGrant(parentGrant);
if (!parent.ok) throw new Error("not a v2 grant");

// The child narrows the parent: 500 rows of one dataset; it inherits the audiences and window.
const requested = childFromWireText(`{
  "holder_thumbprint": "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8",
  "audiences": null,
  "operations": [{ "name": "data.export", "selectors": [
    { "kind": "lte", "path": ["row_count"], "value": 500 },
    { "kind": "equals", "path": ["format"], "value": "csv" },
    { "kind": "equals", "path": ["dataset"], "value": "inventory" }
  ] }],
  "not_before": null,
  "expires_at": 1800000300
}`);
if (!requested.ok) throw new Error("the child was refused");

const child = materializeChild(requested.value, parent.value);
if (!child.ok) throw new Error("the child was refused");

const digest = reauthorizationRequestDigest({
  parent: { jti: parent.value.jti, contractMajor: parent.value.contractMajor, holderThumbprint: parent.value.holderThumbprint },
  invocationId: "5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  consumerId: "demo-agent",
  child: child.value,
});
console.log(digest.ok && digest.value.requestSha256); // prints: ZEJZyH3UFj_kT81x2WOW-gcPLBOSqtOFqBKsbTT-VO4
```

The child inherits `https://data.example` and `not_before` 1800000000 from the grant, so this is
the `lte-child` vector again.

## Bind the digest into a v2 proof

The digest reaches the service inside the holder's v2 proof, as `cast_arguments.request_sha256`
for operation `authority.grants.reauthorize`. The verifier
package's v2 producer binds the operation and cast arguments with its own `BAP2-REQUEST` digest,
so a change to any child field changes what the proof signs.

```ts
import { v2 } from "@bounded-authority-protocol/verifier";
import type { Tagged } from "@bounded-authority-protocol/verifier";
import { reauthorizationRequestDigest } from "@bounded-authority/client";

// The child-with-policy vector: send email, at most 20 messages an hour.
const digest = reauthorizationRequestDigest({
  parent: { jti: "parent-grant-01", contractMajor: 2, holderThumbprint: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8" },
  invocationId: "5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4f",
  consumerId: "demo-assistant",
  child: {
    holderThumbprint: "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8",
    audiences: ["https://messages.example"],
    operations: [{ name: "messages.send", selectors: [{ kind: "equals", path: ["channel"], value: "email" }] }],
    notBefore: 1800000000,
    expiresAt: 1800000300,
    cumulativePolicy: { windowSeconds: 3600, maxCount: 20 },
  },
});
if (!digest.ok) throw new Error("the request was refused");
console.log(digest.value.requestSha256); // prints: A2tvJ94Ytl1VvoYOQcMkgFyNcnuPx3iK-Lf5tmgmWzY

// The proof's cast arguments, in the verifier package's tagged JSON form.
const castArguments: Tagged = {
  t: "object",
  v: new Map([["request_sha256", { t: "string", v: new TextEncoder().encode(digest.value.requestSha256) }]]),
};

// What the v2 proof binds for this operation and these cast arguments: a 32-byte digest.
const bound = v2.requestDigest("authority.grants.reauthorize", castArguments);
console.log(bound.ok && bound.value.length); // prints: 32
```

To build the proof itself, pass `operation: "authority.grants.reauthorize"` and these
`castArguments` to the verifier package's `v2.proofSigningInput`, together with the other
`ProofProducer` members (`holderPublicKey`, `proofId`, `method`, `targetUri`, `issuedAt`,
`invocationId`, `grantCompact`, and optionally `nonce`). Sign the signing input with the holder's
key and assemble the compact proof with `v2.assembleCompact`. This package does neither: it holds
no keys.

## Inherit values from the parent

A child may send `null` for `audiences`, `operations`, `not_before`, and `expires_at`.
`materializeChild` replaces each `null` with the parent's exact value before the digest is
computed, so a `null` member and an explicit copy of the parent's value produce the same digest.
The cumulative policy is never inherited, and the holder thumbprint is always required.

```ts
import { materializeChild, reauthorizationRequestDigest } from "@bounded-authority/client";
import type { MaterializedChild, ParentContext } from "@bounded-authority/client";

const parent: ParentContext = {
  jti: "parent-grant-01",
  contractMajor: 2,
  holderThumbprint: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  audiences: ["https://calendar.example", "https://docs.example"],
  operations: [{ name: "calendar.schedule", selectors: [{ kind: "lte", path: ["duration_minutes"], value: 120 }] }],
  notBefore: 1800000000,
  expiresAt: 1800003600,
};
const childKey = "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8";

const digestOf = (child: MaterializedChild): string | undefined => {
  const digest = reauthorizationRequestDigest({
    parent: { jti: parent.jti, contractMajor: parent.contractMajor, holderThumbprint: parent.holderThumbprint },
    invocationId: "8a6f1c2e-3b4d-4e5f-9a0b-1c2d3e4f5a6b",
    consumerId: "demo-assistant",
    child,
  });
  return digest.ok ? digest.value.requestSha256 : undefined;
};

// Inherit everything except the holder.
const inherited = materializeChild(
  { holderThumbprint: childKey, audiences: null, operations: null, notBefore: null, expiresAt: null },
  parent,
);
// Spell the same values out (audience order does not matter: the projection sorts them).
const explicit = materializeChild(
  {
    holderThumbprint: childKey,
    audiences: [...parent.audiences].reverse(),
    operations: parent.operations,
    notBefore: parent.notBefore,
    expiresAt: parent.expiresAt,
  },
  parent,
);

if (inherited.ok && explicit.ok) {
  console.log(inherited.value.expiresAt); // prints: 1800003600
  console.log(digestOf(inherited.value) === digestOf(explicit.value)); // prints: true
}
```

In JSON, inheritance is the `null` value, never an absent member: a child without `audiences` is
refused.

## Handle a refusal

Every refusal is the same `{ ok: false }` with no detail, by design: nothing about the input leaks
into an error, and there is no partial result to misuse. To find the cause, call the three
functions one at a time; the first one that refuses tells you where to look.

```ts
import { childFromWireText, materializeChild, reauthorizationRequestDigest } from "@bounded-authority/client";
import type { ParentContext } from "@bounded-authority/client";

const parent: ParentContext = {
  jti: "parent-grant-01",
  contractMajor: 2,
  holderThumbprint: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  audiences: ["https://data.example"],
  operations: [{ name: "data.export", selectors: [{ kind: "lte", path: ["row_count"], value: 10000 }] }],
  notBefore: 1800000000,
  expiresAt: 1800003600,
};

function diagnose(childJson: string, invocationId: string): string {
  const requested = childFromWireText(childJson);
  if (!requested.ok) return "childFromWireText refused: check the JSON text and the child's members";
  const child = materializeChild(requested.value, parent);
  if (!child.ok) return "materializeChild refused: check the parent context and the child's holder";
  const digest = reauthorizationRequestDigest({
    parent: { jti: parent.jti, contractMajor: parent.contractMajor, holderThumbprint: parent.holderThumbprint },
    invocationId,
    consumerId: "demo-agent",
    child: child.value,
  });
  if (!digest.ok) return "reauthorizationRequestDigest refused: check the invocation ID and consumer ID";
  return `ok ${digest.value.requestSha256}`;
}

const childJson = `{
  "holder_thumbprint": "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8",
  "audiences": ["https://data.example"],
  "operations": [{ "name": "data.export", "selectors": [
    { "kind": "lte", "path": ["row_count"], "value": 500 },
    { "kind": "equals", "path": ["format"], "value": "csv" },
    { "kind": "equals", "path": ["dataset"], "value": "inventory" }
  ] }],
  "not_before": 1800000000,
  "expires_at": 1800000300
}`;
const invocationId = "5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

console.log(diagnose(childJson.replace(`"value": 500`, `"value": 500.0`), invocationId));
// prints: childFromWireText refused: check the JSON text and the child's members
console.log(diagnose(childJson.replace("ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8", parent.holderThumbprint), invocationId));
// prints: materializeChild refused: check the parent context and the child's holder
console.log(diagnose(childJson, invocationId.toUpperCase()));
// prints: reauthorizationRequestDigest refused: check the invocation ID and consumer ID
console.log(diagnose(childJson, invocationId));
// prints: ok ZEJZyH3UFj_kT81x2WOW-gcPLBOSqtOFqBKsbTT-VO4
```

Each cause, and its fix:

| Cause | Fix |
|---|---|
| Invalid JSON, trailing bytes, or a value that is not an object | Pass the JSON text of `body.child` alone. |
| A duplicate member name | Send each member once. The service refuses duplicates too. |
| An integer field spelled `500.0`, `1E2`, `-0.0`, or with a leading zero | Spell bounds, timestamps, and policy numbers as plain integers. |
| An unknown member, or a missing one | Use exactly the documented members. Send `null` to inherit; do not omit the member. |
| `"cumulative_policy": null`, or a `null` policy member | Omit the policy, or the member, instead. |
| A policy that breaks a [policy rule](req2-projection.md#cumulative-policy-field-10) | Keep `window_seconds` from 1 to 2,678,400, include a ceiling, and pair `sum_path` with `max_sum` and `distinct_path` with `max_distinct`. |
| A fractional `lte` or `gte` bound | Use an integer bound. |
| A holder thumbprint that is not unpadded base64url of exactly 32 bytes | Encode the raw 32-byte thumbprint with the URL-safe alphabet and no `=` padding. |
| A child holder thumbprint equal to the parent's | Give the child a different holder key. |
| A parent `contractMajor` other than `2` | This package computes REQ-2 only, which needs a v2 parent. |
| An `invocationId` that is not a canonical lowercase UUID | Lowercase it; `crypto.randomUUID()` already returns this form. |
| An empty string (audience, operation name, path component, `jti`, `consumerId`) or an empty set | Every identifier and every set has at least one element. |
| Duplicate operation names | List each operation name once. |
| A count or size over a [limit](req2-projection.md#size-and-count-limits) | Stay within 64 audiences, 64 operations, 64 selectors per operation, 256 `one_of` values, and the byte limits. |
| A string with a lone surrogate | Pass well-formed Unicode; `String.prototype.isWellFormed()` checks it. |
| A non-finite number, or a JSON value beyond the canonical-JSON bounds | Use finite numbers and shallower values. |
| A class instance, a `Map`, an accessor property, or a Proxy that throws | Pass plain objects and arrays of data. |

## Test your integration against the vectors

[`test/vectors/reauthorization-req2.json`](../test/vectors/reauthorization-req2.json) holds
seventeen vectors in the repository (they are not in the npm package). The expected bytes were
computed with the service reference implementation, never with this package, so they also check
a client that reimplements the projection in another language. The file has:

- `parent`: the parent context every vector inherits from (`jti`, `contract_major`,
  `holder_thumbprint`, `audiences`, `operations`, `not_before`, `expires_at`);
- `vectors`: each with `name`, `consumer_id`, `invocation_id`, `child` (exactly as in a request
  body), `projection_hex`, and `request_sha256`;
- `thumbprint_seeds`: how the demo thumbprints were made (32 bytes counting up from `0x00`,
  `0x20`, and `0x40`).

Check the file's SHA-256 before you trust it, then run every vector. From the root of a clone:

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { childFromWire, materializeChild, reauthorizationRequestDigest } from "@bounded-authority/client";

const raw = readFileSync("test/vectors/reauthorization-req2.json");
console.log(createHash("sha256").update(raw).digest("hex")); // prints: 47eaab2497e6c69a08a66f5f1876a3e2075f1a2e3919d3434c15f3418978bc00

const file = JSON.parse(raw.toString("utf8"));
const p = file.parent;
const parent = { jti: p.jti, contractMajor: p.contract_major, holderThumbprint: p.holder_thumbprint };
const context = { ...parent, audiences: p.audiences, operations: p.operations, notBefore: p.not_before, expiresAt: p.expires_at };

let matched = 0;
for (const vector of file.vectors) {
  const requested = childFromWire(vector.child);
  const child = requested.ok ? materializeChild(requested.value, context) : requested;
  const digest = child.ok
    ? reauthorizationRequestDigest({ parent, invocationId: vector.invocation_id, consumerId: vector.consumer_id, child: child.value })
    : child;
  const hex = digest.ok ? Buffer.from(digest.value.projection).toString("hex") : "";
  if (digest.ok && hex === vector.projection_hex && digest.value.requestSha256 === vector.request_sha256) matched++;
}
console.log(`${matched} of ${file.vectors.length} vectors match`); // prints: 17 of 17 vectors match
```

The vectors span document access, deployment approval, data export, calendar scheduling, device
control, messaging, and one money transfer; [Examples across domains](req2-projection.md#examples-across-domains)
lists them.

## Use it in a browser

`src/` uses no Node.js-only API (`test/guard.test.ts` refuses a `node:` import or a `Buffer`
identifier there, and `pnpm check:dist` checks the built `dist/`). Bundle your client for the
browser as usual. The verifier package chooses its crypto backend through its package `imports`
conditions: under a browser build it resolves to the portable backend, which needs no Node.js
global.

The browser lane bundles with esbuild (`platform: "browser"`) and runs all seventeen vectors in
Chromium, Firefox, and WebKit under a strict Content Security Policy; other bundlers are not tested.
[`test/browser/README.md`](../test/browser/README.md) describes the lane and its red-proofs.
