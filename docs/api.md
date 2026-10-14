# API reference

`@bounded-authority/client` 0.1.1 exports four functions and the types they take and return. The
byte layout they implement is specified in [`req2-projection.md`](req2-projection.md); the tasks
they serve are in the [guides](guides.md).

| Export | Kind | Purpose |
|---|---|---|
| [`childFromWire`](#childfromwire) | function | Parse an already-parsed `body.child` (snake_case) into a `RequestedChild`. |
| [`childFromWireText`](#childfromwiretext) | function | The same from the JSON text, which also refuses duplicate member names and integer fields spelled `2500.0`, `1E2`, or `-0.0`. |
| [`materializeChild`](#materializechild) | function | Fill a child's `null` members from the parent's exact values. |
| [`reauthorizationRequestDigest`](#reauthorizationrequestdigest) | function | Compute the REQ-2 projection bytes and `requestSha256`. |
| [`Result`](#result-and-the-closed-error) | type | The return type of every function. |
| [Input and output types](#types) | types | `RequestedChild`, `MaterializedChild`, `ParentIdentity`, `ParentContext`, `ReauthorizationDigestInput`, `ReauthorizationDigest`, `Operation`, `Selector`, `CumulativePolicy`, `JsonValue`. |

Every sample on this page runs in `pnpm test` (`test/docs.test.ts`), and each `// prints:` comment
is what the sample prints.

## `Result` and the closed error

```text
type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };
```

`Result` is the verifier package's type, re-exported here. Every function returns it, and every
failure is the same `{ ok: false }` with no detail: no message, no code, no field name. That
includes failures that are not protocol refusals, such as a getter or a Proxy trap that throws
while the function reads your input. **No function throws.**

The causes of a refusal are listed in [Refusals](req2-projection.md#refusals) and in each
function's section below. [Handle a refusal](guides.md#handle-a-refusal) shows how to find which
one applies.

## `childFromWire`

```text
function childFromWire(wire: unknown): Result<RequestedChild>
```

Parses a child as it appears in the JSON request body (`body.child`, snake_case members) into the
typed, camelCase [`RequestedChild`](#requestedchild).

- **`wire`**: an already-parsed JSON value. Members: `holder_thumbprint` (required),
  `audiences`, `operations`, `not_before`, `expires_at` (each required, and `null` to inherit
  from the parent), and `cumulative_policy` (omitted when there is none; its members are
  `window_seconds`, `max_count`, `sum_path`, `max_sum`, `distinct_path`, `max_distinct`).
- **Returns** `{ ok: true, value: RequestedChild }`.
- **Refuses** any member outside that list, a missing member (absence is not `null`), an explicit
  `null` policy or `null` policy member, and every value rule in
  [Refusals](req2-projection.md#refusals) and [Size and count limits](req2-projection.md#size-and-count-limits).

A parsed value no longer shows how the JSON text spelled it. `childFromWire` relies on the text
having had no duplicate member names and plain integer spellings; use
[`childFromWireText`](#childfromwiretext) when you have the text.

```ts
import { childFromWire } from "@bounded-authority/client";

const body = JSON.parse(`{
  "child": {
    "holder_thumbprint": "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8",
    "audiences": null,
    "operations": null,
    "not_before": null,
    "expires_at": 1800000900
  }
}`);

const child = childFromWire(body.child);
console.log(child.ok); // prints: true
if (child.ok) console.log(child.value.audiences, child.value.expiresAt); // prints: null 1800000900

// An explicit null policy is refused: omit cumulative_policy instead.
console.log(childFromWire({ ...body.child, cumulative_policy: null })); // prints: { ok: false }
```

## `childFromWireText`

```text
function childFromWireText(jsonText: string): Result<RequestedChild>
```

Like [`childFromWire`](#childfromwire), from the JSON text of `body.child`.

- **`jsonText`**: the JSON text of the child object.
- **Returns** `{ ok: true, value: RequestedChild }`, equal to what `childFromWire` returns for the
  parsed text.
- **Refuses** everything `childFromWire` refuses, and also: invalid JSON, a non-object value,
  trailing bytes, a duplicate member name at any depth, an integer field (a bound, a timestamp, a
  policy member) spelled with a fraction or an exponent (`2500.0`, `1E2`, `-0.0`), a number with a
  leading zero, a lone surrogate, and a non-string argument. `-0` is the integer zero and is
  accepted.

Inside `equals` and `one_of` values any valid number spelling is accepted: `2.0` and `2`
canonicalize to the same bytes.

```ts
import { childFromWire, childFromWireText } from "@bounded-authority/client";

const text = `{
  "holder_thumbprint": "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8",
  "audiences": ["https://calendar.example"],
  "operations": [{ "name": "calendar.schedule", "selectors": [
    { "kind": "lte", "path": ["duration_minutes"], "value": 60 }
  ] }],
  "not_before": 1800000000,
  "expires_at": 1800000300
}`;

console.log(childFromWireText(text).ok); // prints: true

// An integer bound spelled with a fraction is refused, as the service refuses it.
const fraction = text.replace(`"value": 60`, `"value": 60.0`);
console.log(childFromWireText(fraction).ok); // prints: false

// A duplicate member name is refused (JSON.parse would keep the last one silently).
const duplicate = text.replace(`"not_before"`, `"expires_at": 1800000600, "not_before"`);
console.log(childFromWireText(duplicate).ok); // prints: false

// childFromWire cannot see either: JSON.parse has already turned 60.0 into 60.
console.log(childFromWire(JSON.parse(fraction)).ok); // prints: true
```

## `materializeChild`

```text
function materializeChild(child: RequestedChild, parent: ParentContext): Result<MaterializedChild>
```

Fills the child's `null` `audiences`, `operations`, `notBefore`, and `expiresAt` from the
parent's exact values. Explicit child values are kept as given. The cumulative policy is never
inherited: a child policy is carried through, and a parent has none in its context.

- **`child`**: a [`RequestedChild`](#requestedchild), typically from `childFromWire` or
  `childFromWireText`.
- **`parent`**: the [`ParentContext`](#parentcontext): the parent's identity and the values a child
  inherits.
- **Returns** `{ ok: true, value: MaterializedChild }`.
- **Refuses** a child holder thumbprint equal to the parent's, a parent `contractMajor` other than
  `2`, and any invalid member of either argument. The parent's values are checked even when the
  child does not inherit them.

This function does not check that the child is narrower than the parent. The service decides
whether to issue the child.

```ts
import { materializeChild } from "@bounded-authority/client";
import type { ParentContext, RequestedChild } from "@bounded-authority/client";

const parent: ParentContext = {
  jti: "parent-grant-01",
  contractMajor: 2,
  holderThumbprint: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  audiences: ["https://docs.example", "https://calendar.example"],
  operations: [{ name: "docs.read", selectors: [{ kind: "one_of", path: ["folder"], values: ["reports", "specs"] }] }],
  notBefore: 1800000000,
  expiresAt: 1800003600,
};

const requested: RequestedChild = {
  holderThumbprint: "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8",
  audiences: ["https://docs.example"],
  operations: null,
  notBefore: null,
  expiresAt: 1800000900,
};

const child = materializeChild(requested, parent);
if (child.ok) {
  console.log(child.value.audiences); // prints: [ 'https://docs.example' ]
  console.log(child.value.operations[0]?.name, child.value.notBefore, child.value.expiresAt); // prints: docs.read 1800000000 1800000900
}

// The child's holder must be a different key from the parent's.
console.log(materializeChild({ ...requested, holderThumbprint: parent.holderThumbprint }, parent).ok); // prints: false
```

## `reauthorizationRequestDigest`

```text
function reauthorizationRequestDigest(input: ReauthorizationDigestInput): Result<ReauthorizationDigest>
```

Computes the REQ-2 projection for a reauthorization request and its digest. Put `requestSha256`
in `cast_arguments.request_sha256` of the holder's v2 proof for operation
`authority.grants.reauthorize` (see [Bind the digest into a v2 proof](guides.md#bind-the-digest-into-a-v2-proof)).

- **`input.parent`**: a [`ParentIdentity`](#parentidentity) (`jti`, `contractMajor`,
  `holderThumbprint`).
- **`input.invocationId`**: the request's invocation ID, a canonical lowercase UUID.
- **`input.consumerId`**: the submitting consumer's stable handle, not its credential identifier.
- **`input.child`**: a [`MaterializedChild`](#materializedchild), typically from `materializeChild`.
- **Returns** `{ ok: true, value: ReauthorizationDigest }`: `projection` (the complete projection
  bytes) and `requestSha256` (the 43-character unpadded base64url SHA-256 of the projection).
- **Refuses** an `input` with a member other than those four, a parent `contractMajor` other than
  `2`, an `invocationId` that is not a canonical lowercase UUID, an empty `consumerId` or parent
  `jti`, a child holder thumbprint equal to the parent's, and every rule in
  [Refusals](req2-projection.md#refusals) and [Size and count limits](req2-projection.md#size-and-count-limits).

The output does not depend on the order of audiences, operations, selectors, or `one_of` values,
or on repeated entries in them: the projection sorts and deduplicates them.

```ts
import { reauthorizationRequestDigest } from "@bounded-authority/client";
import type { ReauthorizationDigestInput } from "@bounded-authority/client";

// The device-range-child vector: set a thermostat to between 16 and 24 degrees Celsius.
const input: ReauthorizationDigestInput = {
  parent: { jti: "parent-grant-01", contractMajor: 2, holderThumbprint: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8" },
  invocationId: "5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c52",
  consumerId: "demo-agent",
  child: {
    holderThumbprint: "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8",
    audiences: ["https://devices.example"],
    operations: [
      {
        name: "device.set_temperature",
        selectors: [
          { kind: "gte", path: ["celsius"], value: 16 },
          { kind: "lte", path: ["celsius"], value: 24 },
          { kind: "equals", path: ["device"], value: "thermostat-1" },
        ],
      },
    ],
    notBefore: 1800000000,
    expiresAt: 1800000300,
  },
};

const digest = reauthorizationRequestDigest(input);
if (digest.ok) {
  console.log(digest.value.requestSha256); // prints: Jmqriuq_ilIgyr3kQ68Y88dLyfMZNRBszARFmKdD-NM
  console.log(digest.value.projection.length); // prints: 378
}

// The contract requires the canonical lowercase form of the invocation ID.
console.log(reauthorizationRequestDigest({ ...input, invocationId: input.invocationId.toUpperCase() }).ok); // prints: false
```

## Types

All members are `readonly`. An optional member is an absent key, never `undefined` or `null`.

### `RequestedChild`

The child as requested, in camelCase.

| Member | Type | Meaning |
|---|---|---|
| `holderThumbprint` | `string` | The child holder key's thumbprint: canonical unpadded base64url of exactly 32 bytes. |
| `audiences` | `string[] \| null` | 1 to 64 audiences, each 1 to 512 UTF-8 bytes, or `null` to inherit the parent's. |
| `operations` | `Operation[] \| null` | 1 to 64 operations with unique names, or `null` to inherit. |
| `notBefore` | `number \| null` | Epoch seconds, an integer from 0 to 2^53 - 1, or `null` to inherit. |
| `expiresAt` | `number \| null` | Epoch seconds, as above, or `null` to inherit. |
| `cumulativePolicy?` | `CumulativePolicy` | Present only when the child has a policy. |

### `MaterializedChild`

The child after inheritance: the same members as `RequestedChild`, none of them `null`.

### `ParentIdentity`

| Member | Type | Meaning |
|---|---|---|
| `jti` | `string` | The parent grant's public `jti` (not a database identifier). Not empty. |
| `contractMajor` | `number` | The parent grant's contract major. Only `2` is accepted. |
| `holderThumbprint` | `string` | The parent holder key's thumbprint, canonical unpadded base64url of 32 bytes. |

### `ParentContext`

`ParentIdentity` plus the values a child inherits: `audiences: string[]`,
`operations: Operation[]`, `notBefore: number`, and `expiresAt: number`, with the same rules as in
`RequestedChild` (never `null`).

### `ReauthorizationDigestInput`

| Member | Type | Meaning |
|---|---|---|
| `parent` | `ParentIdentity` | The parent grant. |
| `invocationId` | `string` | Canonical lowercase UUID. `crypto.randomUUID()` returns this form. |
| `consumerId` | `string` | The submitting consumer's stable handle (not its credential identifier). Not empty. |
| `child` | `MaterializedChild` | The child after inheritance. |

### `ReauthorizationDigest`

| Member | Type | Meaning |
|---|---|---|
| `projection` | `Uint8Array` | The complete REQ-2 projection: ten framed fields, concatenated. |
| `requestSha256` | `string` | Unpadded base64url SHA-256 of the whole projection (43 characters). |

### `Operation`

| Member | Type | Meaning |
|---|---|---|
| `name` | `string` | 1 to 128 UTF-8 bytes. |
| `selectors` | `Selector[]` | 1 to 64 selectors. |

### `Selector`

| Kind | Shape |
|---|---|
| `all` | `{ kind: "all" }` |
| `equals` | `{ kind: "equals", path: string[], value: JsonValue }` |
| `lte`, `gte` | `{ kind: "lte" \| "gte", path: string[], value: number }`, where `value` is an integer from -(2^53 - 1) to 2^53 - 1. A fractional bound is refused. |
| `one_of` | `{ kind: "one_of", path: string[], values: JsonValue[] }`, with 1 to 256 values. |

A `path` has 1 to 32 components, each 1 to 128 UTF-8 bytes. No other member is accepted.

### `CumulativePolicy`

| Member | Type | Meaning |
|---|---|---|
| `windowSeconds` | `number` | Integer, 1 to 2,678,400 (31 days). Required. |
| `maxCount?` | `number` | Integer, 1 to 2^53 - 1. |
| `sumPath?` | `string[]` | A path; appears together with `maxSum`. |
| `maxSum?` | `number` | Integer, 0 to 2^53 - 1; appears together with `sumPath`. |
| `distinctPath?` | `string[]` | A path; appears together with `maxDistinct`. |
| `maxDistinct?` | `number` | Integer, 1 to 1024; appears together with `distinctPath`. |

At least one ceiling (`maxCount`, `maxSum`, or `maxDistinct`) is required.

### `JsonValue`

A JSON value as admitted in `equals` and `one_of` selectors: `null`, a boolean, a finite number, a
string without lone surrogates, an array, or a plain object of these, within the verifier
package's canonical-JSON bounds.
