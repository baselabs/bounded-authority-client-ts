# Pending: real-browser run of the vectors, and one verifier fix

Two items wait on the verifier package. Neither is faked, and nothing in this repository claims
either passed.

## 1. Real-browser run of the vectors (blocked on verifier 0.6.0)

The REQ-2 vectors in `test/vectors/reauthorization-req2.json` must also be asserted in a real
browser (a real engine, not jsdom and not a shim).

This package computes canonical JSON and the SHA-256 digest through
`@bounded-authority-protocol/verifier`. Verifier 0.5.0 imports `node:crypto` at its package
root, so a browser bundle of this package cannot load the verifier without substituting
`node:crypto`. Substituting it would test the substitute, not the shipped code.

`src/` itself imports nothing from `node:*` and never names `Buffer` (enforced by
`test/guard.test.ts`), so the blocker is entirely upstream.

Unblock condition: verifier 0.6.0 is the browser-safe release. When it is published:

1. Move the dependency range to `^0.6.0` and refresh the lockfile.
2. Add a browser harness here that bundles `src/` with no aliases or shims and runs the vector
   assertions from `test/vectors.test.ts` inside a real browser engine.
3. Add that run to CI and remove this item.

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
