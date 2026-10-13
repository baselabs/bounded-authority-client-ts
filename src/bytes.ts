import { fail } from "@bounded-authority-protocol/verifier";

const encoder = new TextEncoder();

export const utf8 = (s: string): Uint8Array => encoder.encode(s);

/** U32(n): an unsigned, four-byte, big-endian integer. */
export function u32(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) fail("length does not fit U32");
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, false);
  return out;
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** F(b) = U32(byte_length(b)) || b */
export const frame = (b: Uint8Array): Uint8Array => concat([u32(b.length), b]);

/** L(items) = U32(item_count) || F(item_1) || ... || F(item_n) */
export const list = (items: readonly Uint8Array[]): Uint8Array => concat([u32(items.length), ...items.map(frame)]);

/** Lexicographic comparison of raw bytes; a proper prefix sorts first. */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    if (x !== y) return x < y ? -1 : 1;
  }
  return a.length - b.length;
}

const key = (b: Uint8Array): string => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return s;
};

/** Ascending by raw bytes. */
export const sort = (items: readonly Uint8Array[]): Uint8Array[] => [...items].sort(compareBytes);

/** Keeps the first of each byte-identical run of items, in the given order. */
export function unique(items: readonly Uint8Array[]): Uint8Array[] {
  const seen = new Set<string>();
  const out: Uint8Array[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
