// The JSON text reader behind childFromWireText. It follows the RFC 8259 grammar and adds only
// what the text alone can show: a duplicate member name is refused, and a number spelled with a
// fraction or an exponent becomes a WireFloat (integer fields refuse it; JSON values accept the
// number it denotes). It has no whole-document size or node limit: the child parser applies the
// same limits to the result as it applies to an already-parsed child, so both entry points
// refuse the same inputs. Nesting deeper than MAX_TEXT_DEPTH is refused here only to bound the
// recursion; no child the parser accepts comes near it.
import { fail } from "@bounded-authority-protocol/verifier";
import { WireFloat } from "./boundary.js";

const MAX_TEXT_DEPTH = 128;
const NUMBER = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;
const ESCAPES: Readonly<Record<string, string>> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

export function readJsonText(text: string): unknown {
  let i = 0;

  const space = (): void => {
    while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i++;
  };

  const string = (): string => {
    i++; // the opening quote
    let out = "";
    for (;;) {
      if (i >= text.length) return fail("unterminated string");
      const c = text[i]!;
      if (c === '"') {
        i++;
        return out;
      }
      if (c < " ") return fail("control character in string");
      if (c !== "\\") {
        out += c;
        i++;
        continue;
      }
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
    }
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
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (m === null) return fail("unexpected character");
    i += m[0].length;
    const n = Number(m[0]);
    return m[1] === undefined && m[2] === undefined ? n : new WireFloat(n);
  };

  const result = value(0);
  space();
  if (i !== text.length) fail("trailing content after the JSON value");
  return result;
}
