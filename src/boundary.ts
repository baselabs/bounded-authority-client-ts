// Parse at the boundary: every value that enters the package is checked here, once, into a typed
// copy. Everything unknown, malformed, or out of range throws InvalidError, which the public
// functions turn into the single closed error. Nothing here is lenient.
import { base64urlDecode, fail, MAXIMA } from "@bounded-authority-protocol/verifier";
import { utf8 } from "./bytes.js";
import type {
  CumulativePolicy,
  JsonValue,
  MaterializedChild,
  Operation,
  ParentContext,
  ParentIdentity,
  RequestedChild,
  Selector,
} from "./types.js";

export const SUPPORTED_PARENT_MAJOR = 2;

const MAX_INTEGER = Number.MAX_SAFE_INTEGER; // 2^53 - 1, the protocol's integer magnitude
const MAX_WINDOW_SECONDS = 2_678_400; // 31 days
const MAX_DISTINCT = 1024;

// The service's size and count limits, taken from the verifier's maxima where it has them. Counts
// apply to the input as given (a one_of's 256 values are counted before deduplication); byte
// limits apply to the UTF-8 form.
const MAX_AUDIENCES = MAXIMA.audiences; // 64
const MAX_OPERATIONS = MAXIMA.operations; // 64
const MAX_SELECTORS = MAXIMA.selectors; // 64
const MAX_ONE_OF_VALUES = MAXIMA.one_of_values; // 256
const MAX_PATH_COMPONENTS = MAXIMA.path_segments; // 32
const MAX_AUDIENCE_BYTES = MAXIMA.identifier_bytes; // 512
const MAX_OPERATION_NAME_BYTES = MAXIMA.operation_bytes; // 128
const MAX_PATH_COMPONENT_BYTES = MAXIMA.key_bytes; // 128
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---- generic shape helpers ------------------------------------------------------------------

/**
 * A number spelled with a fraction or an exponent in JSON text. Integer fields refuse it (their
 * typeof is not "number"); JSON values (equals, one_of) accept it as the number it denotes.
 */
export class WireFloat {
  constructor(readonly value: number) {}
}

type Rec = Readonly<Record<string, unknown>>;

function record(u: unknown): Rec {
  if (typeof u !== "object" || u === null || Array.isArray(u)) return fail("expected an object");
  const proto: unknown = Object.getPrototypeOf(u);
  if (proto !== Object.prototype && proto !== null) return fail("expected a plain object");
  return u as Rec;
}

/** Exactly the required keys, plus any of the optional ones. Unknown or symbol keys are refused. */
function closedKeys(r: Rec, required: readonly string[], optional: readonly string[] = []): void {
  for (const k of Reflect.ownKeys(r)) {
    if (typeof k !== "string") fail("symbol member");
    if (!required.includes(k) && !optional.includes(k)) fail("unknown member");
  }
  for (const k of required) if (!Object.hasOwn(r, k)) fail("missing member");
}

/** Reads an own data property once; accessors are refused. */
function read(r: Rec, k: string): unknown {
  const d = Object.getOwnPropertyDescriptor(r, k);
  if (d === undefined || !("value" in d)) return fail("missing or computed member");
  return d.value as unknown;
}

function has(r: Rec, k: string): boolean {
  return Object.hasOwn(r, k);
}

function array(u: unknown): unknown[] {
  if (!Array.isArray(u)) return fail("expected an array");
  const items: unknown[] = [];
  for (let i = 0; i < u.length; i++) {
    if (!Object.hasOwn(u, i)) fail("sparse array");
    items.push((u as unknown[])[i]);
  }
  return items;
}

function nonEmptyArray(u: unknown, maxItems: number): unknown[] {
  const items = array(u);
  if (items.length === 0) fail("empty set");
  if (items.length > maxItems) fail("too many items");
  return items;
}

/** True when every UTF-16 surrogate is paired, so the string has one UTF-8 form. */
function wellFormed(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function text(u: unknown): string {
  if (typeof u !== "string" || !wellFormed(u)) return fail("expected a well-formed string");
  return u;
}

/** Identifier-like strings (JTI, handles, audiences, operation names, path components). */
function identifier(u: unknown, maxBytes = Number.POSITIVE_INFINITY): string {
  const s = text(u);
  if (s.length === 0) fail("empty identifier");
  if (utf8(s).length > maxBytes) fail("identifier too long");
  return s;
}

function integerBetween(u: unknown, min: number, max: number): number {
  if (typeof u !== "number" || !Number.isSafeInteger(u) || u < min || u > max) return fail("integer out of range");
  return u === 0 ? 0 : u; // normalizes -0
}

// ---- scalar fields --------------------------------------------------------------------------

export function parseThumbprint(u: unknown): string {
  const s = text(u);
  // base64urlDecode refuses padding, other alphabets, bad lengths, and non-canonical trailing bits.
  if (base64urlDecode(utf8(s)).length !== 32) fail("thumbprint is not 32 bytes");
  return s;
}

export function parseInvocationId(u: unknown): string {
  const s = text(u);
  if (!CANONICAL_UUID.test(s)) fail("invocation id is not a canonical lowercase UUID");
  return s;
}

function parseEpoch(u: unknown): number {
  return integerBetween(u, 0, MAX_INTEGER);
}

function parseAudiences(u: unknown): string[] {
  return nonEmptyArray(u, MAX_AUDIENCES).map((a) => identifier(a, MAX_AUDIENCE_BYTES));
}

function parsePath(u: unknown): string[] {
  const parts = array(u);
  if (parts.length === 0) fail("empty path");
  if (parts.length > MAX_PATH_COMPONENTS) fail("path too long");
  return parts.map((c) => identifier(c, MAX_PATH_COMPONENT_BYTES));
}

/** Validates and copies a JSON value (strings well-formed, numbers finite, plain objects only). */
function parseJson(u: unknown, depth: number): JsonValue {
  if (depth > MAXIMA.depth) return fail("JSON too deep");
  if (u === null) return null;
  // A float spelled in JSON text (see childFromWireText) is a legal JSON value here; only its
  // numeric value reaches the canonical form.
  if (u instanceof WireFloat) return parseJson(u.value, depth);
  switch (typeof u) {
    case "boolean":
      return u;
    case "number":
      if (!Number.isFinite(u)) return fail("non-finite number");
      return u === 0 ? 0 : u;
    case "string":
      return text(u);
    case "object": {
      if (Array.isArray(u)) return array(u).map((x) => parseJson(x, depth + 1));
      const r = record(u);
      const entries: [string, JsonValue][] = [];
      for (const k of Reflect.ownKeys(r)) {
        if (typeof k !== "string") return fail("symbol member");
        entries.push([text(k), parseJson(read(r, k), depth + 1)]);
      }
      return Object.fromEntries(entries);
    }
    default:
      return fail("not a JSON value");
  }
}

// ---- operations and selectors ---------------------------------------------------------------

function parseSelector(u: unknown): Selector {
  const r = record(u);
  const kind = read(r, "kind");
  switch (kind) {
    case "all":
      closedKeys(r, ["kind"]);
      return { kind: "all" };
    case "equals":
      closedKeys(r, ["kind", "path", "value"]);
      return { kind: "equals", path: parsePath(read(r, "path")), value: parseJson(read(r, "value"), 0) };
    case "lte":
    case "gte":
      closedKeys(r, ["kind", "path", "value"]);
      // Integer bounds only: a float bound against an integer argument would be a silent deny.
      return { kind, path: parsePath(read(r, "path")), value: integerBetween(read(r, "value"), -MAX_INTEGER, MAX_INTEGER) };
    case "one_of":
      closedKeys(r, ["kind", "path", "values"]);
      return {
        kind: "one_of",
        path: parsePath(read(r, "path")),
        values: nonEmptyArray(read(r, "values"), MAX_ONE_OF_VALUES).map((v) => parseJson(v, 0)),
      };
    default:
      return fail("unknown selector kind");
  }
}

export function parseOperations(u: unknown): Operation[] {
  const operations = nonEmptyArray(u, MAX_OPERATIONS).map((o): Operation => {
    const r = record(o);
    closedKeys(r, ["name", "selectors"]);
    return {
      name: identifier(read(r, "name"), MAX_OPERATION_NAME_BYTES),
      selectors: nonEmptyArray(read(r, "selectors"), MAX_SELECTORS).map(parseSelector),
    };
  });
  // Operation names are unique.
  if (new Set(operations.map((o) => o.name)).size !== operations.length) fail("duplicate operation name");
  return operations;
}

// ---- cumulative policy ----------------------------------------------------------------------

export function parsePolicy(u: unknown): CumulativePolicy {
  const r = record(u);
  closedKeys(r, ["windowSeconds"], ["maxCount", "sumPath", "maxSum", "distinctPath", "maxDistinct"]);
  const windowSeconds = integerBetween(read(r, "windowSeconds"), 1, MAX_WINDOW_SECONDS);
  // A present member is validated as itself: null and undefined are never "absent".
  const maxCount = has(r, "maxCount") ? integerBetween(read(r, "maxCount"), 1, MAX_INTEGER) : undefined;
  const sumPath = has(r, "sumPath") ? parsePath(read(r, "sumPath")) : undefined;
  const maxSum = has(r, "maxSum") ? integerBetween(read(r, "maxSum"), 0, MAX_INTEGER) : undefined;
  const distinctPath = has(r, "distinctPath") ? parsePath(read(r, "distinctPath")) : undefined;
  const maxDistinct = has(r, "maxDistinct") ? integerBetween(read(r, "maxDistinct"), 1, MAX_DISTINCT) : undefined;

  if ((sumPath === undefined) !== (maxSum === undefined)) fail("sumPath and maxSum appear together");
  if ((distinctPath === undefined) !== (maxDistinct === undefined)) fail("distinctPath and maxDistinct appear together");
  if (maxCount === undefined && maxSum === undefined && maxDistinct === undefined) fail("a policy needs a ceiling");

  return {
    windowSeconds,
    ...(maxCount === undefined ? {} : { maxCount }),
    ...(sumPath === undefined ? {} : { sumPath }),
    ...(maxSum === undefined ? {} : { maxSum }),
    ...(distinctPath === undefined ? {} : { distinctPath }),
    ...(maxDistinct === undefined ? {} : { maxDistinct }),
  };
}

// ---- children and parents -------------------------------------------------------------------

const CHILD_KEYS = ["holderThumbprint", "audiences", "operations", "notBefore", "expiresAt"] as const;

function optionalPolicy(r: Rec): { cumulativePolicy: CumulativePolicy } | Record<string, never> {
  return has(r, "cumulativePolicy") ? { cumulativePolicy: parsePolicy(read(r, "cumulativePolicy")) } : {};
}

export function parseRequestedChild(u: unknown): RequestedChild {
  const r = record(u);
  closedKeys(r, CHILD_KEYS, ["cumulativePolicy"]);
  const audiences = read(r, "audiences");
  const operations = read(r, "operations");
  const notBefore = read(r, "notBefore");
  const expiresAt = read(r, "expiresAt");
  return {
    holderThumbprint: parseThumbprint(read(r, "holderThumbprint")),
    audiences: audiences === null ? null : parseAudiences(audiences),
    operations: operations === null ? null : parseOperations(operations),
    notBefore: notBefore === null ? null : parseEpoch(notBefore),
    expiresAt: expiresAt === null ? null : parseEpoch(expiresAt),
    ...optionalPolicy(r),
  };
}

export function parseMaterializedChild(u: unknown): MaterializedChild {
  const r = record(u);
  closedKeys(r, CHILD_KEYS, ["cumulativePolicy"]);
  return {
    holderThumbprint: parseThumbprint(read(r, "holderThumbprint")),
    audiences: parseAudiences(read(r, "audiences")),
    operations: parseOperations(read(r, "operations")),
    notBefore: parseEpoch(read(r, "notBefore")),
    expiresAt: parseEpoch(read(r, "expiresAt")),
    ...optionalPolicy(r),
  };
}

function parseIdentityFields(r: Rec): ParentIdentity {
  const contractMajor = read(r, "contractMajor");
  // The parent's major chooses the version. A v2 parent is REQ-2; every other value (v1, v3,
  // unknown, absent, mistyped) is refused with the one closed error.
  if (contractMajor !== SUPPORTED_PARENT_MAJOR) fail("unsupported parent contract major");
  return {
    jti: identifier(read(r, "jti")),
    contractMajor,
    holderThumbprint: parseThumbprint(read(r, "holderThumbprint")),
  };
}

export function parseParentIdentity(u: unknown): ParentIdentity {
  const r = record(u);
  closedKeys(r, ["jti", "contractMajor", "holderThumbprint"]);
  return parseIdentityFields(r);
}

export function parseParentContext(u: unknown): ParentContext {
  const r = record(u);
  closedKeys(r, ["jti", "contractMajor", "holderThumbprint", "audiences", "operations", "notBefore", "expiresAt"]);
  return {
    ...parseIdentityFields(r),
    audiences: parseAudiences(read(r, "audiences")),
    operations: parseOperations(read(r, "operations")),
    notBefore: parseEpoch(read(r, "notBefore")),
    expiresAt: parseEpoch(read(r, "expiresAt")),
  };
}

export const parseConsumerId = identifier;

export { closedKeys as closedKeysOf, read as readMember, record as recordOf, text as wellFormedText };
