import { describe, expect, it } from "vitest";
import { parseJsonTextRejectingDuplicateKeysV1 } from "../../src/production/strict-json-v1.js";
import { parseYamlFrontmatterV1 } from "../../src/production/yaml-frontmatter-v1.js";

const parse = (text: string) => parseJsonTextRejectingDuplicateKeysV1(text, "sample");

describe("the duplicate-key-rejecting JSON reader", () => {
  it.each([
    ['{"a":1,"b":[true,false,null,"x\\u00e9\\n\\"",-1.5e3,{"c":{}}]}'],
    ["[]"],
    ['"text"'],
    ['  {\n\t"a" : 0.25 }\r\n'],
    ['{"":1,"\\"":2}'],
  ])("reads %s as JSON.parse does", (text) => {
    expect(parse(text)).toEqual(JSON.parse(text));
  });

  it.each([
    ['{"a":1,"a":2}'],
    ['{"a":{"b":1,"b":1}}'],
    ['[{"x":1},{"y":1,"y":2}]'],
    ['{"a":1,"\\u0061":2}'],
    ['{"__proto__":1,"__proto__":2}'],
  ])("refuses a duplicate key in %s", (text) => {
    expect(() => parse(text)).toThrow(/sample.*duplicate key/u);
  });

  it("keeps __proto__, constructor and prototype as own data keys", () => {
    const value = parse('{"__proto__":{"polluted":true},"constructor":1,"prototype":2}') as Record<
      string,
      unknown
    >;
    expect(Object.keys(value)).toEqual(["__proto__", "constructor", "prototype"]);
    expect(Object.hasOwn(value, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  });

  it.each([
    ["{"],
    ['{"a":1,}'],
    ["[1,]"],
    ["{'a':1}"],
    ['{"a":01}'],
    ['{"a":1} x'],
    ['"\u0001"'],
    ["NaN"],
    [""],
  ])("refuses malformed JSON %s", (text) => {
    expect(() => parse(text)).toThrow(/sample/u);
  });
});

describe("the YAML frontmatter reader's mappings", () => {
  it.each([
    ["__proto__"],
    ["constructor"],
    ["prototype"],
  ])("keeps a %s key as an own data key", (key) => {
    const value = parseYamlFrontmatterV1(`name: a\n${key}: null\n`, "sample");
    expect(Object.keys(value)).toEqual(["name", key]);
    expect(Object.hasOwn(value, key)).toBe(true);
  });

  it("refuses a duplicate __proto__ key", () => {
    expect(() => parseYamlFrontmatterV1("__proto__: a\n__proto__: b\n", "sample")).toThrow(
      /duplicate key __proto__/u,
    );
  });
});
