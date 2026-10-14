# REQ-2 reauthorization request projection

Client-facing wire contract for the digest that `reauthorizationRequestDigest` computes.

- **Source:** the bounded authority service contract (REQ-2 reauthorization request projection).
- **Vectors:** [`test/vectors/reauthorization-req2.json`](../test/vectors/reauthorization-req2.json),
  seventeen vectors authored for this package from neutral demo data. Each gives a child exactly as
  it appears in a request body, the shared parent context it inherits from, the projection hex,
  and the `request_sha256`. The expected bytes were computed with the service reference
  implementation for the REQ-2 contract, never with this package's code.
- **Demo thumbprints:** a thumbprint is the unpadded base64url of 32 bytes counting up from a seed
  byte: parent `0x00..0x1f`, child A `0x20..0x3f`, child B `0x40..0x5f`.
- **Scope:** the bytes a client must reproduce. Nothing about how the service stores, locks, or
  schedules anything is part of this document.

## What the digest is for

A reauthorization request asks the service to issue a child grant under a parent grant. The
holder (for example a wallet app) signs consent to the child. The consent covers the child's
holder, audiences, operations, validity window, and optional cumulative policy. The digest is how
that consent binds to those fields: the client computes the projection, hashes it, and puts the
result in `cast_arguments.request_sha256` of the holder's v2 proof for operation
`authority.grants.reauthorize`. The service recomputes the same projection from the request body,
so a changed child field no longer matches the signed digest.

The projection is **not** JCS of the request body, and the body's `proof` and `proof_nonce` are
not part of it (the proof binds its own nonce separately).

## Version rule

The parent grant's contract major chooses the version.

| Parent major | Projection tag | This package |
|---|---|---|
| 2 | `BA-REAUTH-REQ-2`, always, including when the child has no cumulative policy | computed |
| 1 | `BA-REAUTH-REQ-1`; a child cumulative policy is refused | refused (closed error) |
| 3, unknown, or missing | none | refused (closed error) |

The request body has no version member. A client that does not know the parent's major cannot
compute the digest. This package implements REQ-2 only; any parent major other than 2 returns the
closed error.

## Primitives

All lengths count **bytes**, never characters. Strings are UTF-8. Integers are ASCII decimal with
no padding and no plus sign.

- `U32(n)`: an unsigned, four-byte, big-endian integer.
- `F(b) = U32(byte_length(b)) || b`
- `L(items) = U32(item_count) || F(item_1) || ... || F(item_n)`

There is no terminator, and no NUL after the tag.

## The ten framed fields

The projection is these ten fields, each wrapped in `F(...)`, concatenated in this order:

| # | Field | Bytes |
|---|---|---|
| 1 | tag | the 15 UTF-8 bytes `BA-REAUTH-REQ-2` |
| 2 | `parent_jti` | the parent's public grant JTI (not a database identifier) |
| 3 | `invocation_id` | canonical **lowercase** UUID |
| 4 | `consumer_id` | the submitting Consumer's stable handle (not its credential identifier) |
| 5 | child `holder_thumbprint` | canonical unpadded base64url of exactly 32 bytes |
| 6 | audiences | `L(audiences)` |
| 7 | operations | `L(encoded_operations)` |
| 8 | child `not_before` | epoch seconds (an integer from 0 to 2^53 - 1), ASCII decimal |
| 9 | child `expires_at` | epoch seconds (an integer from 0 to 2^53 - 1), ASCII decimal |
| 10 | cumulative policy | the encoded policy, or the four ASCII bytes `null` |

## Ordering, sorting, deduplication

| Set | Rule |
|---|---|
| Audiences | sorted and deduplicated by raw UTF-8 bytes |
| Operations | names are unique; sorted by the raw UTF-8 bytes of the name |
| Selectors of one operation | sorted and deduplicated by their **complete encoded bytes**, after their values are canonicalized |
| `one_of` values | sorted and deduplicated by their JCS value bytes |
| Paths | component order is **retained**; never sorted, never deduplicated |

"Sorted by raw bytes" is lexicographic over unsigned bytes, a proper prefix sorting first. It is
not UTF-16 code-unit order (U+1F600 sorts after U+FFFF in bytes, before it in UTF-16) and not
locale order.

## Operations and selectors

Each operation is `F(name) || F(L(encoded_selectors))`.

| Selector | Encoded bytes |
|---|---|
| `all` | `F("all")` |
| `equals`, `lte`, `gte` | `F(kind) || F(L(path)) || F(JCS(value))` |
| `one_of` | `F("one_of") || F(L(path)) || F(L(JCS(values)))` |

`L(path)` lists the path components. `JCS(value)` is the public Bounded Authority Protocol
canonical JSON encoding (RFC 8785 as the verifier package implements it). Each encoded selector
is itself framed when placed in `L(encoded_selectors)`, and each encoded operation is framed when
placed in `L(encoded_operations)`.

**Range bounds are integers only.** The service issues and delegates integer `lte` and `gte`
bounds. A float bound is refused (the protocol itself admits floats, which is why the client must
not produce one).

## Cumulative policy (field 10)

An absent policy is the four ASCII bytes `null`, so the projection then ends with the hex
`00000004 6e756c6c`.

A present policy is **six framed fields**, with no field names and no field count, in exactly this
order, itself framed as field 10:

1. `window_seconds` (decimal)
2. `max_count` (decimal, or `null`)
3. `sum_path` (`L(components)`, or `null`)
4. `max_sum` (decimal, or `null`)
5. `distinct_path` (`L(components)`, or `null`)
6. `max_distinct` (decimal, or `null`)

An absent optional member is the ASCII bytes `null` **inside its frame**. No parent policy is
copied into this field: the parent's policy is applied by the service separately.

Policy rules (all refused otherwise):

- `window_seconds`: integer, 1 through 2,678,400 (31 days).
- At least one ceiling: `max_count`, `max_sum`, or `max_distinct`.
- `max_count`: integer, at least 1, at most 9007199254740991.
- `sum_path` and `max_sum` appear together; `max_sum` is an integer, 0 through 9007199254740991.
- `distinct_path` and `max_distinct` appear together; `max_distinct` is an integer, 1 through 1024.
- Paths have 1 through 32 string components.

In JSON, **omit** a missing `cumulative_policy`. An explicit `null` policy, a `null` optional
policy member, an unknown member, or a malformed policy is refused.

## Inheritance (`null` members)

`audiences`, `operations`, `not_before`, and `expires_at` may be `null` in the request. They are
**materialized from the parent's exact values before encoding**, so an explicit value equal to
the parent's and its `null` form produce the same digest. The holder thumbprint is required and
must differ from the parent's. The cumulative policy is never inherited.

## The digest

```
requestSha256 = base64url_unpadded( SHA-256( projection ) )
```

SHA-256 is over the **entire projection**. Put the 43-character string in
`cast_arguments.request_sha256`. The public v2 proof producer then computes its own
`BAP2-REQUEST` digest over operation `authority.grants.reauthorize` and those cast arguments.

## Size and count limits

The service enforces these limits, and the client refuses the same inputs. Counts apply to the
input as given (before deduplication); byte limits apply to the UTF-8 form.

| Item | Limit |
|---|---|
| Audiences | at most 64; each 1 to 512 bytes |
| Operations | at most 64; each name 1 to 128 bytes |
| Selectors per operation | at most 64 |
| `one_of` values | at most 256 (65 identical values still count as 65) |
| Path | 1 to 32 components, each 1 to 128 bytes (selector paths and policy paths) |
| Each `equals` value and each `one_of` value | the verifier package's canonical-JSON limits (`MAXIMA`): at most 32 levels of nesting, 256 items per array, 64 members per object, 128 bytes per member name, 8,192 bytes per string, 4,096 nodes, and 65,536 canonical bytes; numbers within -(2^53 - 1) to 2^53 - 1 |

Both `childFromWire` and `childFromWireText` check every limit in this table, including the
selector-value limits, as soon as they read the child, and refuse the same children. Neither
applies a size or node limit to the child as a whole: a child of 16 operations with 64 selectors
each (about 42 KB of JSON) is accepted by both.

## JSON text

Two things are visible only in the JSON text, not in a parsed value: duplicate member names, and
how a number is spelled. The service refuses a body with a duplicate member name, and refuses an
integer field spelled with a fraction or an exponent (`2500.0`, `1E2`, `-0.0`). Use
`childFromWireText` to check the text. `childFromWire` takes an already-parsed value and
documents that the text it came from met both rules. Inside `equals` and `one_of` values any
valid number spelling is accepted: `2.0` and `2` canonicalize to the same bytes. Apart from these
two text-only rules and invalid JSON, `childFromWireText` refuses exactly what `childFromWire`
refuses for the parsed text, with three more text-only limits: the whole text is at most
4,194,304 characters, a string at most 8,192 characters, and nesting at most 128 levels. Number
lexemes follow the verifier's decoder (at most 64 bytes, magnitude within 2^53 - 1 by exact
decimal comparison), which can refuse a lexeme whose rounded `JSON.parse` value `childFromWire`
would accept.

## Refusals

Every refusal is one closed error with no detail. From the contract text:

- a parent major other than 2 (so a v1 parent carrying a policy is refused too);
- a float `lte` or `gte` bound;
- an `invocation_id` that is not canonical lowercase;
- an explicit `null` policy or `null` optional policy member;
- an unknown member anywhere;
- a malformed policy (rules above);
- a holder thumbprint that is not canonical unpadded base64url of 32 bytes;
- a holder thumbprint equal to the parent's;
- duplicate operation names.

Beyond the contract's literal text, this package also fails closed on inputs that have no single
byte form or no useful meaning: empty audience, operation, selector, or `one_of` sets; empty
identifier strings; strings with unpaired surrogates (no UTF-8 form); non-finite numbers; selector
values beyond the canonical-JSON limits in [Size and count limits](#size-and-count-limits); and wire
members that are missing
(a missing `audiences`, `operations`, `not_before`, or `expires_at` member is refused; `null`
means inherit, and absence is not `null`).

## Worked example (`lte-child` vector)

A data-export grant. Parent `parent-grant-01` (major 2), consumer `demo-agent`, invocation
`5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d`. Field by field:

| # | Value |
|---|---|
| 1 | `BA-REAUTH-REQ-2` |
| 2 | `parent-grant-01` |
| 3 | `5b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d` |
| 4 | `demo-agent` |
| 5 | child A thumbprint (seed `0x20`) |
| 6 | `L(["https://data.example"])` |
| 7 | `L([ data.export with selectors lte(row_count, 500), equals(format, "csv"), equals(dataset, "inventory") ])`, selectors in encoded-byte order (kind frame first, so `lte` precedes `equals`; then the path frame, so the shorter `["format"]` precedes `["dataset"]`) |
| 8 | `1800000000` |
| 9 | `1800000300` |
| 10 | `null` |

`request_sha256` is `ZEJZyH3UFj_kT81x2WOW-gcPLBOSqtOFqBKsbTT-VO4`. The full projection hex is in
the vectors file.

## Examples across domains

The vectors use generic delegated actions, not one product area. Each is a child a holder might
sign consent to:

| Action | Operation | Selectors | Policy |
|---|---|---|---|
| Read documents | `docs.read` | `equals` on `folder` | none |
| Approve a deployment | `deploy.release` | `equals` on `service`, `one_of` on `stage` | none |
| Export data | `data.export` | `lte` on `row_count`, `equals` on `format` and `dataset` | none, or every policy member (`max_count`, `max_sum` on `row_count`, `max_distinct` on `dataset`) |
| Schedule a meeting | `calendar.schedule` | `lte` on `duration_minutes`, `one_of` on `calendar` | none |
| Set a device temperature | `device.set_temperature` | `gte` and `lte` on `celsius`, `equals` on `device` | none |
| Send messages | `messages.send` | `equals` on `channel` | `max_count` per window |
| Transfer money (one example) | `payments.transfer` | `equals` on `currency`, `lte` on `amount` | `max_sum` on `amount` |

The remaining vectors exercise one rule each (null inheritance, sort and dedup, Unicode byte order,
integers near 2^53, `one_of` value order, path order), with these operations and a few
placeholder names such as `b` and `z`.
