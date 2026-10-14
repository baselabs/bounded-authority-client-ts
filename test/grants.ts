// Test-side v2 grants: real compact grants, signed with a fixed demo Ed25519 key through the
// verifier package's producer functions (no mocks). `craftedGrant` signs a hand-written payload,
// for shapes the producer does not emit but the v2 profile accepts (an `all` selector with inert
// members, for example).
import { createPrivateKey, sign } from "node:crypto";
import { base64urlEncode, grantSigningInput, jcsEncode, v2 } from "@bounded-authority-protocol/verifier";
import type { OperationInput, Tagged } from "@bounded-authority-protocol/verifier";
import { PARENT_THUMBPRINT } from "./helpers.js";

// PKCS#8 wrapping of a fixed 32-byte Ed25519 seed (0x70..0x8f): a demo issuer key.
const SEED = Uint8Array.from({ length: 32 }, (_, i) => 0x70 + i);
const ISSUER_KEY = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(SEED)]),
  format: "der",
  type: "pkcs8",
});

const ascii = (b: Uint8Array): string => new TextDecoder().decode(b);
const enc = new TextEncoder();
const str = (s: string): Tagged => ({ t: "string", v: enc.encode(s) });

export const GRANT_BASE = {
  keyId: "demo-issuer-key-1",
  issuer: "https://issuer.example",
  grantId: "parent-grant-01",
  audiences: ["https://data.example", "https://docs.example"],
  issuedAt: 1799999990,
  notBefore: 1800000000,
  expiresAt: 1800003600,
  holderThumbprint: PARENT_THUMBPRINT,
};

function signCompact(protectedSegment: Uint8Array, payloadSegment: Uint8Array): string {
  const input = `${ascii(protectedSegment)}.${ascii(payloadSegment)}`;
  const signature = sign(null, enc.encode(input), ISSUER_KEY);
  return `${input}.${ascii(base64urlEncode(signature))}`;
}

/** A v2 grant from the verifier's producer, signed with the demo issuer key. */
export function producedGrant(operations: v2.OperationInput[]): string {
  const input = v2.grantSigningInput({ ...GRANT_BASE, operations });
  if (!input.ok) throw new Error("grantSigningInput refused the test grant");
  return signCompact(input.value.protectedSegment, input.value.payloadSegment);
}

/** A v1 grant with the same claims (contract major 1). */
export function producedV1Grant(operations: OperationInput[]): string {
  const input = grantSigningInput({ ...GRANT_BASE, operations });
  if (!input.ok) throw new Error("v1 grantSigningInput refused the test grant");
  return signCompact(input.value.protectedSegment, input.value.payloadSegment);
}

/** A v2 grant whose `operations` claim is the given tagged JSON, written and signed by hand. */
export function craftedGrant(operations: Tagged): string {
  const base = v2.grantSigningInput({ ...GRANT_BASE, operations: [{ name: "x", selectors: ["all"] }] });
  if (!base.ok) throw new Error("grantSigningInput refused the base grant");
  const payload: Tagged = {
    t: "object",
    v: new Map<string, Tagged>([
      ["v", { t: "int", v: 2 }],
      ["iss", str(GRANT_BASE.issuer)],
      ["jti", str(GRANT_BASE.grantId)],
      ["aud", { t: "array", v: GRANT_BASE.audiences.map(str) }],
      ["iat", { t: "int", v: GRANT_BASE.issuedAt }],
      ["nbf", { t: "int", v: GRANT_BASE.notBefore }],
      ["exp", { t: "int", v: GRANT_BASE.expiresAt }],
      ["cnf", { t: "object", v: new Map([["jkt", str(GRANT_BASE.holderThumbprint)]]) }],
      ["operations", operations],
    ]),
  };
  return signCompact(base.value.protectedSegment, base64urlEncode(jcsEncode(payload)));
}

export const tag = { str, int: (v: number): Tagged => ({ t: "int", v }), float: (v: number): Tagged => ({ t: "float", v }) };

/** A v2 grant whose payload is the given JSON text exactly (not canonicalized), signed by hand. */
export function rawPayloadGrant(payloadJson: string): string {
  const base = v2.grantSigningInput({ ...GRANT_BASE, operations: [{ name: "x", selectors: ["all"] }] });
  if (!base.ok) throw new Error("grantSigningInput refused the base grant");
  return signCompact(base.value.protectedSegment, base64urlEncode(enc.encode(payloadJson)));
}

/** A v2 grant from the producer with other claim values (times, for example). */
export function producedGrantWith(claims: Partial<typeof GRANT_BASE>, operations: v2.OperationInput[]): string {
  const input = v2.grantSigningInput({ ...GRANT_BASE, ...claims, operations });
  if (!input.ok) throw new Error("grantSigningInput refused the test grant");
  return signCompact(input.value.protectedSegment, input.value.payloadSegment);
}
