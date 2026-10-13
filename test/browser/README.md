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

## 2. Verifier canonical-JSON UTF-8 check (skipped test)

The verifier's canonical-JSON UTF-8 validation rejects some valid Unicode scalar values: U+0400
through U+047F (Cyrillic), U+8000 through U+87FF, and plane 16 (U+100000 through U+10FFFF). An
`equals` or `one_of` value containing one of them is refused with the closed error. The fix belongs
in the verifier package, not here.

`test/unicode.test.ts` holds a property over every Unicode scalar value. It is **skipped**, with
the reason in the test, so that no failing test is committed. When the dependency carries the fix,
remove the `skip` option and the test must pass.
