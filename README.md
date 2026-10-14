# @bounded-authority/client

[![CI](https://github.com/baselabs/bounded-authority-client-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/baselabs/bounded-authority-client-ts/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

The TypeScript client SDK for the bounded authority service.

## The boundary rule

This repository holds **only the wire contract, the contract cases, and the vectors** a client
needs. It never holds how the service works inside: no storage or locking behavior, no server
error-code mapping beyond what a client must act on, no deployment details. If a client can
reproduce a byte, a refusal, or a vector from this repository alone, it belongs here. Anything
else does not.

## What is in this release

One function family: the **REQ-2 reauthorization request digest**.

A reauthorization asks the service to issue a child grant under a parent grant. The holder signs
consent to the child, and that consent binds to the child through a digest of a fixed byte
layout (the "projection"). `reauthorizationRequestDigest` builds that layout and its digest.

| Export | Purpose |
|---|---|
| `reauthorizationRequestDigest(input)` | The projection bytes and the `requestSha256` string. |
| `materializeChild(child, parentContext)` | Fills `null` audiences, operations, not-before, and expiry from the parent's exact values. |
| `childFromWire(body.child)` | Parses a child as it appears in the JSON request body (snake_case). Requires JSON without duplicate member names and with plain integer spellings. |
| `childFromWireText(jsonText)` | The same from the JSON text itself: refuses duplicate member names and integer fields spelled `2500.0`, `1E2`, or `-0.0`. |

The examples and vectors span document access, deployment approval, data export, calendar
scheduling, device control, messaging, and (one among many) a money transfer: bounded authority
is delegated authority for any agent action.

Every function returns the verifier package's `Result<T>`: `{ ok: true, value }` or the single
closed `{ ok: false }`. A refusal carries no detail, by design. Every failure becomes that result,
including a throwing getter or Proxy in the input: the public boundary never throws.

The byte layout, ordering rules, null marker, version rule, and refusals are in
[`docs/req2-projection.md`](docs/req2-projection.md). The vectors are in
[`test/vectors/reauthorization-req2.json`](test/vectors/reauthorization-req2.json) (neutral demo data;
expected bytes computed with the service reference implementation for the REQ-2 contract).

## Install

```bash
npm install @bounded-authority/client
```

Requires Node.js `>= 22`. One runtime dependency:
[`@bounded-authority-protocol/verifier`](https://www.npmjs.com/package/@bounded-authority-protocol/verifier)
(canonical JSON, SHA-256, base64url: one owner, not reimplemented here).

## Use: digest into a v2 proof

```ts
import { v2 } from "@bounded-authority-protocol/verifier";
import type { Tagged } from "@bounded-authority-protocol/verifier";
import { childFromWireText, materializeChild, reauthorizationRequestDigest } from "@bounded-authority/client";

// 1. Parse the child as the request body will carry it, then fill the inherited members
//    from the parent grant (null audiences/operations/not_before/expires_at inherit).
//    childFromWireText checks the JSON text itself; childFromWire takes the parsed value.
const requested = childFromWireText(childJsonText);
if (!requested.ok) throw new Error("child refused");
const child = materializeChild(requested.value, parentContext);
if (!child.ok) throw new Error("child refused");

// 2. Compute the projection digest.
const digest = reauthorizationRequestDigest({
  parent: { jti: "parent-grant-01", contractMajor: 2, holderThumbprint: parentThumbprint },
  invocationId: "5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", // canonical lowercase UUID
  consumerId: "demo-wallet",
  child: child.value,
});
if (!digest.ok) throw new Error("request refused");

// 3. Put it in cast_arguments.request_sha256 of the holder's v2 proof for
//    operation "authority.grants.reauthorize".
const castArguments: Tagged = {
  t: "object",
  v: new Map([["request_sha256", { t: "string", v: new TextEncoder().encode(digest.value.requestSha256) }]]),
};
// ...pass castArguments to v2.proofSigningInput({ ..., operation: "authority.grants.reauthorize", castArguments }).
```

`childJsonText` and `parentContext` are the JSON text of `body.child` and the parent's values (`jti`, `contractMajor`,
`holderThumbprint`, `audiences`, `operations`, `notBefore`, `expiresAt`). The digest is **not** JCS
of the request body: use the projection, as above.

`test/proof-binding.test.ts` runs steps 2 and 3 through the verifier package's `v2.requestDigest`, the
binding the proof producer applies to the cast arguments.

## Conformance evidence

- Seventeen neutral vectors (documents, deployments, data export, calendar, devices, messaging, one money
  example; lte, one_of, policies, null inheritance, sort and dedup, Unicode
  byte order, integer bounds near 2^53, and more): projection hex and `request_sha256` match exactly.
  Their expected bytes come from the service reference implementation, not from this package.
- Hand-assembled byte pins for every ordering, sort, dedup, null-marker, U32-width, and tag rule.
- fast-check properties: determinism, order-insensitivity of audiences, operations, selector
  sets, and `one_of` values, and dedup idempotence.
- `pnpm test:mutations` breaks each of those rules (and the refusals) in `src/`, one at a time,
  and requires a named test to fail. A survivor fails the script.
- `src/` has no `node:` import and no `Buffer` identifier (`test/guard.test.ts`).
- The 17 vectors run in real Chromium, Firefox and WebKit (Playwright, strict CSP, the client bundled
  by esbuild onto the verifier's portable backend; projection hex and `request_sha256` exact). The
  lane has wrong-backend and tampered-expectation red-proofs
  (see [`test/browser/README.md`](test/browser/README.md)).
- A fast-check property and an exhaustive sweep cover all 1,112,064 Unicode scalar values.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm test:mutations
pnpm test:exhaustive   # every Unicode scalar value, about 30 seconds
pnpm test:browser      # needs Playwright browsers: pnpm exec playwright install chromium firefox webkit
```
`BAP_BROWSERS=chromium,firefox,webkit` selects engines for `pnpm test:browser` (default `chromium`).

License: Apache-2.0 (see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE)).
