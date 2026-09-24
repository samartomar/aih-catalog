import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  policyAuthoringCatalogV1,
  readPolicyAuthoringCatalogInputsV1,
} from "../../src/production/catalog/policy-authoring-catalog-v1.js";
import { canonicalDigestV1 } from "../../src/production/strict-json-v1.js";

const root = resolve(import.meta.dirname, "..", "..");
const scratch: string[] = [];

/** A disposable copy of the production inputs, so a test can corrupt one. */
function copyOfInputs(): string {
  const copy = mkdtempSync(join(tmpdir(), "aih-catalog-inputs-"));
  scratch.push(copy);
  cpSync(resolve(root, "src", "production", "data"), join(copy, "src", "production", "data"), {
    recursive: true,
  });
  return copy;
}

function editJson(copy: string, file: string, edit: (value: Record<string, unknown>) => void) {
  const path = join(copy, "src", "production", "data", file);
  const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  edit(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("policy authoring catalog generator", () => {
  it("reproduces the catalog digest the published authoring bundle admitted", () => {
    const published = JSON.parse(
      readFileSync(resolve(root, "defaults", "catalog-authoring-bundle-v1.json"), "utf8"),
    ) as { production: { admission: { catalogDigest: string } } };
    const catalog = policyAuthoringCatalogV1(readPolicyAuthoringCatalogInputsV1(root));
    expect(canonicalDigestV1(catalog)).toBe(published.production.admission.catalogDigest);
    expect(catalog.frameworks.map((framework) => framework.assets.length)).toEqual([442, 15]);
  });

  it("refuses a fetched input whose bytes differ from the recorded sha256", () => {
    const copy = copyOfInputs();
    editJson(copy, "ecc-profiles-v1.json", (value) => {
      value.schemaVersion = 1;
    });
    const path = join(copy, "src", "production", "data", "ecc-profiles-v1.json");
    writeFileSync(path, `${readFileSync(path, "utf8")} `);
    expect(() => readPolicyAuthoringCatalogInputsV1(copy)).toThrow(/recorded sha256/u);
  });

  it("refuses upstream inputs fetched at a commit other than the vetted pin", () => {
    const copy = copyOfInputs();
    editJson(copy, "upstream-inputs-v1.json", (value) => {
      const files = value.files as Record<string, { commit: string }>;
      (files["ecc-modules-v1.json"] as { commit: string }).commit = "0".repeat(40);
    });
    const inputs = readPolicyAuthoringCatalogInputsV1(copy);
    expect(() => policyAuthoringCatalogV1(inputs)).toThrow(/not fetched at the vetted pin/u);
  });

  it("refuses Core product declarations that declare a third-party hook entry", () => {
    const copy = copyOfInputs();
    editJson(copy, "core-product-declarations-v1.json", (value) => {
      const registry = value.hookRegistry as { entries: { owner: string }[] };
      (registry.entries[0] as { owner: string }).owner = "third-party";
    });
    expect(() => readPolicyAuthoringCatalogInputsV1(copy)).toThrow(/AIH-owned entries/u);
  });
});
