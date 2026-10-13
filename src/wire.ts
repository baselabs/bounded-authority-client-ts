// The JSON body spelling of a child (snake_case members), mapped onto the typed camelCase form.
// The mapping is closed: a member outside the table, in either spelling, is refused.
import { fail, utf8Str } from "@bounded-authority-protocol/verifier";
import type { Tagged } from "@bounded-authority-protocol/verifier";
import { WireFloat, readMember as read, recordOf as record } from "./boundary.js";

const CHILD_MEMBERS: ReadonlyMap<string, string> = new Map([
  ["holder_thumbprint", "holderThumbprint"],
  ["audiences", "audiences"],
  ["operations", "operations"],
  ["not_before", "notBefore"],
  ["expires_at", "expiresAt"],
  ["cumulative_policy", "cumulativePolicy"],
]);

const POLICY_MEMBERS: ReadonlyMap<string, string> = new Map([
  ["window_seconds", "windowSeconds"],
  ["max_count", "maxCount"],
  ["sum_path", "sumPath"],
  ["max_sum", "maxSum"],
  ["distinct_path", "distinctPath"],
  ["max_distinct", "maxDistinct"],
]);

function rename(u: unknown, table: ReadonlyMap<string, string>): Record<string, unknown> {
  const r = record(u);
  const entries: [string, unknown][] = [];
  for (const k of Reflect.ownKeys(r)) {
    const typed = typeof k === "string" ? table.get(k) : undefined;
    if (typed === undefined) return fail("unknown wire member");
    entries.push([typed, read(r, k as string)]);
  }
  return Object.fromEntries(entries);
}

/** Maps a wire-spelled child onto the typed spelling; `parseRequestedChild` then validates it. */
export function wireChildToTyped(u: unknown): Record<string, unknown> {
  const child = rename(u, CHILD_MEMBERS);
  // A null policy is not renamed away: record() inside rename() refuses it.
  if (Object.hasOwn(child, "cumulativePolicy")) child["cumulativePolicy"] = rename(child["cumulativePolicy"], POLICY_MEMBERS);
  return child;
}

/**
 * Converts strictly decoded JSON text (duplicate member names already refused by the decoder) into
 * plain values. Integers become numbers; a number spelled with a fraction or an exponent becomes a
 * WireFloat, which integer fields then refuse.
 */
export function fromTagged(t: Tagged): unknown {
  switch (t.t) {
    case "null":
      return null;
    case "bool":
    case "int":
      return t.v;
    case "float":
      return new WireFloat(t.v);
    case "string":
      return utf8Str(t.v);
    case "array":
      return t.v.map(fromTagged);
    case "object":
      return Object.fromEntries([...t.v].map(([k, v]) => [k, fromTagged(v)]));
  }
}
