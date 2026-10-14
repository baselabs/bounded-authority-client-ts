// The browser lane (pnpm test:browser): real engines through Playwright, the client bundled by
// esbuild for the browser (so the verifier's "#crypto" import resolves the way a browser bundler
// resolves it), the real vectors file (SHA-256 pinned at load), served by a node:http server on
// 127.0.0.1:0 that sends the strict CSP on every response. No jsdom, no mocks, no aliases or shims.
//
// BAP_BROWSERS selects engines (default "chromium"); CI runs chromium, firefox and webkit on Linux.
// BAP_CHROMIUM_EXECUTABLE points Playwright at a locally installed Chromium build when the bundled
// revision is not installed. Linux WebKit is evidence for this pure-JS code only, never for Safari.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, firefox, webkit, type BrowserType } from "playwright";
import { loadVectors, VECTORS_PATH, type VectorFile } from "../helpers.js";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
export const CSP = "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";
const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit };
const SELECTED = (process.env.BAP_BROWSERS ?? "chromium").split(",").filter(Boolean);

async function bundle(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [`${REPO}${entry}`], absWorkingDir: REPO, bundle: true, write: false, format: "esm",
    platform: "browser", target: "es2022", logLevel: "silent",
  });
  return result.outputFiles[0]!.text;
}

// The expected values the lane is held to are read from disk through the pinned loader. The tampered
// copy exists only in memory: one request_sha256 and one projection_hex each differ by one character.
const flip = (s: string): string => s.slice(0, -1) + (s.endsWith("0") ? "1" : "0");
function tamperedVectors(): { json: string; names: string[] } {
  const file = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as { vectors: { name: string; projection_hex: string; request_sha256: string }[] };
  const [a, b] = [file.vectors[0]!, file.vectors[1]!];
  a.request_sha256 = flip(a.request_sha256);
  b.projection_hex = flip(b.projection_hex);
  return { json: JSON.stringify(file), names: [a.name, b.name] };
}

interface Served { server: Server; origin: string; requests: string[] }

async function serve(): Promise<Served> {
  const app = await bundle("browser/main.ts");
  const probe = await bundle("browser/eval-probe.ts");
  loadVectors(); // asserts the pinned SHA-256 before a byte is served
  const vectors = readFileSync(VECTORS_PATH);
  const tampered = tamperedVectors().json;
  const index = readFileSync(`${REPO}browser/index.html`, "utf8");
  const probeHtml = '<!doctype html><html><head><meta charset="utf-8"><title>CSP probe</title><script type="module" src="/eval-probe.js"></script></head><body data-state="running"></body></html>';
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push(url.pathname);
    const send = (status: number, type: string, body: string | Uint8Array) => {
      res.writeHead(status, { "content-type": type, "content-security-policy": CSP, "cache-control": "no-store" });
      res.end(body);
    };
    if (url.pathname === "/") return send(200, "text/html; charset=utf-8", index);
    if (url.pathname === "/app.js") return send(200, "text/javascript; charset=utf-8", app);
    if (url.pathname === "/eval-probe.html") return send(200, "text/html; charset=utf-8", probeHtml);
    if (url.pathname === "/eval-probe.js") return send(200, "text/javascript; charset=utf-8", probe);
    if (url.pathname === "/vectors.json") return send(200, "application/json", vectors);
    if (url.pathname === "/vectors-tampered.json") return send(200, "application/json", tampered);
    return send(404, "text/plain", "not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, origin: `http://127.0.0.1:${address.port}`, requests };
}

// Page functions are passed as functions, never as strings: Playwright evaluates a string predicate
// with eval inside the page, which the strict CSP blocks (and reports as a violation).
const pageDone = () => (globalThis as unknown as { document: { body: { dataset: Record<string, string> } } }).document.body.dataset.state === "done";

interface Computed { name: string; projection_hex: string; request_sha256: string }
interface LaneResult {
  backend: string; secure: boolean; userAgent: string; violations: string[]; nodeGlobals: string[];
  error: string | null; failures: string[]; computed: Computed[]; totalMs: number;
}

async function withPage<T>(name: string, run: (served: Served, page: import("playwright").Page, version: string) => Promise<T>): Promise<T> {
  const engine = ENGINES[name]!;
  const served = await serve();
  const executablePath = name === "chromium" ? process.env.BAP_CHROMIUM_EXECUTABLE : undefined;
  // A launch failure (a missing browser build, say) must not leave the server listening: an open
  // server keeps the process alive, so the lane would hang instead of failing.
  const browser = await engine.launch(executablePath ? { executablePath } : {}).catch((e: unknown) => {
    served.server.close();
    throw e;
  });
  try {
    return await run(served, await browser.newPage(), browser.version());
  } finally {
    try {
      await browser.close();
    } finally {
      served.server.close(); // even if closing the browser throws
    }
  }
}

const laneResult = (page: import("playwright").Page) =>
  page.evaluate(() => (globalThis as unknown as { __LANE_RESULT__: unknown }).__LANE_RESULT__) as Promise<LaneResult>;

const expected: VectorFile = loadVectors();

for (const name of SELECTED) {
  assert.ok(ENGINES[name], `known engine ${name}`);

  test(`${name}: BACKEND_ID portable in a secure context under the strict CSP, and every vector matches exactly`, async (t) => {
    await withPage(name, async (served, page, version) => {
      const response = await page.goto(`${served.origin}/`);
      assert.equal(response?.headers()["content-security-policy"], CSP, "the page is served under the strict CSP");
      await page.waitForFunction(pageDone, undefined, { timeout: 120_000 });
      const result = await laneResult(page);
      assert.equal(result.error, null);
      assert.equal(result.backend, "portable");
      assert.equal(result.secure, true);
      assert.deepEqual(result.nodeGlobals, [], "the bundle needed no Node global");
      assert.deepEqual(result.violations, [], "no CSP violation while computing");
      assert.deepEqual(result.failures, [], "the page found no mismatch");
      assert.equal(expected.vectors.length, 17);
      // The comparison is repeated here, outside the page, against the pinned file read from disk.
      assert.deepEqual(
        result.computed,
        expected.vectors.map((v) => ({ name: v.name, projection_hex: v.projection_hex, request_sha256: v.request_sha256 })),
      );
      t.diagnostic(`${name} ${version} (${result.userAgent}): ${result.computed.length} vectors, projection hex and request_sha256 exact; ${result.totalMs} ms`);
    });
  });

  test(`${name}: red-proof: a page expecting the wrong backend runs no vector`, async () => {
    await withPage(name, async (served, page) => {
      await page.goto(`${served.origin}/?expect=node`);
      await page.waitForFunction(pageDone, undefined, { timeout: 60_000 });
      const result = await laneResult(page);
      assert.match(result.error ?? "", /BACKEND_ID is "portable", this lane expects "node"; no vector was run/);
      assert.deepEqual(result.computed, []);
      assert.ok(!served.requests.includes("/vectors.json"), "no vectors file was fetched");
    });
  });

  test(`${name}: red-proof: a tampered expected hash and a tampered expected projection are reported`, async () => {
    const { names } = tamperedVectors();
    await withPage(name, async (served, page) => {
      await page.goto(`${served.origin}/?vectors=/vectors-tampered.json`);
      await page.waitForFunction(pageDone, undefined, { timeout: 120_000 });
      const result = await laneResult(page);
      assert.equal(result.error, null);
      assert.deepEqual(result.failures, [`${names[0]}: request_sha256 differs`, `${names[1]}: projection_hex differs`]);
      // The computed values are still the true ones: only the expectations were altered.
      assert.deepEqual(result.computed.map((c) => c.request_sha256), expected.vectors.map((v) => v.request_sha256));
    });
  });

  test(`${name}: red-proof: eval is blocked by the served CSP and the securitypolicyviolation listener records it`, async () => {
    await withPage(name, async (served, page) => {
      await page.goto(`${served.origin}/eval-probe.html`);
      await page.waitForFunction(pageDone, undefined, { timeout: 60_000 });
      const probe = await page.evaluate(() => (globalThis as unknown as { __PROBE__: unknown }).__PROBE__) as { evalBlocked: boolean; violations: string[] };
      assert.equal(probe.evalBlocked, true);
      assert.ok(probe.violations.some((v) => v.startsWith("script-src")), JSON.stringify(probe.violations));
    });
  });
}
