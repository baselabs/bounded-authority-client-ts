// The digest's destination: cast_arguments.request_sha256 of a v2 proof. The proof producer binds
// the cast arguments through its own BAP2-REQUEST digest over the operation and those arguments;
// this proves the REQ-2 digest flows into that binding and that every projection input moves it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { v2 } from "@bounded-authority-protocol/verifier";
import type { Tagged } from "@bounded-authority-protocol/verifier";
import { reauthorizationRequestDigest } from "../src/index.js";
import { baseInput, withChild } from "./helpers.js";

const OPERATION = "authority.grants.reauthorize";

// The README's flow: { "request_sha256": <digest> } as the proof's cast arguments.
function castArguments(requestSha256: string): Tagged {
  return { t: "object", v: new Map([["request_sha256", { t: "string", v: new TextEncoder().encode(requestSha256) }]]) };
}

function proofRequestDigest(input: ReturnType<typeof baseInput>): string {
  const digest = reauthorizationRequestDigest(input);
  assert.equal(digest.ok, true);
  if (!digest.ok) throw new Error("unreachable");
  const bound = v2.requestDigest(OPERATION, castArguments(digest.value.requestSha256));
  assert.equal(bound.ok, true, "the v2 proof producer accepts the cast arguments");
  if (!bound.ok) throw new Error("unreachable");
  assert.equal(bound.value.length, 32);
  return Buffer.from(bound.value).toString("hex");
}

test("the v2 request digest over { request_sha256 } is stable for one input", () => {
  assert.equal(proofRequestDigest(baseInput()), proofRequestDigest(baseInput()));
});

test("a signed change to any child field changes what the v2 proof binds", () => {
  const baseline = proofRequestDigest(baseInput());
  const changed = [
    withChild({ expiresAt: 1800000299 }),
    withChild({ audiences: ["https://data.example/alt"] }),
    withChild({ cumulativePolicy: { windowSeconds: 60, maxCount: 1 } }),
    { ...baseInput(), consumerId: "other-agent" },
  ];
  for (const input of changed) assert.notEqual(proofRequestDigest(input), baseline);
});
