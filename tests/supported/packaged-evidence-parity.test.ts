import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJsonV1, sha256HexV1 } from "../../src/production/strict-json-v1.js";
import { parsePackagedScannerCollectionEvidenceV1 } from "../../src/production/workbench/packaged-evidence-v1.js";

// Decision D25: Catalog's reader applies exactly Core's structural validation to a packaged
// collection evidence record and never admits one; publisher admission is Core's alone. The
// fixtures are shared byte-identically with Core (see the README beside them).

type Outcome = "accepted" | "refused";
/** A fixture carries a `record` value (sealed here as its canonical bytes) or its exact `bytes`. */
interface Fixture {
  readonly fixture: string;
  readonly structure: Outcome;
  readonly coreAdmission: Outcome;
  readonly record?: unknown;
  readonly bytes?: string;
}

const directory = resolve(import.meta.dirname, "..", "fixtures", "packaged-evidence-parity");
const fixtures = readdirSync(directory)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")) as Fixture);

const TIMESTAMP = /requires an exact UTC timestamp|is invalid/;
const UNTRIMMED = /must be a trimmed string/;
const NOT_NFC = /must already be NFC/;
const LONE_SURROGATE = /lone high surrogate/;
const NOT_CANONICAL = /must use canonical bytes/;
/** Catalog's structural outcome for every shared case, the defect a refusal must name, and Core's admission. */
const EXPECTED: Record<string, readonly [Outcome, Outcome, RegExp?]> = {
  "asset-bound-twice": ["refused", "refused", /coverage asset bound twice/],
  "bytes-bom": ["refused", "refused", /invalid JSON/],
  "bytes-duplicate-key": ["refused", "refused", /duplicate JSON object key: inputFormat/],
  "bytes-escaped-not-nfc": ["refused", "refused", NOT_NFC],
  "bytes-number-exponent": ["refused", "refused", NOT_CANONICAL],
  "bytes-number-negative-zero": ["refused", "refused", /not negative zero/],
  "bytes-number-overflow": ["refused", "refused", /numbers must be finite/],
  "bytes-proto-key": ["refused", "refused", /has an unsupported field __proto__/],
  "bytes-raw-lone-surrogate": ["refused", "refused", LONE_SURROGATE],
  "bytes-trailing-data": ["refused", "refused", /invalid JSON/],
  "bytes-trailing-whitespace": ["refused", "refused", NOT_CANONICAL],
  "bytes-valid": ["accepted", "accepted"],
  "publication-other-ref": ["accepted", "refused"],
  "publication-unreviewed-commit": ["accepted", "refused"],
  "report-analyzer-name-nbsp": ["refused", "refused", UNTRIMMED],
  "report-analyzer-name-untrimmed": ["refused", "refused", UNTRIMMED],
  "report-analyzer-proto-key": ["refused", "refused", /has an unsupported field __proto__/],
  "report-analyzer-version-untrimmed": ["refused", "refused", UNTRIMMED],
  "report-finding-code-untrimmed": ["refused", "refused", UNTRIMMED],
  "report-finding-count-unsafe-integer": ["refused", "refused", /count must be an integer/],
  "report-finding-detail-untrimmed": ["refused", "refused", UNTRIMMED],
  "report-finding-fingerprint-untrimmed": ["refused", "refused", UNTRIMMED],
  "report-finding-fingerprints-untrimmed": ["refused", "refused", UNTRIMMED],
  "report-findings": ["accepted", "accepted"],
  "string-lone-surrogate": ["refused", "refused", LONE_SURROGATE],
  "string-not-nfc": ["refused", "refused", NOT_NFC],
  "string-not-nfc-in-report": ["refused", "refused", NOT_NFC],
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

/** Seals the fixture (its exact bytes, or its record's canonical bytes, unvalidated) and reads it. */
function read(fixture: Fixture): unknown {
  const bytes = fixture.bytes ?? canonicalJsonV1(fixture.record);
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
    expect("record" in fixture).not.toBe("bytes" in fixture);
    if (structure === "accepted") {
      expect(read(fixture)).toHaveLength(1);
      return;
    }
    expect(() => read(fixture)).toThrow(reason);
  });
});
