#!/usr/bin/env node
// Runs the vectors against the BUILT package (dist/), the code a consumer receives, and checks
// that the build output stays browser-safe. Run `pnpm build` first.
import { readFileSync, readdirSync } from "node:fs";
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

console.log(`vectors file sha256 ${createHash("sha256").update(raw).digest("hex")}; ${file.vectors.length} vectors run against dist/`);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("dist/: all vectors match; no node: or Buffer in the build output");
