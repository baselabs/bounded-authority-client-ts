// Vector conformance: the neutral REQ-2 vectors, byte for byte. Their expected bytes were computed
// with the service reference implementation for the REQ-2 contract (see the file's
// expected_bytes_provenance member), never with this package. The file's SHA-256 is pinned at load.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { childFromWire, materializeChild, reauthorizationRequestDigest } from "../src/index.js";
import { CHILD_B_THUMBPRINT, CHILD_THUMBPRINT, PARENT_THUMBPRINT, VECTORS_PATH, VECTORS_SHA256, loadVectors, toHex } from "./helpers.js";

test("the vectors file matches its pinned SHA-256", () => {
  const actual = createHash("sha256").update(readFileSync(VECTORS_PATH)).digest("hex");
  assert.equal(actual, VECTORS_SHA256);
  loadVectors(); // the loader asserts the same pin; exercising it here proves the helper does too
});

const file = loadVectors();

test("the file's provenance names the service reference implementation for the REQ-2 contract", () => {
  assert.equal(
    file.expected_bytes_provenance,
    "expected bytes computed with the service reference implementation for the REQ-2 contract",
  );
});

test("the file's thumbprints are the documented seed-derived values", () => {
  assert.equal(file.parent.holder_thumbprint, PARENT_THUMBPRINT);
  const children = new Set(file.vectors.map((v) => (v.child as { holder_thumbprint: string }).holder_thumbprint));
  assert.deepEqual([...children].sort(), [CHILD_THUMBPRINT, CHILD_B_THUMBPRINT].sort());
});

const REQUIRED_CLASSES = [
  "lte-child", "one-of-narrowed-child", "child-with-policy", "child-with-full-policy", "child-without-policy",
  "device-range-child", "calendar-child", "money-child-with-sum-policy", "null-inheritance",
  "null-inheritance-partial", "multi-audience-sort-dedup", "multi-operation-sort", "unicode-order",
  "integer-bounds-near-2-53", "selector-sort-dedup", "one-of-value-order", "path-order",
];

test("the file carries every required vector class", () => {
  assert.deepEqual(file.vectors.map((v) => v.name), REQUIRED_CLASSES);
});

for (const vector of file.vectors) {
  test(`vector ${vector.name}: projection hex and request_sha256 equal the expected values`, () => {
    const parsed = childFromWire(vector.child);
    assert.equal(parsed.ok, true, "the vector child parses");
    if (!parsed.ok) return;

    const materialized = materializeChild(parsed.value, {
      jti: file.parent.jti,
      contractMajor: file.parent.contract_major,
      holderThumbprint: file.parent.holder_thumbprint,
      audiences: file.parent.audiences,
      operations: file.parent.operations as never,
      notBefore: file.parent.not_before,
      expiresAt: file.parent.expires_at,
    });
    assert.equal(materialized.ok, true, "the child materializes against the parent context");
    if (!materialized.ok) return;

    const digest = reauthorizationRequestDigest({
      parent: { jti: file.parent.jti, contractMajor: file.parent.contract_major, holderThumbprint: file.parent.holder_thumbprint },
      invocationId: vector.invocation_id,
      consumerId: vector.consumer_id,
      child: materialized.value,
    });
    assert.equal(digest.ok, true);
    if (!digest.ok) return;

    assert.equal(toHex(digest.value.projection), vector.projection_hex);
    assert.equal(digest.value.requestSha256, vector.request_sha256);
  });
}
