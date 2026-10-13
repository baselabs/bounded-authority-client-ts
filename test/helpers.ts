// Test-side byte assembly. Deliberately independent of src/: expected bytes are built from
// literal field values with a tiny framing helper, never by calling the code under test.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { MaterializedChild, ReauthorizationDigestInput } from "../src/index.js";

export const enc = new TextEncoder();

export type Part = Uint8Array | string;
const bytes = (p: Part): Uint8Array => (typeof p === "string" ? enc.encode(p) : p);

export const cat = (...parts: Part[]): Uint8Array => {
  const chunks = parts.map(bytes);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
};

// U32 big-endian, written out by hand (no DataView) so the oracle shares no code path with src/.
export const u32 = (n: number): Uint8Array =>
  Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);

/** F(b) = U32(byte_length(b)) || b */
export const frame = (p: Part): Uint8Array => {
  const b = bytes(p);
  return cat(u32(b.length), b);
};

/** L(items) = U32(count) || F(item_1) || ... || F(item_n) */
export const seq = (items: readonly Part[]): Uint8Array => cat(u32(items.length), ...items.map(frame));

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (h: string): Uint8Array => {
  if (h.length % 2 !== 0) throw new Error("odd hex");
  return Uint8Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));
};

export const sha256b64url = (b: Uint8Array): string => createHash("sha256").update(b).digest("base64url");

// Demo thumbprints derived from fixed seed bytes: a thumbprint is the unpadded base64url of 32
// bytes counting up from a seed. Parent: 0x00..0x1f. Child A: 0x20..0x3f. Child B: 0x40..0x5f.
export const seedThumbprint = (start: number, length = 32): string =>
  Buffer.from(Uint8Array.from({ length }, (_, i) => (start + i) & 0xff)).toString("base64url");
export const PARENT_THUMBPRINT = seedThumbprint(0x00);
export const CHILD_THUMBPRINT = seedThumbprint(0x20);
export const CHILD_B_THUMBPRINT = seedThumbprint(0x40);
export const OTHER_THUMBPRINT = seedThumbprint(0x60);
export const INVOCATION = "5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** A fresh, valid, fully materialized input on every call (safe to mutate). */
export function baseInput(): ReauthorizationDigestInput {
  return {
    parent: { jti: "parent-grant-01", contractMajor: 2, holderThumbprint: PARENT_THUMBPRINT },
    invocationId: INVOCATION,
    consumerId: "demo-agent",
    child: {
      holderThumbprint: CHILD_THUMBPRINT,
      audiences: ["https://data.example"],
      operations: [
        {
          name: "data.export",
          selectors: [
            { kind: "equals", path: ["format"], value: "csv" },
            { kind: "lte", path: ["row_count"], value: 2500 },
          ],
        },
      ],
      notBefore: 1800000000,
      expiresAt: 1800000300,
    },
  };
}

export const withChild = (patch: Partial<MaterializedChild>): ReauthorizationDigestInput => {
  const input = baseInput();
  return { ...input, child: { ...input.child, ...patch } };
};

// The ten framed fields around caller-chosen audiences/operations/policy field bytes, so ordering
// tests state ONLY the part under test and the rest stays the literal base case.
export function expectedProjection(parts: {
  audiences: Uint8Array;
  operations: Uint8Array;
  policy?: Uint8Array | "null";
  notBefore?: string;
  expiresAt?: string;
  consumerId?: string;
}): Uint8Array {
  return cat(
    frame("BA-REAUTH-REQ-2"),
    frame("parent-grant-01"),
    frame(INVOCATION),
    frame(parts.consumerId ?? "demo-agent"),
    frame(CHILD_THUMBPRINT),
    frame(parts.audiences),
    frame(parts.operations),
    frame(parts.notBefore ?? "1800000000"),
    frame(parts.expiresAt ?? "1800000300"),
    frame(parts.policy === undefined || parts.policy === "null" ? "null" : parts.policy),
  );
}

// ---- vectors ------------------------------------------------------------------------------

export const VECTORS_PATH = new URL("./vectors/reauthorization-req2.json", import.meta.url);
export const VECTORS_SHA256 = "47eaab2497e6c69a08a66f5f1876a3e2075f1a2e3919d3434c15f3418978bc00";

export interface VectorFile {
  readonly expected_bytes_provenance: string;
  readonly parent: {
    readonly jti: string;
    readonly contract_major: number;
    readonly holder_thumbprint: string;
    readonly audiences: string[];
    readonly operations: unknown;
    readonly not_before: number;
    readonly expires_at: number;
  };
  readonly vectors: readonly {
    readonly name: string;
    readonly consumer_id: string;
    readonly invocation_id: string;
    readonly child: unknown;
    readonly projection_hex: string;
    readonly request_sha256: string;
  }[];
}

/** Reads the vectors file, asserting the pinned SHA-256 at load (throws on any drift). */
export function loadVectors(): VectorFile {
  const raw = readFileSync(VECTORS_PATH);
  const actual = createHash("sha256").update(raw).digest("hex");
  if (actual !== VECTORS_SHA256) {
    throw new Error(`vectors file drifted: sha256 ${actual} != pinned ${VECTORS_SHA256}`);
  }
  return JSON.parse(raw.toString("utf8")) as VectorFile;
}
