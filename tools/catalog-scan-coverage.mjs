import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const scan = "samartomar/aih-scan";
const catalog = "samartomar/aih-catalog";
const prefix = "scan-catalog-results-";
const commitPattern = /^[a-f0-9]{40}$/;
const keyPattern = /^git-sha(?:1:[a-f0-9]{40}|256:[a-f0-9]{64})$/;
const digestPattern = /^[a-f0-9]{64}$/;
const root = fileURLToPath(new URL("..", import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const formatDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const number = new Intl.NumberFormat("en-US");
const kinds = {
  agent: "Agent",
  "ai-setup": "AI setup",
  document: "Document",
  hook: "Hook",
  mcp: "MCP server",
  rule: "Rule",
  skill: "Skill",
};
const clients = {
  antigravity: "Antigravity",
  "claude-code": "Claude Code",
  codex: "Codex",
  copilot: "GitHub Copilot",
  cursor: "Cursor",
  dsh: "dsh",
  kimi: "Kimi",
  kiro: "Kiro",
  opencode: "OpenCode",
};

function run(command, args) {
  return execFileSync(command, args, { cwd: root, maxBuffer: 512 * 1024 * 1024 });
}

export function readReleaseIndex({ tag, assets }, raw) {
  const indexSha256 = sha256(raw);
  const uploaded = new Map(
    assets.filter((asset) => asset.state === "uploaded").map(({ name, digest }) => [name, digest]),
  );
  if (uploaded.get("index.json") !== `sha256:${indexSha256}`) {
    throw new Error(`Missing or mismatched index digest for ${tag}`);
  }
  const { repository, releaseTag, records } = JSON.parse(raw.toString("utf8"));
  if (repository !== scan || releaseTag !== tag || !Array.isArray(records) || !records.length) {
    throw new Error(`Invalid release index for ${tag}`);
  }
  for (const { scanKey, revision, archiveSha256, assetName, summary } of records) {
    if (
      !keyPattern.test(scanKey) ||
      !digestPattern.test(archiveSha256) ||
      assetName !== `${archiveSha256}.tar` ||
      uploaded.get(assetName) !== `sha256:${archiveSha256}` ||
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      summary?.path !== `targets/${scanKey.replace(":", "-")}/summary.json` ||
      !digestPattern.test(summary?.sha256)
    ) {
      throw new Error(`Invalid key or missing or mismatched report archive in ${tag}`);
    }
  }
  return { indexSha256, records };
}

export function readReportSummary(record, bytes) {
  if (!bytes || sha256(bytes) !== record.summary.sha256) {
    throw new Error(`Missing or mismatched summary for ${record.scanKey}`);
  }
  const summary = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (
    summary.format !== "aih-scan-summary/1" ||
    summary.scanKey !== record.scanKey ||
    summary.revision !== record.revision ||
    !["SAFE", "CAUTION", "DO NOT INSTALL", "NOT ASSESSED"].includes(summary.label) ||
    !["complete", "partial"].includes(summary.coverage) ||
    !Array.isArray(summary.tools)
  ) {
    throw new Error(`Unexpected summary for ${record.scanKey}`);
  }
  return {
    scanKey: record.scanKey,
    revision: record.revision,
    mode: summary.tools.some(({ mode }) => mode === "ai") ? "AI" : "Static",
    label: summary.label,
    coverage: summary.coverage === "complete" ? "Complete" : "Partial",
  };
}

function collectRows({ framework: { id }, items, bundles = [], plugins = [] }) {
  const rows = [];
  const itemsByName = Map.groupBy(items, ({ name, kind }) => `${kind}:${name}`);
  function add(reference, name, kind, scanKey, fetch) {
    if (scanKey === undefined ? kind !== "AI setup" : !keyPattern.test(scanKey)) {
      throw new Error(`Invalid Scan key for ${reference}`);
    }
    rows.push({ reference, name, kind, scanKey, fetch });
  }
  for (const item of items) {
    const context = item.id.split(".").slice(2, -1).join(" / ");
    const repeated = itemsByName.get(`${item.kind}:${item.name}`).length > 1;
    const name = repeated && context ? `${item.name} · ${context}` : item.name;
    add(item.id, name, kinds[item.kind] ?? item.kind, item.scanKey, item.fetch);
    for (const [client, edition] of Object.entries(item.editions ?? {})) {
      add(`${item.id}@${client}`, name, `${clients[client] ?? client} edition`, edition.scanKey);
    }
  }
  for (const bundle of bundles) add(bundle.id, bundle.id, "Runtime bundle", bundle.scanKey);
  for (const plugin of plugins) {
    const name = plugin.plugin ?? plugin.path;
    const reference = `${id}.plugin.${name}`;
    add(reference, name, "Plugin", plugin.scanKey);
    if (plugin.folderScanKey !== undefined && plugin.folderScanKey !== plugin.scanKey) {
      add(`${reference}:full-folder`, name, "Full plugin folder", plugin.folderScanKey);
    }
  }
  return rows;
}

function totals(rows, indexed) {
  const keys = new Set(rows.map((row) => row.scanKey).filter(Boolean));
  const published = [...keys].filter((key) => indexed.has(key)).length;
  return [keys.size, published, keys.size - published, rows.filter((row) => !row.scanKey).length];
}

function cell(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")
    .replaceAll("`", "&#96;");
}

export function renderCoverage(commit, manifests, releases) {
  const indexed = new Map();
  for (const [i, release] of releases.entries()) {
    for (const report of release.reports) {
      if (!indexed.has(report.scanKey)) indexed.set(report.scanKey, new Map());
      const versions = indexed.get(report.scanKey);
      const previous = versions.get(report.mode);
      if (!previous || report.revision >= previous.revision) {
        versions.set(report.mode, {
          ...report,
          date: formatDate.format(new Date(release.date)),
          link: i + 1,
        });
      }
    }
  }
  const families = manifests.map((manifest) => ({
    id: manifest.framework.id,
    name: manifest.framework.name,
    count: manifest.items.length,
    rows: collectRows(manifest),
  }));
  const rows = families.flatMap((family) => family.rows);
  const itemCount = families.reduce((count, family) => count + family.count, 0);
  const [keyCount, published, pending, unkeyed] = totals(rows, indexed);
  const details = [["Family", "Name", "Type", "Catalog reference", "Scan key"]];
  const lines = [
    "# Catalog Scan coverage",
    "",
    `**${number.format(published)} of ${number.format(keyCount)} Catalog versions have a published scan. ${number.format(pending)} await one.**`,
    "",
    `This snapshot covers ${number.format(itemCount)} items across ${families.length} families, including client editions, runtime bundles and plugin folders. See the [sources and refresh instructions](#sources-and-refresh).`,
    "",
    "- **Published scans** show the scan's risk rating and whether inspection was complete or partial for its selected tools. Read the findings and limits before deciding whether to install.",
    "- **No published scan yet** means this snapshot found no public report for that version.",
    "- **See qualifications** points to platform-specific evidence for an AI setup.",
    "",
    "## Families",
    "",
    "Items and editions that share the same files, paths and modes count as one version. The overall row counts versions shared across families once.",
    "",
    "| Family | Items | Versions | Published | Pending | AI setups with qualifications |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    `| **All families** | ${[itemCount, keyCount, published, pending, unkeyed].map((value) => number.format(value)).join(" | ")} |`,
    ...families.map(
      ({ id, name, count, rows }) =>
        `| [${name}](#family-${id}) | ${count} | ${totals(rows, indexed).join(" | ")} |`,
    ),
    "",
    "## Look up an item or edition",
    "",
    "Choose a family and search for the item's name. Each date links to the release for the latest scan of that type. To find the summary and findings, use the [exact Catalog and Scan identifiers](scan-coverage.csv) and look up the Scan key in the release's `index.json`. The entry gives the archive name and the summary's path inside it.",
    "",
  ];
  for (const { id, name, rows } of families) {
    lines.push(
      `<a name="family-${id}"></a>`,
      "",
      `### ${name}`,
      "",
      "| Name | Type | Published scans |",
      "| --- | --- | --- |",
    );
    for (const row of rows) {
      const { reference, kind, scanKey, fetch } = row;
      const matches = indexed.get(scanKey);
      const status = matches
        ? ["AI", "Static"]
            .flatMap((mode) => {
              const report = matches.get(mode);
              return report
                ? [
                    `${mode} · ${report.label} · ${report.coverage} ([${report.date}][release-${report.link}])`,
                  ]
                : [];
            })
            .join("<br>")
        : scanKey
          ? "No published scan yet"
          : "[See qualifications](../README.md#data)";
      const note = fetch === "upstream" ? " · upstream-only" : "";
      lines.push(`| ${cell(row.name)}${note} | ${kind} | ${status} |`);
      details.push([name, row.name, kind, reference, scanKey ?? ""]);
    }
    lines.push("");
  }
  lines.push(
    "## Sources and refresh",
    "",
    `- Catalog data revision [\`${commit.slice(0, 12)}\`](https://github.com/${catalog}/tree/${commit}/data).`,
  );
  for (const [i, { tag, indexSha256, date }] of releases.entries()) {
    lines.push(
      `- [${formatDate.format(new Date(date))}][release-${i + 1}] (\`${tag}\`). Index SHA-256 \`${indexSha256}\`.`,
    );
  }
  lines.push(
    "",
    "The generator checks SHA-256 for each downloaded index, archive and summary. It matches summaries by exact Scan key and shows the newest revision for each scan type. For signature verification and more on what a rating or completeness means, see [Scan's instructions](https://github.com/samartomar/aih-scan#signing-and-verification).",
    "",
    "From a current Catalog checkout with Git, Node.js 26 and an authenticated GitHub CLI (`gh`), run the commands below. The generator reads the committed Catalog data and public Scan releases. Review the regenerated report and lookup CSV before committing them.",
    "",
    "```sh",
    "npm ci --ignore-scripts",
    "npm run build:dist",
    "node tools/catalog-scan-coverage.mjs --write",
    "```",
    "",
    "To reproduce this snapshot, run the same generator with the exact revision and release tags. It prints the Markdown to standard output. Add `--csv` to print the lookup instead.",
    "",
    "```sh",
    [
      `node tools/catalog-scan-coverage.mjs --catalog ${commit}`,
      ...releases.map(({ tag }) => `--release ${tag}`),
    ].join(" \\\n  "),
    "```",
    "",
    ...releases.map(
      ({ tag }, i) => `[release-${i + 1}]: https://github.com/${scan}/releases/tag/${tag}`,
    ),
    "",
  );
  return {
    report: lines.join("\n"),
    csv: `${details.map((row) => row.map((field) => `"${field.replaceAll('"', '""')}"`).join(",")).join("\n")}\n`,
  };
}

function downloadAsset(tag, name) {
  return run("gh", [
    "release",
    "download",
    tag,
    "--repo",
    scan,
    "--pattern",
    name,
    "--output",
    "-",
  ]);
}

async function main() {
  const { values } = parseArgs({
    options: {
      catalog: { type: "string" },
      release: { type: "string", multiple: true },
      write: { type: "boolean", default: false },
      csv: { type: "boolean", default: false },
    },
  });
  if (values.write && values.csv) throw new Error("Choose --write or --csv");
  const { readTar } = await import("../dist/catalog/internal/tar.js");
  const commit =
    values.catalog ?? run("git", ["log", "-1", "--format=%H", "--", "data"]).toString().trim();
  if (!commitPattern.test(commit)) throw new Error("Expected a full Catalog commit SHA");
  const paths = run("git", ["ls-tree", "-r", "--name-only", commit, "--", "data"])
    .toString()
    .split(/\r?\n/)
    .filter((path) => /^data\/[a-z0-9-]+\/content\.json$/.test(path));
  if (!paths.length) throw new Error(`No Catalog manifests at ${commit}`);
  const manifests = paths.map((path) =>
    JSON.parse(run("git", ["show", `${commit}:${path}`]).toString("utf8")),
  );
  const metadata = run("gh", [
    "api",
    `repos/${scan}/releases?per_page=100`,
    "--paginate",
    "--jq",
    `.[] | select(.draft == false and (.tag_name | startswith("${prefix}"))) | {tag: .tag_name, date: .published_at, assets: [.assets[] | {name,state,digest}]}`,
  ])
    .toString()
    .trim();
  if (!metadata) throw new Error("No public Catalog-result releases found");
  const available = new Map(
    metadata.split(/\r?\n/).map((line) => {
      const release = JSON.parse(line);
      return [release.tag, release];
    }),
  );
  const tags = [...new Set(values.release ?? available.keys())].sort();
  const releases = tags.map((tag) => {
    const release = available.get(tag);
    if (!release) throw new Error(`No public Catalog-result release ${tag}`);
    const { indexSha256, records } = readReleaseIndex(release, downloadAsset(tag, "index.json"));
    const reports = [];
    for (const [assetName, entries] of Map.groupBy(records, (record) => record.assetName)) {
      const archive = downloadAsset(tag, assetName);
      if (sha256(archive) !== entries[0].archiveSha256) {
        throw new Error(`Mismatched report archive digest in ${tag}`);
      }
      const unpacked = readTar(archive);
      if (unpacked.status !== "ok") throw new Error(`Unreadable report archive in ${tag}`);
      const files = new Map(unpacked.files.map(({ path, bytes }) => [path, bytes]));
      for (const record of entries) {
        // The tar reader removes the archive's top level, "targets/".
        reports.push(
          readReportSummary(record, files.get(record.summary.path.slice("targets/".length))),
        );
      }
    }
    return { tag, date: release.date, indexSha256, reports };
  });
  const { report, csv } = renderCoverage(commit, manifests, releases);
  if (values.write) {
    writeFileSync(new URL("../docs/scan-coverage.md", import.meta.url), report);
    writeFileSync(new URL("../docs/scan-coverage.csv", import.meta.url), csv);
  } else process.stdout.write(values.csv ? csv : report);
}

if (import.meta.main) await main();
