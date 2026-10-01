import type { CandidateReport } from "./candidate.js";
import type { IntegrityCheck } from "./integrity.js";
import type { PackedArtifact } from "./package.js";

/**
 * A short review page for the person who approves the release: what changed
 * operationally, what only moved provenance, what was carried over, and which
 * checks passed. It is generated from the report; it decides nothing.
 */
export function renderReview(input: {
  report: CandidateReport;
  checks: readonly IntegrityCheck[];
  artifact?: PackedArtifact;
}): string {
  const { report, checks, artifact } = input;
  const list = (states: readonly string[]) =>
    report.items.filter((item) => states.includes(item.state));
  const lines: string[] = [
    `# Catalog candidate review`,
    "",
    `Package \`${report.package.name}@${report.package.version}\` (no version is allocated by this step).`,
    `Source \`${report.source.repository}\` pinned at \`${report.source.revision}\`.`,
    `Previous revision(s): ${report.baseRevisions.length ? report.baseRevisions.map((r) => `\`${r}\``).join(", ") : "none (first candidate)"}.`,
    `Upstream inventory: ${report.source.inventoryFiles} files, ${report.source.inventoryComplete ? "complete" : "INCOMPLETE"}.`,
    `Release document: sha256 \`${report.release.sha256}\`, ${report.release.byteLength} bytes${report.release.baseSha256 ? ` (was \`${report.release.baseSha256}\`)` : ""}.`,
    ...(artifact
      ? [`Packed artifact: sha256 \`${artifact.sha256}\`, ${artifact.byteLength} bytes.`]
      : []),
    "",
    "## Operational content changes",
    "",
  ];
  const operational = list(["added", "changed", "removed"]);
  if (operational.length === 0) lines.push("None.");
  for (const item of operational) {
    lines.push(
      `- **${item.state}** \`${item.id}\`${item.operational.length ? ` — ${item.operational.join(", ")}` : ""}`,
    );
  }
  lines.push("", "## Dependents revalidated", "");
  const dependents = list(["dependent-confirmed"]);
  if (dependents.length === 0) lines.push("None.");
  for (const item of dependents) {
    lines.push(
      `- \`${item.id}\` still requires changed ${item.dependsOnChanged.map((id) => `\`${id}\``).join(", ")}; its record is unchanged.`,
    );
  }
  lines.push("", "## Provenance-only changes (reported separately)", "");
  const provenance = list(["provenance-only"]);
  if (provenance.length === 0) lines.push("None.");
  for (const item of provenance) {
    lines.push(
      `- \`${item.id}\` — ${item.provenance.length ? item.provenance.join(", ") : "re-pinned to the new revision"}; behavior and member hashes are identical.`,
    );
  }
  lines.push("", "## Carried over untouched", "");
  const unchanged = list(["unchanged"]);
  if (unchanged.length === 0) lines.push("None.");
  for (const item of unchanged) {
    lines.push(`- \`${item.id}\` (record identity \`${item.itemSha256After ?? ""}\`)`);
  }
  lines.push(
    "",
    "## Files",
    "",
    `${report.files.total} release files: ${report.files.preserved} byte-identical to the previous candidate, ${report.files.written.length} written, ${report.files.dropped.length} dropped (superseded or removed).`,
    "",
    "## Checks",
    "",
  );
  for (const check of checks)
    lines.push(
      `- ${check.status === "not-run" ? "NOT RUN" : check.ok ? "pass" : "FAIL"} \`${check.name}\`${check.detail ? ` — ${check.detail}` : ""}`,
    );
  lines.push(
    "",
    "Optional Scan evidence is separate and was not awaited; no security result is implied by this candidate.",
    "",
  );
  return lines.join("\n");
}
