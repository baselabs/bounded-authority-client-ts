/** A JSON value, as admitted in `equals` and `one_of` selectors. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [member: string]: JsonValue };

/**
 * One selector of an operation. `lte` and `gte` carry integer bounds only (safe integers);
 * a fractional, non-finite, or out-of-range bound is refused.
 */
export type Selector =
  | { readonly kind: "all" }
  | { readonly kind: "equals"; readonly path: readonly string[]; readonly value: JsonValue }
  | { readonly kind: "lte" | "gte"; readonly path: readonly string[]; readonly value: number }
  | { readonly kind: "one_of"; readonly path: readonly string[]; readonly values: readonly JsonValue[] };

export interface Operation {
  readonly name: string;
  readonly selectors: readonly Selector[];
}

/**
 * A child cumulative policy. Absent optional members are absent keys, never `null` or
 * `undefined`. `sumPath` and `maxSum` appear together; `distinctPath` and `maxDistinct` appear
 * together; at least one ceiling (`maxCount`, `maxSum`, `maxDistinct`) is required.
 */
export interface CumulativePolicy {
  readonly windowSeconds: number;
  readonly maxCount?: number;
  readonly sumPath?: readonly string[];
  readonly maxSum?: number;
  readonly distinctPath?: readonly string[];
  readonly maxDistinct?: number;
}

/**
 * The child as requested: `audiences`, `operations`, `notBefore`, and `expiresAt` are `null`
 * to inherit the parent's exact values. `cumulativePolicy` is an absent key when there is none.
 */
export interface RequestedChild {
  readonly holderThumbprint: string;
  readonly audiences: readonly string[] | null;
  readonly operations: readonly Operation[] | null;
  readonly notBefore: number | null;
  readonly expiresAt: number | null;
  readonly cumulativePolicy?: CumulativePolicy;
}

/** The child after inheritance: every dimension is concrete. */
export interface MaterializedChild {
  readonly holderThumbprint: string;
  readonly audiences: readonly string[];
  readonly operations: readonly Operation[];
  readonly notBefore: number;
  readonly expiresAt: number;
  readonly cumulativePolicy?: CumulativePolicy;
}

/** What the digest needs to know about the parent. */
export interface ParentIdentity {
  /** The parent's public grant JTI (not a database identifier). */
  readonly jti: string;
  /** The parent's contract major. Only `2` is accepted. */
  readonly contractMajor: number;
  /** The parent's holder thumbprint (canonical unpadded base64url of 32 bytes). */
  readonly holderThumbprint: string;
}

/** The parent's identity plus the values a child inherits when it sends `null`. */
export interface ParentContext extends ParentIdentity {
  readonly audiences: readonly string[];
  readonly operations: readonly Operation[];
  readonly notBefore: number;
  readonly expiresAt: number;
}

export interface ReauthorizationDigestInput {
  readonly parent: ParentIdentity;
  /** Canonical lowercase UUID. */
  readonly invocationId: string;
  /** The stable submitting Consumer handle (not its credential UUID). */
  readonly consumerId: string;
  readonly child: MaterializedChild;
}

export interface ReauthorizationDigest {
  /** The complete REQ-2 projection: ten framed fields, concatenated. */
  readonly projection: Uint8Array;
  /** Unpadded base64url SHA-256 of the whole projection. */
  readonly requestSha256: string;
}
