// The REQ-2 projection: ten framed fields in the contract's order. See docs/req2-projection.md.
import { base64urlEncode, jcsEncode, sha256 } from "@bounded-authority-protocol/verifier";
import type { Tagged } from "@bounded-authority-protocol/verifier";
import { compareBytes, concat, frame, list, sort, unique, utf8 } from "./bytes.js";
import type { CumulativePolicy, JsonValue, MaterializedChild, Operation, Selector } from "./types.js";

const TAG = "BA-REAUTH-REQ-2";
const NULL_MARKER = utf8("null");
const ascii = new TextDecoder("ascii");

const decimal = (n: number): Uint8Array => utf8(String(n));

/** A validated JSON value in the verifier package's tagged form (integral numbers are int-tagged). */
export function tagged(v: JsonValue): Tagged {
  if (v === null) return { t: "null" };
  if (typeof v === "boolean") return { t: "bool", v };
  if (typeof v === "number") return Number.isInteger(v) ? { t: "int", v } : { t: "float", v };
  if (typeof v === "string") return { t: "string", v: utf8(v) };
  if (Array.isArray(v)) return { t: "array", v: v.map(tagged) };
  const members = new Map<string, Tagged>();
  for (const [k, x] of Object.entries(v as { readonly [member: string]: JsonValue })) members.set(k, tagged(x));
  return { t: "object", v: members };
}

/** JCS(value): the public BAP canonical JSON encoding. */
const jcs = (v: JsonValue): Uint8Array => jcsEncode(tagged(v));

/** A path keeps its component order. */
const path = (components: readonly string[]): Uint8Array => list(components.map(utf8));

function encodeSelector(s: Selector): Uint8Array {
  switch (s.kind) {
    case "all":
      return frame(utf8("all"));
    case "equals":
    case "lte":
    case "gte":
      return concat([frame(utf8(s.kind)), frame(path(s.path)), frame(jcs(s.value))]);
    case "one_of": {
      // A one_of set is sorted and deduplicated by its JCS value bytes.
      const values = sort(unique(s.values.map(jcs)));
      return concat([frame(utf8("one_of")), frame(path(s.path)), frame(list(values))]);
    }
  }
}

function encodeOperation(o: Operation): Uint8Array {
  // Selector sets are sorted and deduplicated by their complete encoded bytes.
  const selectors = sort(unique(o.selectors.map(encodeSelector)));
  return concat([frame(utf8(o.name)), frame(list(selectors))]);
}

function encodePolicy(p: CumulativePolicy): Uint8Array {
  const optional = (n: number | undefined): Uint8Array => (n === undefined ? NULL_MARKER : decimal(n));
  const optionalPath = (c: readonly string[] | undefined): Uint8Array => (c === undefined ? NULL_MARKER : path(c));
  // Six framed fields, in this order, with no field names and no field count.
  return concat([
    frame(decimal(p.windowSeconds)),
    frame(optional(p.maxCount)),
    frame(optionalPath(p.sumPath)),
    frame(optional(p.maxSum)),
    frame(optionalPath(p.distinctPath)),
    frame(optional(p.maxDistinct)),
  ]);
}

export interface ProjectionFields {
  readonly parentJti: string;
  readonly invocationId: string;
  readonly consumerId: string;
  readonly child: MaterializedChild;
}

export function encodeProjection(f: ProjectionFields): Uint8Array {
  const { child } = f;
  // Audiences are sorted and deduplicated by raw bytes.
  const audiences = sort(unique(child.audiences.map(utf8)));
  // Operation names are unique (checked at the boundary) and sorted by raw UTF-8 bytes.
  const operations = [...child.operations]
    .map((o) => ({ name: utf8(o.name), encoded: encodeOperation(o) }))
    .sort((a, b) => compareBytes(a.name, b.name))
    .map((o) => o.encoded);

  const fields = [
    utf8(TAG),
    utf8(f.parentJti),
    utf8(f.invocationId),
    utf8(f.consumerId),
    utf8(child.holderThumbprint),
    list(audiences),
    list(operations),
    decimal(child.notBefore),
    decimal(child.expiresAt),
    child.cumulativePolicy === undefined ? NULL_MARKER : encodePolicy(child.cumulativePolicy),
  ];
  return concat(fields.map(frame));
}

export function requestSha256(projection: Uint8Array): string {
  return ascii.decode(base64urlEncode(sha256(projection)));
}
