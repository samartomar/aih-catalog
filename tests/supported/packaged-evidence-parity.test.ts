import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJsonV1, sha256HexV1 } from "../../src/production/strict-json-v1.js";
import { parsePackagedScannerCollectionEvidenceV1 } from "../../src/production/workbench/packaged-evidence-v1.js";

// Decision D25: Catalog's reader applies exactly Core's structural validation to a packaged
// collection evidence record and never admits one; publisher admission is Core's alone. The
// fixtures are shared byte-identically with Core (see the README beside them).

type Outcome = "accepted" | "refused";
interface Fixture {
  readonly fixture: string;
  readonly structure: Outcome;
  readonly coreAdmission: Outcome;
  readonly record: unknown;
}

const directory = resolve(import.meta.dirname, "..", "fixtures", "packaged-evidence-parity");
const fixtures = readdirSync(directory)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")) as Fixture);

const TIMESTAMP = /requires an exact UTC timestamp|is invalid/;
/** Catalog's structural outcome for every shared case, the defect a refusal must name, and Core's admission. */
const EXPECTED: Record<string, readonly [Outcome, Outcome, RegExp?]> = {
  "asset-bound-twice": ["refused", "refused", /coverage asset bound twice/],
  "publication-other-ref": ["accepted", "refused"],
  "publication-unreviewed-commit": ["accepted", "refused"],
  "subject-and-subjects": ["refused", "refused", /component 0 has unsupported field subject/],
  "subject-missing": ["refused", "refused", /component 0 is missing subject/],
  subjects: ["accepted", "accepted"],
  "subjects-duplicate-asset": ["refused", "refused", /coverage asset bound twice/],
  "subjects-empty": ["accepted", "accepted"],
  "subjects-unsorted": ["refused", "refused", /coverage subjects out of order/],
  "timestamp-expires-with-offset": ["refused", "refused", TIMESTAMP],
  "timestamp-prepared-hour-24": ["refused", "refused", TIMESTAMP],
  "timestamp-prepared-impossible-date": ["refused", "refused", TIMESTAMP],
  "timestamp-prepared-lowercase": ["refused", "refused", TIMESTAMP],
  "timestamp-prepared-one-fraction-digit": ["refused", "refused", TIMESTAMP],
  "timestamp-published-six-fraction-digits": ["refused", "refused", TIMESTAMP],
  "timestamp-signed-without-seconds": ["refused", "refused", TIMESTAMP],
  "timestamp-whole-seconds": ["accepted", "accepted"],
  valid: ["accepted", "accepted"],
};

function read(record: unknown): unknown {
  const bytes = canonicalJsonV1(record);
  return parsePackagedScannerCollectionEvidenceV1([
    { bytes, sha256: `sha256:${sha256HexV1(bytes)}` },
  ]);
}

describe("packaged collection evidence parity with Core", () => {
  it("holds exactly the shared cases", () => {
    expect(fixtures.map((item) => item.fixture).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(fixtures.map((item) => [item.fixture, item] as const))("%s", (name, fixture) => {
    const [structure, admission, reason] = EXPECTED[name] ?? [];
    expect([fixture.structure, fixture.coreAdmission]).toEqual([structure, admission]);
    if (structure === "accepted") {
      expect(read(fixture.record)).toHaveLength(1);
      return;
    }
    expect(() => read(fixture.record)).toThrow(reason);
  });
});
