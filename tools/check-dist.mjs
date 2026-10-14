#!/usr/bin/env node
// Runs the vectors against the BUILT package (dist/), the code a consumer receives, and checks
// that the build output stays browser-safe. Run `pnpm build` first.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { docSamples } from "./checked-files.mjs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(ROOT, "dist", "src");
const { childFromWire, childFromWireText, materializeChild, reauthorizationRequestDigest } = await import(
  pathToFileURL(join(dist, "index.js")).href
);

const raw = readFileSync(join(ROOT, "test", "vectors", "reauthorization-req2.json"));
const file = JSON.parse(raw.toString("utf8"));
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const problems = [];

for (const v of file.vectors) {
  const parsed = childFromWire(v.child);
  const fromText = childFromWireText(JSON.stringify(v.child));
  const p = file.parent;
  const m = parsed.ok
    ? materializeChild(parsed.value, {
        jti: p.jti, contractMajor: p.contract_major, holderThumbprint: p.holder_thumbprint,
        audiences: p.audiences, operations: p.operations, notBefore: p.not_before, expiresAt: p.expires_at,
      })
    : { ok: false };
  const d = m.ok
    ? reauthorizationRequestDigest({
        parent: { jti: p.jti, contractMajor: p.contract_major, holderThumbprint: p.holder_thumbprint },
        invocationId: v.invocation_id, consumerId: v.consumer_id, child: m.value,
      })
    : { ok: false };
  const good =
    d.ok && hex(d.value.projection) === v.projection_hex && d.value.requestSha256 === v.request_sha256 &&
    fromText.ok && JSON.stringify(fromText.value) === JSON.stringify(parsed.value);
  if (!good) problems.push(`vector ${v.name} does not match from dist/`);
}

// The shipped JavaScript must not reach for node: modules or Buffer.
for (const f of readdirSync(dist).filter((n) => n.endsWith(".js"))) {
  const text = readFileSync(join(dist, f), "utf8");
  if (/node:/.test(text)) problems.push(`dist/src/${f} contains a node: specifier`);
  if (/\bBuffer\b/.test(text)) problems.push(`dist/src/${f} names Buffer`);
}

// The guide's vectors sample, run the way docs/guides.md says: saved as vectors-check.ts in the root
// of the clone and run with `node`, so "@bounded-authority/client" resolves to dist/ by the
// package's own name.
const guide = docSamples(ROOT).filter((s) => s.doc === "docs/guides.md" && s.code.includes("test/vectors/reauthorization-req2.json"));
const script = join(ROOT, "vectors-check.ts");
if (guide.length !== 1) problems.push(`expected one vectors sample in docs/guides.md, found ${guide.length}`);
else if (existsSync(script)) problems.push("vectors-check.ts already exists in the clone; not overwriting it");
else {
  try {
    writeFileSync(script, guide[0].code);
    const r = spawnSync(process.execPath, ["vectors-check.ts"], { cwd: ROOT, encoding: "utf8" });
    const printed = r.stdout.split("\n").filter((l) => l !== "");
    const expected = [...guide[0].code.matchAll(/\/\/ prints: (.*)$/gm)].map((m) => m[1].trimEnd());
    if (r.status !== 0 || JSON.stringify(printed) !== JSON.stringify(expected)) {
      problems.push(`the guide's vectors sample printed ${JSON.stringify(printed)} (exit ${r.status}), its comments say ${JSON.stringify(expected)}\n${r.stderr}`);
    } else console.log(`guide vectors sample, run from the clone root: ${printed.join(" | ")}`);
  } finally {
    rmSync(script, { force: true });
  }
}

console.log(`vectors file sha256 ${createHash("sha256").update(raw).digest("hex")}; ${file.vectors.length} vectors run against dist/`);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("dist/: all vectors match; no node: or Buffer in the build output");
