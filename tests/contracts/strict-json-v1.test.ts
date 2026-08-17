import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertSafeRelativePosixPathV1,
  assertStrictJsonValueV1,
  canonicalStrictJsonBytesV1,
  canonicalStrictJsonSha256V1,
  deepFreezeStrictJsonV1,
  parseStrictJsonObjectV1,
  parseStrictJsonUtf8ObjectV1,
} from "../../src/contract/strict-json-v1.js";

describe("supported strict JSON v1", () => {
  it("parses strict object JSON and rejects decoded or nested duplicate keys", () => {
    expect(parseStrictJsonObjectV1('{"alpha":{"beta":true}}', "fixture")).toEqual({
      alpha: { beta: true },
    });
    for (const text of [
      "[]",
      '{"key":1,"\\u006bey":2}',
      '{"outer":{"key":1,"\\u006bey":2}}',
      '{"alpha":1,}',
      '{/* comment */"alpha":1}',
    ])
      expect(() => parseStrictJsonObjectV1(text, "fixture"), text).toThrow();
  });

  it("rejects malformed UTF-8 text, malformed/non-NFC Unicode, and noncanonical JSON", () => {
    for (const text of [
      "\ud800",
      "\udc00",
      "re\u0300gle",
      '{"value":"\\ud800"}',
      '{"value":"re\u0300gle"}',
    ])
      expect(() => parseStrictJsonObjectV1(text, "fixture"), JSON.stringify(text)).toThrow();

    for (const value of [
      { key: "re\u0300gle" },
      { "re\u0300gle": "value" },
      { key: "\ud800" },
      { key: "\udc00" },
      { key: "\udc00\ud800" },
      { numeric: -0 },
      { numeric: Number.NaN },
      { numeric: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => canonicalStrictJsonBytesV1(value)).toThrow();
      expect(() => canonicalStrictJsonSha256V1(value)).toThrow();
    }
    expect(() => parseStrictJsonUtf8ObjectV1(Buffer.from([0xc3, 0x28]), "fixture")).toThrow(
      /UTF-8|Unicode/i,
    );
  });

  it("accepts only own enumerable JSON data and deep freezes it", () => {
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "value", { enumerable: true, get: () => true });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const sparse = ["present"] as unknown[];
    sparse.length = 2;
    const arrayWithExtra = ["value"] as unknown as Record<string, unknown>;
    arrayWithExtra.extra = true;
    const symbol = { value: true };
    Object.defineProperty(symbol, Symbol("hidden"), { enumerable: true, value: true });
    const toJson = { value: true, toJSON: () => ({ value: false }) };
    for (const value of [new Date(), accessor, cycle, sparse, arrayWithExtra, symbol, toJson])
      expect(() => assertStrictJsonValueV1(value, "fixture")).toThrow();

    const frozen = deepFreezeStrictJsonV1({ nested: { values: ["one"] } });
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.nested)).toBe(true);
    expect(Object.isFrozen(frozen.nested.values)).toBe(true);
  });

  it("uses deterministic RFC8785/JCS UTF-8 bytes and lowercase SHA-256", () => {
    const left = { z: [3, 2, 1], a: { beta: true, alpha: "value" } };
    const right = { a: { alpha: "value", beta: true }, z: [3, 2, 1] };
    const bytes = canonicalStrictJsonBytesV1(left);
    expect(bytes).toEqual(canonicalStrictJsonBytesV1(right));
    expect(bytes.toString("utf8")).toBe('{"a":{"alpha":"value","beta":true},"z":[3,2,1]}');
    expect(canonicalStrictJsonSha256V1(left)).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(canonicalStrictJsonSha256V1(left)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts only safe NFC relative POSIX paths", () => {
    expect(assertSafeRelativePosixPathV1("catalog/😀/règle.json", "path")).toBe(
      "catalog/😀/règle.json",
    );
    for (const path of [
      "",
      "/absolute",
      "//host/share",
      "C:/drive",
      "C:relative",
      "\\\\host\\share",
      "./relative",
      ".",
      "one/./two",
      "one//two",
      "one/",
      "one/../two",
      "../one",
      "one\\two",
      "one%2ftwo",
      "one?query",
      "one#fragment",
      "one:colon",
      "file://one",
      "one\u0000two",
      "one\u001ftwo",
      "catalog/re\u0300gle.json",
    ])
      expect(() => assertSafeRelativePosixPathV1(path, "path"), path).toThrow();
  });
});
