#!/usr/bin/env node
// Mutation red-proofs. A gate that cannot go red is vacuous, so each rule the contract states is
// broken here, one at a time, in a temporary edit of src/. For every mutation the named test must
// fail; a mutation that no test notices (a survivor) fails this script. The original bytes of every
// touched file are restored in a finally block and on SIGINT/SIGTERM, and the suite is re-run
// green at the end to prove the restore.
//
//   node tools/mutation-proofs.mjs            run every mutation
//   node tools/mutation-proofs.mjs <id>...    run the named mutations only
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const at = (rel) => join(ROOT, rel);

// Each mutation: id, the rule it breaks, file, the exact text to find (must occur once), its
// replacement (or append: text appended to the file), and a substring of the test that must go red.
// `also` lists further { file, find, replace } edits made at the same time, for a rule enforced in
// more than one place: removing only one guard would leave the rule intact and prove nothing.
const MUTATIONS = [
  // ---- framing -------------------------------------------------------------------------------
  { id: "u32-little-endian", rule: "U32 is big-endian", file: "src/bytes.ts",
    find: "setUint32(0, n, false)", replace: "setUint32(0, n, true)", expect: "tag: the projection opens" },
  { id: "u32-16-bit-width", rule: "U32 is four bytes wide (no 16-bit truncation)", file: "src/bytes.ts",
    find: "setUint32(0, n, false)", replace: "setUint32(0, n & 0xffff, false)", expect: "U32 width and order" },
  { id: "length-counts-characters", rule: "lengths count bytes, not characters", file: "src/bytes.ts",
    find: "export const frame = (b: Uint8Array): Uint8Array => concat([u32(b.length), b]);",
    replace: "export const frame = (b: Uint8Array): Uint8Array => concat([u32(new TextDecoder().decode(b).length), b]);",
    expect: "lengths count bytes" },
  { id: "tag-version", rule: "the tag is BA-REAUTH-REQ-2", file: "src/projection.ts",
    find: 'const TAG = "BA-REAUTH-REQ-2";', replace: 'const TAG = "BA-REAUTH-REQ-1";', expect: "tag: the projection opens" },
  { id: "tag-nul-terminator", rule: "no NUL after the tag", file: "src/projection.ts",
    find: "utf8(TAG),", replace: 'utf8(TAG + "\\0"),', expect: "tag: the projection opens" },
  { id: "trailing-terminator", rule: "no terminator after the last field", file: "src/projection.ts",
    find: "return concat(fields.map(frame));", replace: "return concat([...fields.map(frame), new Uint8Array(1)]);",
    expect: "null marker: an absent policy" },
  { id: "decimal-radix", rule: "integers are ASCII decimal", file: "src/projection.ts",
    find: "utf8(String(n))", replace: "utf8(n.toString(16))", expect: "integers use ASCII decimal" },

  // ---- null marker ---------------------------------------------------------------------------
  { id: "null-marker-spelling", rule: "the null marker is the four ASCII bytes null", file: "src/projection.ts",
    find: 'const NULL_MARKER = utf8("null");', replace: 'const NULL_MARKER = utf8("nul");', expect: "null marker: an absent policy" },
  { id: "null-marker-empty-policy-member", rule: "an absent policy member is a framed null, not an empty frame", file: "src/projection.ts",
    find: "n === undefined ? NULL_MARKER : decimal(n)", replace: "n === undefined ? new Uint8Array(0) : decimal(n)", expect: "policy: six framed fields" },
  { id: "null-marker-absent-policy-empty", rule: "an absent whole policy is the framed null, not an empty frame", file: "src/projection.ts",
    find: "child.cumulativePolicy === undefined ? NULL_MARKER : encodePolicy(child.cumulativePolicy)",
    replace: "child.cumulativePolicy === undefined ? new Uint8Array(0) : encodePolicy(child.cumulativePolicy)",
    expect: "null marker: an absent policy" },

  // ---- ordering, sorting, and dedup ----------------------------------------------------------
  { id: "audiences-unsorted", rule: "audiences are sorted", file: "src/projection.ts",
    find: "sort(unique(child.audiences.map(utf8)))", replace: "unique(child.audiences.map(utf8))", expect: "audiences sort" },
  { id: "audiences-not-deduped", rule: "audiences are deduplicated", file: "src/projection.ts",
    find: "sort(unique(child.audiences.map(utf8)))", replace: "sort(child.audiences.map(utf8))", expect: "audiences dedup" },
  { id: "sort-utf16-not-bytes", rule: "sorting is by raw UTF-8 bytes, not UTF-16 code units", file: "src/bytes.ts",
    find: "[...items].sort(compareBytes)",
    replace: "[...items].sort((a, b) => { const x = new TextDecoder().decode(a); const y = new TextDecoder().decode(b); return x < y ? -1 : x > y ? 1 : 0; })",
    expect: "audiences sort" },
  { id: "operations-unsorted", rule: "operations are sorted by name", file: "src/projection.ts",
    find: ".sort((a, b) => compareBytes(a.name, b.name))", replace: ".sort(() => 0)", expect: "operations sort" },
  { id: "operations-sorted-by-encoded-bytes", rule: "operations sort by name bytes, not by encoded bytes", file: "src/projection.ts",
    find: ".sort((a, b) => compareBytes(a.name, b.name))", replace: ".sort((a, b) => compareBytes(a.encoded, b.encoded))", expect: "operations sort" },
  { id: "selectors-unsorted", rule: "selector sets are sorted by complete encoded bytes", file: "src/projection.ts",
    find: "sort(unique(o.selectors.map(encodeSelector)))", replace: "unique(o.selectors.map(encodeSelector))", expect: "selector sort" },
  { id: "selectors-not-deduped", rule: "selector sets are deduplicated by complete encoded bytes", file: "src/projection.ts",
    find: "sort(unique(o.selectors.map(encodeSelector)))", replace: "sort(o.selectors.map(encodeSelector))", expect: "selector dedup" },
  { id: "one-of-unsorted", rule: "one_of values are sorted by JCS bytes", file: "src/projection.ts",
    find: "sort(unique(s.values.map(jcs)))", replace: "unique(s.values.map(jcs))", expect: "one_of value sort" },
  { id: "one-of-not-deduped", rule: "one_of values are deduplicated by JCS bytes", file: "src/projection.ts",
    find: "sort(unique(s.values.map(jcs)))", replace: "sort(s.values.map(jcs))", expect: "one_of value dedup" },
  { id: "path-sorted", rule: "paths retain component order", file: "src/projection.ts",
    find: "list(components.map(utf8))", replace: "list(components.map(utf8).sort(compareBytes))", expect: "path order" },
  { id: "path-deduped", rule: "paths retain every component", file: "src/projection.ts",
    find: "list(components.map(utf8))", replace: "list(unique(components.map(utf8)))", expect: "path order" },
  { id: "policy-field-order", rule: "policy fields are in the contract order", file: "src/projection.ts",
    find: "    frame(optionalPath(p.sumPath)),\n    frame(optional(p.maxSum)),",
    replace: "    frame(optional(p.maxSum)),\n    frame(optionalPath(p.sumPath)),", expect: "policy: six framed fields" },
  { id: "jcs-replaced-by-json", rule: "values use the canonical JSON encoding (sorted keys)", file: "src/projection.ts",
    find: "jcsEncode(tagged(v))", replace: "utf8(JSON.stringify(v))", expect: "JCS value form" },

  // ---- refusals ------------------------------------------------------------------------------
  { id: "accept-float-bounds", rule: "lte/gte bounds are integers", file: "src/boundary.ts",
    find: "!Number.isSafeInteger(u)", replace: "!Number.isFinite(u)", expect: "refuses: a float lte bound" },
  { id: "accept-uppercase-invocation", rule: "invocation_id is canonical lowercase", file: "src/boundary.ts",
    find: "{12}$/;", replace: "{12}$/i;", expect: "an uppercase invocation_id" },
  { id: "accept-null-policy", rule: "an explicit null policy is refused", file: "src/boundary.ts",
    find: 'has(r, "cumulativePolicy") ?', replace: 'has(r, "cumulativePolicy") && read(r, "cumulativePolicy") !== null ?',
    expect: "an explicit null cumulative policy" },
  { id: "accept-unknown-members", rule: "unknown members are refused", file: "src/boundary.ts",
    find: 'if (!required.includes(k) && !optional.includes(k)) fail("unknown member");', replace: "", expect: "an unknown child member" },
  { id: "accept-same-thumbprint", rule: "the child thumbprint must differ from the parent's", file: "src/index.ts",
    find: 'if (child.holderThumbprint === parent.holderThumbprint) fail("child holder thumbprint equals the parent\'s");',
    replace: "", expect: "a holder thumbprint equal to the parent's" },
  { id: "accept-same-thumbprint-materialize", rule: "materialize refuses the parent's thumbprint", file: "src/index.ts",
    find: 'if (c.holderThumbprint === p.holderThumbprint) fail("child holder thumbprint equals the parent\'s");',
    replace: "", expect: "materialize refuses: a thumbprint equal to the parent's" },
  { id: "accept-short-thumbprint", rule: "the thumbprint is 32 bytes", file: "src/boundary.ts",
    find: ".length !== 32)", replace: ".length < 1)", expect: "a holder thumbprint of 31 bytes" },
  { id: "accept-v1-parent", rule: "only a v2 parent is accepted", file: "src/boundary.ts",
    find: "if (contractMajor !== SUPPORTED_PARENT_MAJOR)", replace: 'if (typeof contractMajor !== "number")',
    expect: "a v1 parent carrying a cumulative policy" },
  { id: "accept-duplicate-operation-names", rule: "operation names are unique", file: "src/boundary.ts",
    find: 'if (new Set(operations.map((o) => o.name)).size !== operations.length) fail("duplicate operation name");',
    replace: "", expect: "duplicate operation names" },
  { id: "accept-lone-surrogates", rule: "strings are well-formed Unicode", file: "src/boundary.ts",
    find: "function wellFormed(s: string): boolean {", replace: "function wellFormed(s: string): boolean {\n  if (s.length >= 0) return true;",
    expect: "a lone surrogate in an audience" },
  { id: "accept-empty-sets", rule: "audience and operation sets are nonempty", file: "src/boundary.ts",
    find: 'if (items.length === 0) fail("empty set");', replace: "", expect: "empty audiences" },
  { id: "accept-policy-without-ceiling", rule: "a policy needs a ceiling", file: "src/boundary.ts",
    find: 'if (maxCount === undefined && maxSum === undefined && maxDistinct === undefined) fail("a policy needs a ceiling");',
    replace: "", expect: "a policy with no ceiling" },
  { id: "accept-unpaired-sum", rule: "sum_path and max_sum appear together", file: "src/boundary.ts",
    find: 'if ((sumPath === undefined) !== (maxSum === undefined)) fail("sumPath and maxSum appear together");',
    replace: "", expect: "sumPath without maxSum" },
  { id: "accept-zero-window", rule: "window_seconds is 1 through 31 days", file: "src/boundary.ts",
    find: 'integerBetween(read(r, "windowSeconds"), 1, MAX_WINDOW_SECONDS)', replace: 'integerBetween(read(r, "windowSeconds"), 0, MAX_WINDOW_SECONDS)',
    expect: "windowSeconds 0" },
  { id: "accept-long-path", rule: "paths have at most 32 components", file: "src/boundary.ts",
    find: 'if (parts.length > MAX_PATH_COMPONENTS) fail("path too long");', replace: "", expect: "a 33-component selector path",
    also: [{ file: "src/boundary.ts", find: "  v2.parseSelector(tagged(s as unknown as JsonValue));\n", replace: "" }] },

  // ---- parent operations ---------------------------------------------------------------------
  { id: "parent-selector-unchecked", rule: "a parent selector is accepted only when the v2 profile accepts it", file: "src/boundary.ts",
    find: "  v2.parseSelector(tagged(copy));\n", replace: "", expect: "parent refused: an all selector with path only" },
  { id: "inherit-all-keeps-inert", rule: "an inherited all is a plain all", file: "src/boundary.ts",
    find: '(s.kind === "all" ? { kind: "all" } : s)', replace: "s", expect: "parent: an inherited all with inert members" },
  { id: "inherit-skips-child-rules", rule: "an inherited selector must satisfy the child rules", file: "src/boundary.ts",
    find: "  return parseOperations(\n    operations.map(", replace: "  return (\n    operations.map(", expect: "parent: an inherited fractional bound is refused" },

  { id: "float-bound-retagged", rule: "a float-tagged whole-number bound keeps its tag", file: "src/wire.ts",
    find: '  if (range && value?.t === "float" && Number.isInteger(value.v)) return { ...(plain as Record<string, unknown>), value: { float: value.v } };\n',
    replace: "", expect: "keeps its float tag and is never inherited" },
  { id: "grant-epoch-nonnegative", rule: "parent and inherited times are any integers within 2^53 - 1", file: "src/boundary.ts",
    find: "return integerBetween(u, -MAX_INTEGER, MAX_INTEGER);", replace: "return integerBetween(u, 0, MAX_INTEGER);",
    expect: "a grant with negative times is read" },

  // ---- size and count limits -----------------------------------------------------------------
  { id: "accept-65-audiences", rule: "at most 64 audiences", file: "src/boundary.ts",
    find: "nonEmptyArray(u, MAX_AUDIENCES)", replace: "nonEmptyArray(u, Number.POSITIVE_INFINITY)", expect: "audiences: at most 64" },
  { id: "accept-long-audience", rule: "an audience is at most 512 bytes", file: "src/boundary.ts",
    find: "identifier(a, MAX_AUDIENCE_BYTES)", replace: "identifier(a)", expect: "audience: at most 512 bytes" },
  { id: "limit-counts-characters", rule: "byte limits count bytes, not characters", file: "src/boundary.ts",
    find: "if (utf8(s).length > maxBytes)", replace: "if (s.length > maxBytes)", expect: "audience: at most 512 bytes" },
  { id: "accept-65-operations", rule: "at most 64 operations", file: "src/boundary.ts",
    find: "nonEmptyArray(u, MAX_OPERATIONS)", replace: "nonEmptyArray(u, Number.POSITIVE_INFINITY)", expect: "operations: at most 64" },
  { id: "accept-long-operation-name", rule: "an operation name is at most 128 bytes", file: "src/boundary.ts",
    find: 'identifier(read(r, "name"), MAX_OPERATION_NAME_BYTES)', replace: 'identifier(read(r, "name"))', expect: "operation name: at most 128 bytes" },
  { id: "accept-65-selectors", rule: "at most 64 selectors per operation", file: "src/boundary.ts",
    find: 'nonEmptyArray(read(r, "selectors"), MAX_SELECTORS)', replace: 'nonEmptyArray(read(r, "selectors"), Number.POSITIVE_INFINITY)', expect: "selectors per operation: at most 64" },
  { id: "accept-257-one-of-values", rule: "at most 256 one_of values, counted before dedup", file: "src/boundary.ts",
    find: 'nonEmptyArray(read(r, "values"), MAX_ONE_OF_VALUES)', replace: 'nonEmptyArray(read(r, "values"), Number.POSITIVE_INFINITY)', expect: "one_of values: at most 256",
    also: [{ file: "src/boundary.ts", find: "  v2.parseSelector(tagged(s as unknown as JsonValue));\n", replace: "" }] },
  { id: "accept-long-path-component", rule: "a path component is at most 128 bytes (selector and policy paths)", file: "src/boundary.ts",
    find: "identifier(c, MAX_PATH_COMPONENT_BYTES)", replace: "identifier(c)", expect: "path: at most 32 components, each 1 to 128 bytes" },

  // ---- the public boundary and the text entry ------------------------------------------------
  { id: "catch-only-invalid", rule: "the public boundary catches every failure, not only protocol refusals", file: "src/index.ts",
    find: "  } catch {\n    return err();\n  }", replace: '  } catch (e) {\n    if (!(e instanceof Error && e.name === "InvalidError")) throw e;\n    return err();\n  }',
    expect: "a throwing Proxy anywhere" },
  { id: "text-accepts-wire-float", rule: "an integer field spelled with a fraction or exponent is refused", file: "src/json-text.ts",
    find: "? n : new WireFloat(n);", replace: "? n : n;", expect: "text refuses: an lte bound spelled 5.0" },
  { id: "text-accepts-duplicates", rule: "duplicate member names in JSON text are refused", file: "src/json-text.ts",
    find: 'if (seen.has(name)) return fail("duplicate member name");', replace: "", expect: "text refuses: a duplicate member name in the child" },
  { id: "text-accepts-leading-zero", rule: "the text follows the JSON number grammar", file: "src/json-text.ts",
    find: "/-?(?:0|[1-9][0-9]*)", replace: "/-?(?:[0-9]+)", expect: "text refuses: a number with a leading zero" },
  { id: "text-accepts-trailing", rule: "nothing may follow the JSON value", file: "src/json-text.ts",
    find: 'if (i !== text.length) fail("trailing content after the JSON value");', replace: "", expect: "text refuses: trailing bytes after the value" },
  { id: "reader-accepts-control-chars", rule: "a raw control character in a JSON string is refused", file: "src/json-text.ts",
    find: 'if (c !== "\\\\") return fail("control character in string");', replace: 'if (c !== "\\\\") { out += c; i++; continue; }',
    expect: "reader refuses: a raw control character in a string" },
  { id: "reader-accepts-any-escape", rule: "only the JSON escapes are accepted", file: "src/json-text.ts",
    find: 'return fail("bad escape");', replace: 'out += e ?? ""; i += 2;', expect: "reader refuses: an unknown escape" },
  { id: "reader-accepts-non-hex", rule: "a \\u escape has four hex digits", file: "src/json-text.ts",
    find: "/^[0-9A-Fa-f]{4}$/", replace: "/^.{4}$/", expect: "escape with non-hex digits" },
  { id: "reader-accepts-vertical-tab", rule: "JSON whitespace is space, tab, line feed, and carriage return only", file: "src/json-text.ts",
    find: 'c === "\\r";', replace: 'c === "\\r" || c === "\\u000b";', expect: "reader refuses: a vertical tab as whitespace" },
  { id: "reader-accepts-bom", rule: "a byte-order mark is not whitespace", file: "src/json-text.ts",
    find: 'c === "\\r";', replace: 'c === "\\r" || c === "\\ufeff";', expect: "reader refuses: a byte-order mark as whitespace" },
  { id: "reader-depth-unbounded", rule: "nesting is limited to 128 levels", file: "src/json-text.ts",
    find: 'if (depth > MAX_TEXT_DEPTH) return fail("JSON text too deep");', replace: "", expect: "reader depth: 128 levels are read, 129 are refused" },
  { id: "reader-text-unbounded", rule: "the text is at most MAX_TEXT_CHARS", file: "src/json-text.ts",
    find: 'if (text.length > MAX_TEXT_CHARS) return fail("JSON text too long");', replace: "", expect: "reader bound: the largest valid child fits under the text cap" },
  { id: "reader-string-unbounded", rule: "a string is at most MAX_STRING_CHARS", file: "src/json-text.ts",
    find: 'if (out.length + (end - i) > MAX_STRING_CHARS) return fail("string too long");', replace: "",
    also: [{ file: "src/json-text.ts", find: '      if (out.length > MAX_STRING_CHARS) return fail("string too long");\n', replace: "" }],
    expect: "reader bound: a string longer than any accepted child holds" },
  { id: "reader-numbers-unchecked", rule: "number lexemes follow the verifier's jsonDecode", file: "src/json-text.ts",
    find: "    const t = jsonDecode(utf8(m[0]));\n", replace: '    const t = /[.eE]/.test(m[0]) ? { t: "float", v: Number(m[0]) } : { t: "int", v: Number(m[0]) };\n',
    expect: "reader numbers: refused exactly where" },
  { id: "values-unbounded-up-front", rule: "selector values are checked against the canonical-JSON bounds at the boundary", file: "src/boundary.ts",
    find: "  if (s.kind === \"equals\") jcsEncode(tagged(s.value));\n", replace: "", expect: "parity: a value at each canonical-JSON bound" },
  { id: "selector-not-grant-shaped", rule: "a child selector must be one a v2 grant can carry", file: "src/boundary.ts",
    find: "  v2.parseSelector(tagged(s as unknown as JsonValue));\n", replace: "", expect: "parity: a value at each canonical-JSON bound" },

  // ---- browser-safety guard (run against the guard test only) --------------------------------
  { id: "guard-node-import", rule: "src/ has no node: import", file: "src/bytes.ts",
    append: '\nimport "node:fs";\n', tests: ["test/guard.test.ts"], expect: "no node: specifier" },
  { id: "guard-buffer-identifier", rule: "src/ has no Buffer identifier", file: "src/bytes.ts",
    append: "\nexport const leak = Buffer.from([]);\n", tests: ["test/guard.test.ts"], expect: "no Buffer identifier" },
];

// The same glob `pnpm test` uses (test/*.test.ts), so no test file is outside the red-proof run.
const ALL_TESTS = readdirSync(at("test")).filter((f) => f.endsWith(".test.ts")).sort().map((f) => `test/${f}`);

function run(files) {
  const r = spawnSync(
    process.execPath,
    ["--test", "--test-reporter=tap", "--import", "tsx/esm", ...files.map(at)],
    { cwd: ROOT, encoding: "utf8", timeout: 300_000, maxBuffer: 256 * 1024 * 1024 },
  );
  const out = `${r.stdout}\n${r.stderr}`;
  const failed = [...out.matchAll(/^\s*not ok \d+ - (.*)$/gm)].map((m) => m[1]);
  const count = (key) => Number((out.match(new RegExp(`^# ${key} (\\d+)`, "m")) ?? [])[1] ?? Number.NaN);
  return { status: r.status, failed, tests: count("tests"), pass: count("pass"), fail: count("fail"), out };
}

const wanted = process.argv.slice(2);
const selected = wanted.length === 0 ? MUTATIONS : MUTATIONS.filter((m) => wanted.includes(m.id));
if (selected.length === 0) {
  console.error(`no mutation matches: ${wanted.join(", ")}`);
  process.exit(2);
}

const originals = new Map();
function restore() {
  for (const [file, bytes] of originals) writeFileSync(at(file), bytes);
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restore(); process.exit(130); });

let exitCode = 0;
try {
  const baseline = run(ALL_TESTS);
  console.log(`baseline: tests=${baseline.tests} pass=${baseline.pass} fail=${baseline.fail}`);
  if (baseline.status !== 0 || baseline.fail !== 0) {
    console.error("baseline is not green; red results would not be attributable to a mutation");
    console.error(baseline.failed.join("\n"));
    process.exit(1);
  }

  const rows = [];
  for (const m of selected) {
    const edits = [{ file: m.file, find: m.find, replace: m.replace, append: m.append }, ...(m.also ?? [])];
    const mutatedFiles = new Map();
    let broken = false;
    for (const e of edits) {
      if (!originals.has(e.file)) originals.set(e.file, readFileSync(at(e.file), "utf8"));
      const current = mutatedFiles.get(e.file) ?? originals.get(e.file);
      if (e.append !== undefined) {
        mutatedFiles.set(e.file, current + e.append);
        continue;
      }
      const occurrences = current.split(e.find).length - 1;
      if (occurrences !== 1) {
        console.error(`MUTATION ${m.id}: find text occurs ${occurrences} times in ${e.file}, expected 1`);
        broken = true;
        break;
      }
      mutatedFiles.set(e.file, current.replace(e.find, () => e.replace));
    }
    if (broken) {
      exitCode = 1;
      rows.push({ id: m.id, verdict: "BROKEN-MUTATION" });
      continue;
    }
    for (const [file, text] of mutatedFiles) writeFileSync(at(file), text);
    let result;
    try {
      result = run(m.tests ?? ALL_TESTS);
    } finally {
      for (const file of mutatedFiles.keys()) writeFileSync(at(file), originals.get(file));
    }
    const namedRed = result.failed.some((name) => name.includes(m.expect));
    const verdict = namedRed ? "RED (killed)" : result.failed.length > 0 ? "RED, BUT NOT THE NAMED TEST" : "SURVIVED";
    if (!namedRed) exitCode = 1;
    rows.push({ id: m.id, verdict });
    console.log(`\n[${m.id}] ${m.rule}`);
    console.log(`  verdict: ${verdict}   tests=${result.tests} fail=${result.fail}`);
    console.log(`  expected red: "${m.expect}"`);
    for (const name of result.failed.slice(0, 4)) console.log(`  not ok - ${name}`);
    if (result.failed.length > 4) console.log(`  ... and ${result.failed.length - 4} more failing`);
  }

  restore();
  const after = run(ALL_TESTS);
  console.log(`\nrestored: tests=${after.tests} pass=${after.pass} fail=${after.fail}`);
  if (after.status !== 0 || after.fail !== 0) exitCode = 1;

  const killed = rows.filter((r) => r.verdict === "RED (killed)").length;
  console.log(`\nsummary: ${killed}/${rows.length} mutations killed by their named test`);
} finally {
  restore();
}
process.exit(exitCode);
