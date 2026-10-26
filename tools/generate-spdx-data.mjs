// Owns src/release/spdx-data.ts: embeds the canonical SPDX license list and
// exceptions. Deterministic for a given list version; the header records the
// upstream version and release date so drift is reviewable.
// Usage: node tools/generate-spdx-data.mjs
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const licensesUrl = "https://spdx.org/licenses/licenses.json";
const exceptionsUrl = "https://spdx.org/licenses/exceptions.json";

const fetch = async (url) => {
  const response = await globalThis.fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`SPDX list fetch failed: ${response.status} ${url}`);
  return response.json();
};
const [licenses, exceptions] = await Promise.all([fetch(licensesUrl), fetch(exceptionsUrl)]);
const licenseIds = [...licenses.licenses]
  .filter((entry) => !entry.isDeprecatedLicenseId)
  .map((entry) => entry.licenseId)
  .sort();
const exceptionIds = [...exceptions.exceptions]
  .filter((entry) => !entry.isDeprecatedLicenseExceptionId)
  .map((entry) => entry.licenseExceptionId)
  .sort();

if (licenses.licenseListVersion !== exceptions.licenseListVersion) {
  throw new Error(
    `SPDX list version mismatch: licenses ${licenses.licenseListVersion}, exceptions ${exceptions.licenseListVersion}`,
  );
}
const format = (ids) => {
  const lines = [];
  for (let index = 0; index < ids.length; index += 6) {
    lines.push(`  ${ids.slice(index, index + 6).map((id) => JSON.stringify(id)).join(", ")},`);
  }
  return lines.join("\n");
};

const module = `/**
 * SPDX License List identifiers, embedded data. Source: the canonical SPDX
 * license list v${licenses.licenseListVersion} (release date ${licenses.releaseDate}),
 * https://spdx.org/licenses/ . Non-deprecated identifiers only. Regenerate with
 * tools/generate-spdx-data.mjs when the list advances; do not hand-edit.
 */
export const SPDX_LICENSE_LIST_VERSION = ${JSON.stringify(licenses.licenseListVersion)} as const;
export const SPDX_LICENSE_LIST_RELEASE = ${JSON.stringify(licenses.releaseDate)} as const;

export const SPDX_LICENSE_IDS: ReadonlySet<string> = new Set([
${format(licenseIds)}
]);

export const SPDX_EXCEPTION_IDS: ReadonlySet<string> = new Set([
${format(exceptionIds)}
]);
`;
writeFileSync(resolve(root, "src/release/spdx-data.ts"), module);
console.log(
  `spdx-data.ts: SPDX list v${licenses.licenseListVersion} (${licenses.releaseDate}): ${licenseIds.length} licenses, ${exceptionIds.length} exceptions`,
);
