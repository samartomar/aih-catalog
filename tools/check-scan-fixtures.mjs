// Runs inside an isolated exact Scan consumer, through public exports only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { contractSupport } from "@aihq/scan/contracts";
import { readArtifact, readReport } from "@aihq/scan/read";

const json = specifier => JSON.parse(readFileSync(fileURLToPath(import.meta.resolve(specifier))));
const canonical = value => value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const ajv = new Ajv2020({ strict: false, allErrors: true });
const results = [];
let artifacts = 0, schemaValidReaderRefusals = 0;
assert(contractSupport.contracts.length > 0, "Scan declares no contracts");
for (const contract of contractSupport.contracts) {
  const specifier = contract.schemaExport.replace(/\.json$/, ".fixtures.json");
  const fixture = json(specifier), schema = json(contract.schemaExport);
  assert.equal(schema.$id, contract.id);
  assert.equal(fixture.contractId, contract.id);
  assert.equal(fixture.contractVersion, contract.id.split(":").at(-1));
  assert(fixture.cases.some(entry => entry.expectation === "accept"), `No valid case: ${specifier}`);
  assert(fixture.cases.some(entry => entry.expectation === "refuse"), `No invalid case: ${specifier}`);
  const validate = ajv.compile(schema);
  const reader = contract.id === "urn:aihq:scan:artifact:1.0.0" ? readArtifact
    : contract.id === "urn:aihq:scan:report:1.0.0" ? readReport : undefined;
  for (const entry of fixture.cases) {
    assert(["accept", "refuse"].includes(entry.expectation));
    const accept = entry.expectation === "accept", schemaValid = validate(entry.value);
    // Digest corruption is structurally valid and must reach the public reader.
    assert.equal(schemaValid, accept || entry.validation === "reader", `${specifier} ${entry.name}: ${JSON.stringify(validate.errors)}`);
    if (entry.validation === "reader") assert(reader, `No public reader for ${specifier}`);
    if (reader) {
      const result = await reader(Buffer.from(canonical(entry.value)));
      assert.equal(result.status, accept ? "read" : "invalid", `${specifier} ${entry.name}`);
      if (!accept) {
        assert.equal(result.diagnostics[0]?.code, entry.code);
        if (schemaValid) schemaValidReaderRefusals++;
      }
      if (reader === readArtifact) artifacts++;
    }
    assert.equal(accept ? entry.code === null : typeof entry.code === "string", true);
    results.push({ contractId: contract.id, version: fixture.contractVersion, specifier,
      name: entry.name, expectation: entry.expectation, code: entry.code });
  }
}
assert(artifacts > 0, "No public artifact reader exercised");
assert(schemaValidReaderRefusals > 0, "No schema-valid corruption refused by a public reader");
console.log(JSON.stringify({ status: "checked", package: contractSupport.package,
  contracts: contractSupport.contracts.length, cases: results.length, artifacts, schemaValidReaderRefusals, results }));
