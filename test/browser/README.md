# Browser lane and Unicode evidence

## 1. Real-browser run of the vectors

The REQ-2 vectors in `test/vectors/reauthorization-req2.json` are asserted in real engines
(Chromium, Firefox, WebKit) through Playwright. No jsdom, no mocks, no aliases, no shims.

How it runs (`pnpm test:browser`, `test/browser/lane.ts`):

- esbuild bundles `browser/main.ts` (which imports `src/`) for the browser. The verifier's `#crypto`
  import resolves by its package `imports` conditions to the portable backend, the way any browser
  bundler resolves it. The page asserts `BACKEND_ID === "portable"` and `isSecureContext` before it
  runs a vector, and reports that no Node global (`Buffer`, `process`, `require`, `global`) exists.
- A `node:http` server on `127.0.0.1:0` serves the page, the bundle, and the vectors file (SHA-256
  pinned at load) with a strict CSP on every response:
  `default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'`.
  Every `securitypolicyviolation` is recorded and must be empty.
- The page runs every vector through `childFromWire`, `materializeChild`, and
  `reauthorizationRequestDigest`, compares projection hex and `request_sha256` to the expected
  values, and returns what it computed. The test compares those values again, outside the page,
  against the pinned file read from disk.
- `BAP_BROWSERS` selects engines (default `chromium`; CI runs all three on Linux, one job each).
  `BAP_CHROMIUM_EXECUTABLE` points Playwright at a locally installed Chromium build. Linux WebKit is
  evidence for this pure-JS code only, never for Safari.

Red-proofs, run on every engine as part of the lane:

- A page that expects the wrong backend (`?expect=node`) reports the mismatch, computes nothing, and
  never fetches the vectors file.
- A vectors file served with one altered `request_sha256` and one altered `projection_hex` is
  reported as exactly those two failures (the computed values stay the true ones).
- `eval` is blocked by the served CSP and the violation listener records it, which shows the CSP is
  enforced and the listener works.

Outside the lane, a mutation of `src/bytes.ts` (U32 written little-endian) turns the main lane test
red on all three engines.

The lane bundles `src/`; `pnpm check:dist` separately runs the vectors against the compiled `dist/`
in Node.

## 2. Verifier canonical-JSON UTF-8 check (resolved in verifier 0.7.0)

Verifier 0.5.0 rejected some valid Unicode scalar values in its canonical-JSON UTF-8 validation:
U+0400 through U+047F (Cyrillic), U+8000 through U+87FF, and plane 16 (U+100000 through U+10FFFF).
An `equals` or `one_of` value containing one of them was refused with the closed error.

Verifier 0.7.0 carries the fix. Recorded results:

- Before (verifier 0.5.0, test unskipped): the property failed after 11 runs with counterexample
  `[1048576]`, which is U+100000.
- After (verifier 0.7.0, lockfile integrity
  `sha512-k2OovyQf8CoCtFZg9RNYSs7jszRVxHJLHCFLuhxYSAg5uwKFSzw48F5+4kGgvnUdQ0jZSnS08rXIo/0svpYtog==`):
  the property in `test/unicode.test.ts` passes (2000 sampled scalar values), and
  `pnpm test:exhaustive` (`test/unicode-exhaustive.ts`) visits all 1,112,064 Unicode scalar values
  and passes with none refused. The sweep is its own script because it takes about 30 seconds and
  `pnpm test:mutations` reruns the `test/*.test.ts` glob once per mutation.
