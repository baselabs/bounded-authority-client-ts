// The JSON text reader behind childFromWireText. It follows the RFC 8259 grammar and adds only
// what the text alone can show: a duplicate member name is refused, and a number spelled with a
// fraction or an exponent becomes a WireFloat (integer fields refuse it; JSON values accept the
// number it denotes). Numbers follow the verifier's own decoder (jsonDecode): a lexeme it refuses
// (over 64 bytes, or beyond +/-(2^53 - 1)) is refused here.
//
// Size bounds, so that hostile text cannot exhaust memory:
// - MAX_TEXT_CHARS: the whole text, checked before anything is read. 4 MiB is 64 operations times
//   the decoder's 64 KiB per JSON document; the largest child the limits allow at every count
//   (64 audiences of 512 bytes, 64 operations of 64 selectors) fits with its values near 1 KB.
// - MAX_STRING_CHARS: one string, 8,192 characters (the selector-value string limit; every other
//   string a child holds is shorter, and a UTF-16 length never exceeds the UTF-8 byte length).
// - MAX_TEXT_DEPTH: 128 levels of nesting, which bounds the recursion; no accepted child is half
//   that deep.
import { fail, jsonDecode } from "@bounded-authority-protocol/verifier";
import { WireFloat } from "./boundary.js";
import { utf8 } from "./bytes.js";

export const MAX_TEXT_CHARS = 4_194_304;
export const MAX_STRING_CHARS = 8192;
export const MAX_TEXT_DEPTH = 128;

const NUMBER = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;
const ESCAPES: Readonly<Record<string, string>> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

const isSpace = (c: string | undefined): boolean => c === " " || c === "\t" || c === "\n" || c === "\r";

export function readJsonText(text: string): unknown {
  if (text.length > MAX_TEXT_CHARS) return fail("JSON text too long");
  let i = 0;

  const space = (): void => {
    while (i < text.length && isSpace(text[i])) i++;
  };

  const string = (): string => {
    i++; // the opening quote
    let out = "";
    for (;;) {
      // Copy the run up to the next quote, backslash, or control character in one slice.
      // The scan stops one character past the string limit, so a huge string is never walked.
      const limit = Math.min(text.length, i + (MAX_STRING_CHARS - out.length) + 1);
      let end = i;
      while (end < limit && text[end] !== '"' && text[end] !== "\\" && text[end]! >= " ") end++;
      if (out.length + (end - i) > MAX_STRING_CHARS) return fail("string too long");
      out += text.slice(i, end);
      i = end;
      if (i >= text.length) return fail("unterminated string");
      const c = text[i]!;
      if (c === '"') {
        i++;
        return out;
      }
      if (c !== "\\") return fail("control character in string");
      const e = text[i + 1];
      if (e === "u") {
        const hex = text.slice(i + 2, i + 6);
        if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return fail("bad unicode escape");
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
      } else if (e !== undefined && Object.hasOwn(ESCAPES, e)) {
        out += ESCAPES[e];
        i += 2;
      } else {
        return fail("bad escape");
      }
      if (out.length > MAX_STRING_CHARS) return fail("string too long");
    }
  };

  const number = (): unknown => {
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (m === null) return fail("unexpected character");
    i += m[0].length;
    // The verifier's decoder decides each lexeme: its 64-byte and magnitude limits apply.
    const t = jsonDecode(utf8(m[0]));
    if (t.t === "int") return t.v;
    if (t.t === "float") return new WireFloat(t.v);
    return fail("not a number");
  };

  const value = (depth: number): unknown => {
    if (depth > MAX_TEXT_DEPTH) return fail("JSON text too deep");
    space();
    const c = text[i];
    if (c === "{") {
      i++;
      const out: Record<string, unknown> = {};
      const seen = new Set<string>();
      space();
      if (text[i] === "}") {
        i++;
        return out;
      }
      for (;;) {
        space();
        if (text[i] !== '"') return fail("expected a member name");
        const name = string();
        if (seen.has(name)) return fail("duplicate member name");
        seen.add(name);
        space();
        if (text[i] !== ":") return fail("expected a colon");
        i++;
        // A data property even for "__proto__", as JSON.parse creates it.
        Object.defineProperty(out, name, { value: value(depth + 1), enumerable: true, writable: true, configurable: true });
        space();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          return out;
        }
        return fail("expected a comma or a closing brace");
      }
    }
    if (c === "[") {
      i++;
      const out: unknown[] = [];
      space();
      if (text[i] === "]") {
        i++;
        return out;
      }
      for (;;) {
        out.push(value(depth + 1));
        space();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return out;
        }
        return fail("expected a comma or a closing bracket");
      }
    }
    if (c === '"') return string();
    for (const [word, v] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return v;
      }
    }
    return number();
  };

  const result = value(1);
  space();
  if (i !== text.length) fail("trailing content after the JSON value");
  return result;
}
