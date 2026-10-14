// The guide's "From the parent grant to the digest" flow verifies the parent grant with the
// verifier's v2.verifyGrant before reading it with parentContextFromGrant. Run as written it prints
// the lte-child digest (test/docs.test.ts); run with a grant whose signature was altered, or that
// another key signed, it must stop before any digest is computed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { samplesOf } from "../tools/checked-files.mjs";
import { producedGrant } from "./grants.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const WORK = join(ROOT, "node_modules", ".cache", "doc-samples");
const SRC_ENTRY = pathToFileURL(join(ROOT, "src", "index.ts")).href;

const flow = samplesOf("docs/guides.md", readFileSync(join(ROOT, "docs", "guides.md"), "utf8")).filter((s) => s.code.includes("v2.verifyGrant"));

async function runFlowWith(grant: string, name: string): Promise<unknown> {
  const code = flow[0]!.code
    .replace(/const parentGrant = \[[\s\S]*?\]\.join\(""\);/, `const parentGrant = ${JSON.stringify(grant)};`)
    .split('from "@bounded-authority/client"')
    .join(`from "${SRC_ENTRY}"`);
  assert.ok(code.includes(JSON.stringify(grant)), "the grant was substituted");
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, `guide-verify-${name}.mts`);
  writeFileSync(file, code);
  const original = console.log;
  console.log = () => undefined;
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    console.log = original;
  }
}

const demoGrant = (): string => {
  const code = flow[0]!.code;
  const m = /const parentGrant = \[([\s\S]*?)\]\.join\(""\);/.exec(code);
  assert.ok(m, "the guide holds the demo grant");
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]).join("");
};

test("guide flow: there is exactly one sample that verifies the grant", () => {
  assert.equal(flow.length, 1);
  assert.ok(flow[0]!.code.indexOf("v2.verifyGrant") < flow[0]!.code.indexOf("parentContextFromGrant(parentGrant)"), "verify comes first");
});

test("guide flow: the demo grant runs to the end (known-positive)", async () => {
  await runFlowWith(demoGrant(), "demo");
});

test("guide flow: a grant with an altered signature is refused before any digest", async () => {
  const [h, p, s] = demoGrant().split(".");
  const forged = `${h}.${p}.${s!.slice(0, 10)}${s![10] === "A" ? "B" : "A"}${s!.slice(11)}`;
  await assert.rejects(runFlowWith(forged, "forged"), /the parent grant does not verify/);
});

test("guide flow: a grant whose payload was swapped under the old signature is refused", async () => {
  const [h, , s] = demoGrant().split(".");
  const other = producedGrant([{ name: "data.export", selectors: ["all"] }]).split(".")[1];
  await assert.rejects(runFlowWith(`${h}.${other}.${s}`, "swapped"), /the parent grant does not verify/);
});
