# @bounded-authority/client

[![CI](https://github.com/baselabs/bounded-authority-client-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/baselabs/bounded-authority-client-ts/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

TypeScript helpers for clients of a bounded authority service. Such a service issues signed
capability grants under the [Bounded Authority Protocol](https://github.com/baselabs/bounded_authority_protocol):
each grant names which operations a holder may call, with which arguments, for which audiences,
and for how long. This package computes, byte for byte, the values a client must send to the
service. This release covers one job: the **reauthorization request digest**, which binds a
holder's signed consent to a child grant delegated from a parent grant.

## Why use it

- **The bytes are exact.** The digest covers a fixed byte layout: ten length-framed fields,
  sorting by raw UTF-8 bytes, deduplication, and canonical JSON. One wrong byte and the digest no
  longer matches the one the service recomputes. This package matches seventeen vectors whose
  expected bytes were computed independently of it.
- **Bad input never gets far.** Every input is checked at the boundary against the same limits
  the service applies. Any failure becomes the single closed result `{ ok: false }`. No function
  throws, not even for a hostile Proxy.
- **It runs where your client runs.** The source uses no Node.js-only API, so the same code runs
  in Node.js 22 or later and in browsers through a bundler (tested in Chromium, Firefox, and
  WebKit).

## What this package is not

- **Not a network client.** It does not call the service, hold keys, or sign anything. You sign
  the proof with the holder's key.
- **Not an authorization decision.** A digest says nothing about whether the service will issue
  the child grant. The service decides that.
- **Not a description of the service's internals.** It holds only the wire contract, the contract
  cases, and the vectors a client needs: if a client can reproduce a byte, a refusal, or a vector
  from this repository alone, it belongs here. Storage, locking, deployment, and server error
  codes do not.

## Install

**Not published yet.** Version 0.1.0 is not on npm, so `npm install @bounded-authority/client`
does not resolve today. Until it does, build the package from source and install the tarball.

You need Node.js 22 or later, git, and pnpm 10 (`corepack enable` provides the pinned
`pnpm@10.20.0`):

```bash
git clone https://github.com/baselabs/bounded-authority-client-ts.git
cd bounded-authority-client-ts
pnpm install
pnpm pack   # builds dist/ and writes bounded-authority-client-0.1.0.tgz
```

Then, in your project:

```bash
npm install /path/to/bounded-authority-client-ts/bounded-authority-client-0.1.0.tgz
```

The package has one runtime dependency, the published
[`@bounded-authority-protocol/verifier`](https://www.npmjs.com/package/@bounded-authority-protocol/verifier)
(`^0.7.0`), which npm installs from the registry. It supplies canonical JSON, SHA-256, and
base64url, so this package does not reimplement them.

## Quickstart

A holder wants to hand a narrower data-export grant to a new key: at most 500 rows of the
`inventory` dataset as CSV, for five minutes. The client parses the child as the request body will
carry it, fills in anything inherited from the parent, and computes the digest.

```ts
import { childFromWireText, materializeChild, reauthorizationRequestDigest } from "@bounded-authority/client";
import type { ParentContext } from "@bounded-authority/client";

// The parent grant the child is delegated from, as the holder knows it.
const parent: ParentContext = {
  jti: "parent-grant-01",
  contractMajor: 2,
  holderThumbprint: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  audiences: ["https://data.example"],
  operations: [
    {
      name: "data.export",
      selectors: [
        { kind: "lte", path: ["row_count"], value: 10000 },
        { kind: "equals", path: ["format"], value: "csv" },
      ],
    },
  ],
  notBefore: 1800000000,
  expiresAt: 1800003600,
};

// The child exactly as the request body carries it (body.child).
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

const requested = childFromWireText(childJson);
if (!requested.ok) throw new Error("the child was refused");

const child = materializeChild(requested.value, parent);
if (!child.ok) throw new Error("the child was refused");

const digest = reauthorizationRequestDigest({
  parent: { jti: parent.jti, contractMajor: parent.contractMajor, holderThumbprint: parent.holderThumbprint },
  invocationId: "5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  consumerId: "demo-agent",
  child: child.value,
});
if (!digest.ok) throw new Error("the request was refused");

console.log(digest.value.requestSha256); // prints: ZEJZyH3UFj_kT81x2WOW-gcPLBOSqtOFqBKsbTT-VO4
```

The printed value is the `request_sha256` of the `lte-child` vector in
[`test/vectors/reauthorization-req2.json`](test/vectors/reauthorization-req2.json). Put it in
`cast_arguments.request_sha256` of the holder's v2 proof for operation
`authority.grants.reauthorize`; [Bind the digest into a v2 proof](docs/guides.md#bind-the-digest-into-a-v2-proof)
shows how. The digest is not JCS of the request body: always use the projection.

## Documentation

| Document | What it covers |
|---|---|
| [API reference](docs/api.md) | Every export: parameters, return values, refusals, a runnable example each. |
| [Guides](docs/guides.md) | Where the inputs come from, binding into a v2 proof, inheritance, handling a refusal, testing your integration, browsers. |
| [REQ-2 projection](docs/req2-projection.md) | The byte layout, ordering rules, null marker, version rule, limits, and refusals. |
| [Browser lane](test/browser/README.md) | How the vectors run in real browsers, and the Unicode evidence. |
| [Changelog](CHANGELOG.md) | What each version contains. |

Every TypeScript sample in this README and in `docs/` runs in `pnpm test` (`test/docs.test.ts`), and
each `// prints:` comment is checked against what the sample prints. `pnpm check:install` installs
the packed tarball the way [Install](#install) describes, typechecks every sample against it, and
runs the quickstart there.

## Conformance evidence

- **Vectors.** Seventeen neutral vectors (documents, deployments, data export, calendar, devices,
  messaging, and one money transfer; `lte`, `one_of`, policies, null inheritance, sort and dedup,
  Unicode byte order, integers near 2^53, and more) match in projection hex and `request_sha256`.
  The vectors use demo data written for this package; their expected bytes were computed with the
  service reference implementation for the REQ-2 contract, not with this package.
- **Byte pins.** Hand-assembled expected bytes for every ordering, sort, dedup, null-marker, U32
  width, and tag rule.
- **Properties.** fast-check properties for determinism, order-insensitivity of audiences,
  operations, selectors, and `one_of` values, and dedup idempotence. A property and an exhaustive
  sweep cover all 1,112,064 Unicode scalar values.
- **Mutation red-proofs.** `pnpm test:mutations` breaks each rule (and each refusal) in `src/`, one
  at a time, and requires a named test to fail. A mutation that no test notices fails the script.
- **Browser-safe source.** `src/` has no `node:` import and no `Buffer` identifier
  (`test/guard.test.ts`), and `pnpm check:dist` checks the same of the built `dist/`.
- **Real browsers.** The seventeen vectors run in Chromium, Firefox, and WebKit through Playwright
  under a strict CSP, with the client bundled by esbuild onto the verifier's portable backend
  ([`test/browser/README.md`](test/browser/README.md)).

## Development

```bash
pnpm install
pnpm typecheck         # strict tsc over src/, test/, and the browser page
pnpm test              # vectors, byte pins, properties, refusals, guard, docs samples and links
pnpm test:exhaustive   # every Unicode scalar value, about 30 seconds
pnpm test:mutations    # each rule broken in turn; a named test must fail
pnpm check:pack        # the packed file list: dist/ present, no source, tests, or maps
pnpm check:dist        # the vectors against the built dist/
pnpm check:install     # docs samples against the installed tarball (needs the npm registry)
pnpm test:browser      # needs Playwright browsers: pnpm exec playwright install chromium firefox webkit
```

`BAP_BROWSERS=chromium,firefox,webkit` selects engines for `pnpm test:browser` (default
`chromium`). CI runs every command above except `pnpm test:browser` on Node.js 22.23.1 and
24.19.0, and the browser lane once per engine on Node.js 22.23.1, all on Linux.

## License

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
