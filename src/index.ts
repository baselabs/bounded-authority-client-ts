// @bounded-authority/client: the wire contract, contract cases, and vectors a client needs for a
// bounded authority service. This release carries one function family: the REQ-2 reauthorization
// request digest, and the parent context it inherits from. See docs/req2-projection.md.
import { base64urlEncode, err, fail, ok, v2 } from "@bounded-authority-protocol/verifier";
import type { Result } from "@bounded-authority-protocol/verifier";
import {
  closedKeysOf,
  inheritOperations,
  parseConsumerId,
  parseInvocationId,
  parseMaterializedChild,
  parseParentContext,
  parseParentIdentity,
  parseRequestedChild,
  readMember,
  recordOf,
  SUPPORTED_PARENT_MAJOR,
  wellFormedText,
} from "./boundary.js";
import { encodeProjection, requestSha256 } from "./projection.js";
import type {
  MaterializedChild,
  ParentContext,
  ParentGrantContext,
  ReauthorizationDigest,
  ReauthorizationDigestInput,
  RequestedChild,
} from "./types.js";
import { grantOperations, wireChildToTyped } from "./wire.js";
import { readJsonText } from "./json-text.js";
import { utf8 } from "./bytes.js";

const ascii = new TextDecoder("ascii");

export type {
  CumulativePolicy,
  JsonValue,
  MaterializedChild,
  Operation,
  ParentContext,
  ParentGrantContext,
  ParentIdentity,
  FloatBound,
  ParentOperation,
  ParentSelector,
  ReauthorizationDigest,
  ReauthorizationDigestInput,
  RequestedChild,
  Selector,
} from "./types.js";
export type { Result } from "@bounded-authority-protocol/verifier";

// Every public function converts any failure into the one closed error. That includes failures
// that are not protocol refusals (a throwing getter or Proxy trap in caller input, for example):
// the caller's input is untrusted, and a refusal is the only outcome it can produce.
function guarded<T>(fn: () => T): Result<T> {
  try {
    return ok(fn());
  } catch {
    return err();
  }
}

/**
 * Parses a child as it appears in the JSON request body (`body.child`, snake_case members) into
 * the typed form. `audiences`, `operations`, `not_before`, and `expires_at` must be present and
 * may be `null` (inherit); `cumulative_policy` is omitted when there is none. An explicit null
 * policy, a null optional policy member, and any unknown member are refused.
 *
 * The input is an already-parsed JavaScript value, so this function cannot see how the JSON text
 * spelled things. It requires that the text had no duplicate member names and spelled every
 * integer field as a plain integer (not `2500.0`, `1E2`, or `-0.0`). To check the text itself, use
 * `childFromWireText`.
 */
export function childFromWire(wire: unknown): Result<RequestedChild> {
  return guarded(() => parseRequestedChild(wireChildToTyped(wire)));
}

/**
 * Like `childFromWire`, from the JSON text of `body.child`. Refuses duplicate member names, and
 * refuses an integer field (a bound, a timestamp, a policy limit) spelled with a fraction or an
 * exponent, such as `2500.0`, `1E2`, or `-0.0`, as the service does. JSON values in `equals` and
 * `one_of` selectors may still be spelled any valid way: they canonicalize to the same bytes.
 * Every other limit is the one `childFromWire` applies, so the two refuse the same children.
 */
export function childFromWireText(jsonText: string): Result<RequestedChild> {
  return guarded(() => {
    // The length is checked before anything else reads the text; every string the reader returns
    // is checked for lone surrogates by the child parser.
    if (typeof jsonText !== "string") fail("expected JSON text");
    return parseRequestedChild(wireChildToTyped(readJsonText(jsonText)));
  });
}

/**
 * Fills a child's `null` audiences, operations, not-before, and expiry from the parent's exact
 * values. Refuses a thumbprint equal to the parent's and any parent whose contract major is not 2.
 * The cumulative policy is never inherited. The parent's selectors follow the v2 grant rules; an
 * inherited `all` becomes a plain `all`, and an inherited fractional bound is refused (REQ-2
 * bounds are integers).
 */
export function materializeChild(child: RequestedChild, parent: ParentContext): Result<MaterializedChild> {
  return guarded(() => {
    const p = parseParentContext(parent);
    const c = parseRequestedChild(child);
    if (c.holderThumbprint === p.holderThumbprint) fail("child holder thumbprint equals the parent's");
    return {
      holderThumbprint: c.holderThumbprint,
      audiences: c.audiences ?? p.audiences,
      operations: c.operations ?? inheritOperations(p.operations),
      notBefore: c.notBefore ?? p.notBefore,
      expiresAt: c.expiresAt ?? p.expiresAt,
      ...(c.cumulativePolicy === undefined ? {} : { cumulativePolicy: c.cumulativePolicy }),
    };
  });
}

/**
 * Computes the REQ-2 projection and its digest for a reauthorization request. Put
 * `requestSha256` in `cast_arguments.request_sha256` of the v2 proof for operation
 * `authority.grants.reauthorize`. Every refusal is the same closed `{ ok: false }`.
 */
export function reauthorizationRequestDigest(input: ReauthorizationDigestInput): Result<ReauthorizationDigest> {
  return guarded(() => {
    const r = recordOf(input);
    closedKeysOf(r, ["parent", "invocationId", "consumerId", "child"]);
    const parent = parseParentIdentity(readMember(r, "parent"));
    const invocationId = parseInvocationId(readMember(r, "invocationId"));
    const consumerId = parseConsumerId(readMember(r, "consumerId"));
    const child = parseMaterializedChild(readMember(r, "child"));
    if (child.holderThumbprint === parent.holderThumbprint) fail("child holder thumbprint equals the parent's");
    const projection = encodeProjection({ parentJti: parent.jti, invocationId, consumerId, child });
    return { projection, requestSha256: requestSha256(projection) };
  });
}

/**
 * Reads the parent context a child inherits from: the parent grant's `jti`, holder thumbprint
 * (`cnf.jkt`), audiences, operations, `nbf`, and `exp`, from the compact v2 grant the holder
 * already has, plus its `issuer` and `verification: "not_evaluated"`. The grant is decoded with the
 * verifier package's `v2.decodeGrant`, which checks its structure but not its signature: verify it
 * with `v2.verifyGrant` first.
 * Refuses anything that is not a well-formed v2 grant (a v1 or v3 grant included).
 */
export function parentContextFromGrant(grantCompact: string): Result<ParentGrantContext> {
  return guarded(() => {
    const compact = utf8(wellFormedText(grantCompact));
    const decoded = v2.decodeGrant(compact);
    if (!decoded.ok) fail("not a well-formed v2 grant");
    const g = decoded.value;
    const parent = parseParentContext({
      jti: g.grantId,
      contractMajor: SUPPORTED_PARENT_MAJOR,
      holderThumbprint: ascii.decode(base64urlEncode(g.holderThumbprint)),
      audiences: g.audiences,
      operations: grantOperations(compact),
      notBefore: g.notBefore,
      expiresAt: g.expiresAt,
    });
    return { ...parent, issuer: g.issuer, verification: "not_evaluated" as const };
  });
}
