# Changelog

## [0.1.1] - not yet published

The first version intended for npm: everything in 0.1.0, plus the changes below.

- README rewritten: what the package is, why to use it, what it is not, how to install it from
  source while it is not on npm, and a quickstart that prints the `lte-child` vector's
  `request_sha256`.
- New `docs/api.md` (every export, with parameters, return values, refusals, and a runnable
  example) and `docs/guides.md` (where the inputs come from, binding the digest into a v2 proof,
  inheritance, handling a refusal, testing against the vectors, browsers).
- `test/docs.test.ts` (part of `pnpm test`) runs every TypeScript sample in the README and `docs/`,
  checks each `// prints:` comment against the output, and checks every relative link and anchor.
- `pnpm check:install` packs the package, installs the tarball into a fresh project, typechecks
  every docs sample against the installed declarations, and runs the quickstart there. CI runs
  it. `pnpm check:pack` also requires `docs/api.md` and `docs/guides.md` in the package.
- CI's push filter still skips pushes that change only Markdown no check reads, but a change to a
  file a check reads (`README.md`, `CHANGELOG.md`, `docs/`, `test/browser/README.md`, `LICENSE`)
  now runs CI. The checks take their file lists from `tools/checked-files.mjs`, and
  `test/ci-paths.test.ts` fails if the filter excludes any of those files.
- The release workflow's verify job also runs `pnpm check:install`, and its comments describe
  the release process without internal wording.
- **New: `parentContextFromGrant`** reads the parent context (`jti`, holder thumbprint,
  audiences, operations, `nbf`, `exp`) from the compact v2 parent grant, through the verifier
  package's `v2.decodeGrant`.
- **Fixed: `materializeChild` refused valid v2 parents.** A parent may now carry every selector a
  v2 grant accepts (the verifier's `v2.parseSelector` decides): an `all` selector with inert
  members and fractional `lte`/`gte` bounds. New types `ParentOperation` and `ParentSelector`;
  `ParentContext.operations` uses them. An inherited `all` becomes a plain `all`, and an inherited
  fractional bound is refused, because REQ-2 bounds are integers.
- **Fixed: the two child entry points refused different children.** `childFromWire` accepted
  selector values beyond the canonical-JSON limits (only the digest refused them), while
  `childFromWireText` applied whole-document decoder limits (64 KiB, 4,096 nodes) that a valid
  child can exceed. Both now check each selector against the verifier's v2 selector rules and
  each value against its canonical-JSON limits up front, and the text is read by a strict JSON
  reader with no whole-document limit. `test/parity.test.ts` checks that both accept and refuse
  alike, at each limit and over generated children.
- The browser lane closes its local server when a browser fails to launch, so a missing browser
  build fails the lane instead of hanging it.
- `docs/req2-projection.md`: the examples table now matches the vectors, and the epoch-second
  range is stated.
- `package.json`: keywords, and a plainer description.

## [0.1.0] - never published

Tagged `v0.1.0`, but never published to npm: the release workflow's staged publish failed, and
0.1.1 replaces it as the first version for npm. It contained:

- **REQ-2 reauthorization request digest.** `reauthorizationRequestDigest` computes the REQ-2
  projection (ten framed fields, bytes as specified in `docs/req2-projection.md`) and its
  unpadded base64url SHA-256, ready for `cast_arguments.request_sha256` of a v2 proof. It returns
  the verifier package's `Result` and refuses, with one closed error, everything the contract
  refuses: float bounds, an uppercase `invocation_id`, an explicit null policy, unknown members,
  a holder thumbprint that is not 32-byte canonical base64url, a thumbprint equal to the
  parent's, a v1 (or any non-v2) parent, and malformed policies.
- `childFromWire` parses a child as it appears in the JSON request body; `childFromWireText` does
  the same from the JSON text and also refuses duplicate member names and integer fields spelled
  with a fraction or exponent (`2500.0`, `1E2`, `-0.0`); `materializeChild` fills
  `null` audiences, operations, not-before, and expiry from the parent's exact values.
- Conformance: seventeen neutral vectors (demo data authored for this package; SHA-256 pinned at
  load) match exactly. Their expected bytes were computed with the service reference
  implementation for the REQ-2 contract. Hand-assembled byte pins cover every ordering, sort,
  dedup, null-marker, U32, and tag rule; fast-check properties cover determinism,
  order-insensitivity, and dedup idempotence; `pnpm test:mutations` breaks each rule in `src/`
  and proves a named test goes red.
- `src/` imports nothing from `node:*` and never names `Buffer` (a guard test enforces this).
  The 17 vectors also run in real Chromium, Firefox and WebKit through Playwright under a strict
  CSP, with the client bundled by esbuild onto the verifier's portable backend (`pnpm test:browser`,
  `test/browser/README.md`).
- The service's size and count limits are mirrored at the boundary (audiences, operations,
  selectors, `one_of` values, path components); every failure, including a throwing Proxy in the
  input, becomes the closed error.
- Packaging: `prepack` builds `dist/`, `pnpm check:pack` proves a clean `npm pack` contains the
  compiled code (and no source, tests, or maps), `pnpm check:dist` runs the vectors against
  `dist/`, and a tag-triggered release workflow stages the publish (a human approves; no token).
- A property over Unicode scalar values (`test/unicode.test.ts`) and an exhaustive sweep of all
  1,112,064 scalar values (`pnpm test:exhaustive`) pass. Verifier 0.5.0 failed the property on
  U+100000 (`test/browser/README.md`).
- Runtime dependency: `@bounded-authority-protocol/verifier` `^0.7.0`, which supplies canonical
  JSON, SHA-256, and base64url.
