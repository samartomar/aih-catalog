import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { CORE_NATIVE_CLIENT_IDS, clientAdapterProblems } from "../../src/release/client-ids.js";
import { readRelease } from "../../src/release/reader.js";
import { fixtureRelease, type Json, releaseBytes, sha256 } from "./fixtures.js";

const root = resolve(import.meta.dirname, "../..");
const schema = JSON.parse(readFileSync(resolve(root, "schemas/release/1.4.0.json"), "utf8"));
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
const FORMAT = "urn:aihq:catalog:release:1.4.0";

type Item = { [key: string]: Json };
const read = (value: unknown) => {
  const bytes = releaseBytes(value);
  return readRelease(bytes, { expectedSha256: sha256(bytes) });
};
const reasons = (value: unknown) => {
  const result = read(value);
  return result.valid ? [] : result.diagnostics.map((d) => `${d.reason}@${d.path}`);
};
/** Release 1.4 whose first item is a client adapter carrying `clientId`. */
const release = (schemaId = FORMAT, mutate: (adapter: Item, other: Item) => void = () => {}) => {
  const value = fixtureRelease();
  value.schema = schemaId;
  const [adapter, other] = value.items as [Item, Item];
  adapter.kind = "client-adapter";
  adapter.clientId = "codex";
  mutate(adapter, other);
  return value;
};

const withClientId = (clientId: Json) =>
  release(FORMAT, (adapter) => {
    adapter.clientId = clientId;
  });

describe("release 1.4 clientId", () => {
  it("is accepted for a client-adapter item by the schema and the reader", () => {
    const value = release();
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
    const result = read(value);
    expect(result.valid, JSON.stringify(result.diagnostics)).toBe(true);
    if (result.valid) expect(result.release.items[0]?.clientId).toBe("codex");
  });

  it("is carried through the item digest and the item view", () => {
    const withId = read(release());
    const plain = fixtureRelease();
    plain.schema = FORMAT;
    const base = read(plain);
    expect(base.valid).toBe(true);
    if (withId.valid && base.valid) {
      expect(withId.release.items[0]?.itemSha256).not.toBe(base.release.items[0]?.itemSha256);
    }
  });

  it("refuses a client-adapter item without clientId", () => {
    const value = release(FORMAT, (adapter) => void delete adapter.clientId);
    expect(validate(value)).toBe(false);
    expect(reasons(value)).toContain("missing-field@/items/0/clientId");
  });

  it.each([
    "Codex",
    "",
    "-x",
    "9x",
    "a_b",
    "a".repeat(65),
    7,
    null,
    ["codex"],
  ])("refuses malformed clientId %j", (bad) => {
    const value = withClientId(bad as Json);
    expect(validate(value)).toBe(false);
    expect(reasons(value)).toContain("invalid-client-id@/items/0/clientId");
  });

  it("admits the longest well-formed clientId", () => {
    const value = withClientId(`a${"b".repeat(63)}`);
    expect(validate(value)).toBe(true);
    expect(read(value).valid).toBe(true);
  });

  it("refuses clientId on a non-adapter item", () => {
    const value = release(FORMAT, (adapter, other) => {
      adapter.kind = "skill";
      other.clientId = "codex";
    });
    expect(validate(value)).toBe(false);
    expect(reasons(value)).toContain("unexpected-client-id@/items/0/clientId");
    expect(reasons(value)).toContain("unexpected-client-id@/items/1/clientId");
  });

  it.each(["1.0.0", "1.1.0", "1.2.0", "1.3.0"])("is an unknown field in a %s document", (v) => {
    const value = release(`urn:aihq:catalog:release:${v}`);
    expect(reasons(value)).toContain("unknown-field@/items/0/clientId");
  });

  it("reads form only: an unknown but well-formed id is accepted, then refused by the known-set check", () => {
    const value = withClientId("not-a-core-client");
    expect(validate(value)).toBe(true);
    const result = read(value);
    expect(result.valid, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.valid) return;
    expect(clientAdapterProblems(result.release.items)).toEqual([
      { reason: "unknown-client-id", itemId: "alpha", clientId: "not-a-core-client" },
    ]);
  });
});

describe("release 1.4 local origins", () => {
  it("keeps the pinned local snapshot origin valid under release 1.4", () => {
    const value = release();
    value.sources = [{ id: "upstream", origin: { kind: "local", revision: "a".repeat(40) } }];
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
    const result = read(value);
    expect(result.valid, JSON.stringify(result.diagnostics)).toBe(true);
  });
});

describe("committed release", () => {
  const bytes = readFileSync(resolve(root, "release/release.json"));
  const committed = readRelease(bytes, { expectedSha256: sha256(bytes) });
  const CLIENTS = [...CORE_NATIVE_CLIENT_IDS];

  it("is release 1.4 and validates against the published schema", () => {
    expect(validate(JSON.parse(bytes.toString("utf8"))), JSON.stringify(validate.errors)).toBe(
      true,
    );
    expect(committed.valid).toBe(true);
    if (committed.valid) expect(committed.release.schema).toBe(FORMAT);
  });

  it("declares every client-adapter's client as the suffix of its unchanged item id", () => {
    if (!committed.valid) throw new Error("committed release is invalid");
    const adapters = committed.release.items.filter((item) => item.kind === "client-adapter");
    expect(adapters.map((item) => item.id)).toEqual(CLIENTS.map((id) => `aihq.client.${id}`));
    for (const item of adapters) expect(item.clientId).toBe(item.id.replace("aihq.client.", ""));
    expect(clientAdapterProblems(committed.release.items)).toEqual([]);
  });

  it("carries clientId on no other kind", () => {
    if (!committed.valid) throw new Error("committed release is invalid");
    const others = committed.release.items.filter((item) => item.kind !== "client-adapter");
    expect(others.length).toBeGreaterThan(0);
    expect(others.filter((item) => item.clientId !== undefined)).toEqual([]);
  });
});
