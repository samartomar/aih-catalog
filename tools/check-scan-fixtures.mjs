// Runs inside the isolated pinned Scan consumer. A published package without
// fixture exports fails, rather than silently claiming compatibility.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { readArtifact } from "@aihq/scan/read";
import manifest from "@aihq/scan/fixtures/manifest.json" with { type: "json" };

const load = specifier => readFileSync(fileURLToPath(import.meta.resolve(specifier)));
const ajv = new Ajv2020({ strict: true });
assert(manifest.fixtures.length > 0, "Scan exports no fixtures");
let read = 0;
for (const fixture of manifest.fixtures) {
  const bytes = load(fixture.export), value = JSON.parse(bytes);
  const schema = JSON.parse(load(fixture.schemaExport));
  assert.equal(schema.$id, fixture.contract);
  assert.equal(fixture.version, fixture.contract.split(":").at(-1));
  const validate = ajv.getSchema(schema.$id) ?? ajv.compile(schema);
  assert.equal(validate(value), fixture.expected.status === "accept", `${fixture.name}: ${JSON.stringify(validate.errors)}`);
  if (fixture.reader === "artifact") {
    const result = await readArtifact(bytes);
    assert.equal(result.status === "read", fixture.expected.status === "accept", fixture.name);
    read++;
  }
}
assert(read > 0, "No public Scan artifact reader exercised");
console.log(JSON.stringify({ status: "checked", package: manifest.package, fixtures: manifest.fixtures.length, artifacts: read }));
