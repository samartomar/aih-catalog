import { describe, expect, it } from "vitest";
import { parseStrictJsonObjectV1 } from "../../src/production/strict-json-v1.js";

// Catalog's dependency-free copy of Core's strict JSON reader (decision D25). The packaged
// evidence parity fixtures pin it on records; these pin the grammar itself.

const read = (text: string) => parseStrictJsonObjectV1(text, "fixture");

describe("strict JSON reader", () => {
  it.each([
    [
      "an object with JSON whitespace",
      ' {"a" : [1, -0.5e2, true, false, null, "x\\u00e9\\n"]}\r\n',
    ],
    ["nested objects", '{"a":{"b":{"c":[{}]}}}'],
    ["a raw DEL and line separator in a string", '{"a":"\u007f\u2028"}'],
  ])("reads %s as JSON.parse does", (_label, text) => {
    expect(read(text)).toEqual(JSON.parse(text));
  });

  it.each([
    ["a byte order mark", '\ufeff{"a":1}', /invalid JSON/],
    ["non-JSON whitespace", '{"a":1\u00a0}', /invalid JSON/],
    ["trailing data", '{"a":1}{}', /invalid JSON/],
    ["a trailing comma", '{"a":1,}', /invalid JSON/],
    ["a comment", '{"a":1 /* c */}', /invalid JSON/],
    ["a leading zero", '{"a":01}', /invalid JSON/],
    ["a bare fraction point", '{"a":1.}', /invalid JSON/],
    ["a raw control character in a string", '{"a":"\t"}', /invalid JSON/],
    ["an unknown escape", '{"a":"\\x"}', /invalid JSON/],
    ["a non-object root", "[1]", /invalid JSON/],
    ["a duplicate key", '{"a":1,"\\u0061":2}', /duplicate JSON object key: a/],
    ["a __proto__ member", '{"a":{"__proto__":"x"}}', /unsupported field __proto__/],
    ["an overflowing number", '{"a":1e400}', /numbers must be finite/],
    ["negative zero", '{"a":-0}', /not negative zero/],
    ["an escaped non-NFC string", '{"a":"e\\u0301"}', /must already be NFC/],
    ["an escaped lone surrogate", '{"a":"\\udc00"}', /lone low surrogate/],
    ["a raw lone surrogate", '{"a":"\ud800"}', /lone high surrogate/],
    ["a non-NFC key", '{"e\u0301":1}', /must already be NFC/],
  ])("refuses %s", (_label, text, reason) => {
    expect(() => read(text)).toThrow(reason);
  });

  it.each([
    ["arrays", `{"x":${"[".repeat(100_000)}0${"]".repeat(100_000)}}`],
    ["objects", `${'{"a":'.repeat(100_000)}0${"}".repeat(100_000)}`],
    ["an unterminated nest", `{"x":${"[".repeat(100_000)}`],
    ["33 levels", `{"x":${"[".repeat(32)}${"]".repeat(32)}}`],
  ])("refuses %s nested past 32 levels as a TypeError, before recursing", (_label, text) => {
    expect(() => read(text)).toThrow(TypeError);
    expect(() => read(text)).toThrow(/nests deeper than 32 levels/);
  });

  it("reads 32 levels, with brackets inside strings not counted", () => {
    const text = `{"s":"[[[{{{\\"","x":${"[".repeat(31)}${"]".repeat(31)}}`;
    expect(read(text)).toEqual(JSON.parse(text));
  });
});
