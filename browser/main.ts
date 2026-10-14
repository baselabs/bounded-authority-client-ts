// The browser lane page. Runs in a real engine under the strict CSP the test server sends, with the
// client bundled by esbuild for the browser, so the verifier's "#crypto" import resolves the way a
// browser bundler resolves it (the portable backend). The page asserts BACKEND_ID and isSecureContext
// BEFORE any vector runs, records every securitypolicyviolation, runs every vector through
// childFromWire, materializeChild and reauthorizationRequestDigest, compares projection hex and
// request_sha256 to the expected values, and publishes one result object for the Playwright test.
import { BACKEND_ID } from "@bounded-authority-protocol/verifier";
import { childFromWire, materializeChild, reauthorizationRequestDigest } from "../src/index.js";

interface Vector {
  name: string; consumer_id: string; invocation_id: string; child: unknown; projection_hex: string; request_sha256: string;
}
interface VectorFile {
  parent: {
    jti: string; contract_major: number; holder_thumbprint: string; audiences: string[]; operations: unknown;
    not_before: number; expires_at: number;
  };
  vectors: Vector[];
}
interface Computed { name: string; projection_hex: string; request_sha256: string }
interface LaneResult {
  backend: string; secure: boolean; userAgent: string; violations: string[]; nodeGlobals: string[];
  error: string | null; failures: string[]; computed: Computed[]; totalMs: number;
}

const violations: string[] = [];
document.addEventListener("securitypolicyviolation", (e) => violations.push(`${e.violatedDirective} ${e.blockedURI}`));

const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function publish(result: LaneResult): void {
  (window as unknown as { __LANE_RESULT__: LaneResult }).__LANE_RESULT__ = result;
  document.getElementById("out")!.textContent = JSON.stringify({ ...result, computed: result.computed.length }, null, 2);
  document.body.dataset.state = "done";
}

// Node-only globals the bundle must never have needed: their absence is part of the evidence.
const nodeGlobals = (): string[] => ["Buffer", "process", "require", "global"].filter((n) => n in globalThis);

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const expected = params.get("expect") ?? "portable";
  const vectorsPath = params.get("vectors") ?? "/vectors.json";
  const result: LaneResult = {
    backend: BACKEND_ID, secure: isSecureContext, userAgent: navigator.userAgent, violations, nodeGlobals: nodeGlobals(),
    error: null, failures: [], computed: [], totalMs: 0,
  };
  if (BACKEND_ID !== expected) {
    publish({ ...result, error: `BACKEND_ID is "${BACKEND_ID}", this lane expects "${expected}"; no vector was run` });
    return;
  }
  if (!isSecureContext) {
    publish({ ...result, error: "not a secure context; no vector was run" });
    return;
  }
  const start = performance.now();
  const response = await fetch(vectorsPath);
  if (!response.ok) throw new Error(`vectors fetch failed: ${response.status}`);
  const file = (await response.json()) as VectorFile;

  for (const vector of file.vectors) {
    const parsed = childFromWire(vector.child);
    if (!parsed.ok) { result.failures.push(`${vector.name}: the child did not parse`); continue; }
    const materialized = materializeChild(parsed.value, {
      jti: file.parent.jti,
      contractMajor: file.parent.contract_major,
      holderThumbprint: file.parent.holder_thumbprint,
      audiences: file.parent.audiences,
      operations: file.parent.operations as never,
      notBefore: file.parent.not_before,
      expiresAt: file.parent.expires_at,
    });
    if (!materialized.ok) { result.failures.push(`${vector.name}: the child did not materialize`); continue; }
    const digest = reauthorizationRequestDigest({
      parent: { jti: file.parent.jti, contractMajor: file.parent.contract_major, holderThumbprint: file.parent.holder_thumbprint },
      invocationId: vector.invocation_id,
      consumerId: vector.consumer_id,
      child: materialized.value,
    });
    if (!digest.ok) { result.failures.push(`${vector.name}: the digest was refused`); continue; }
    const computed = { name: vector.name, projection_hex: toHex(digest.value.projection), request_sha256: digest.value.requestSha256 };
    result.computed.push(computed);
    if (computed.projection_hex !== vector.projection_hex) result.failures.push(`${vector.name}: projection_hex differs`);
    if (computed.request_sha256 !== vector.request_sha256) result.failures.push(`${vector.name}: request_sha256 differs`);
  }
  result.totalMs = Math.round(performance.now() - start);
  publish(result);
}

main().catch((e: unknown) =>
  publish({ backend: BACKEND_ID, secure: isSecureContext, userAgent: navigator.userAgent, violations, nodeGlobals: nodeGlobals(), error: String(e), failures: [], computed: [], totalMs: 0 }),
);
