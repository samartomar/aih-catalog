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

function run(command, args) {
  return execFileSync(command, args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
}

export function readReleaseIndex({ tag, assets }, raw) {
  const indexSha256 = createHash("sha256").update(raw).digest("hex");
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
  const keys = new Set();
  for (const { scanKey, archiveSha256, assetName } of records) {
    if (
      !keyPattern.test(scanKey) ||
      !digestPattern.test(archiveSha256) ||
      assetName !== `${archiveSha256}.tar` ||
      uploaded.get(assetName) !== `sha256:${archiveSha256}`
    ) {
      throw new Error(`Invalid key or missing or mismatched report archive in ${tag}`);
    }
    keys.add(scanKey);
  }
  return { tag, indexSha256, keys };
}

function collectRows({ framework: { id }, items, bundles = [], plugins = [] }) {
  const rows = [];
  function add(reference, kind, scanKey, fetch) {
    if (scanKey === undefined ? kind !== "ai-setup" : !keyPattern.test(scanKey)) {
      throw new Error(`Invalid Scan key for ${reference}`);
    }
    rows.push({ reference, kind, scanKey, fetch });
  }
  for (const item of items) {
    add(item.id, item.kind, item.scanKey, item.fetch);
    for (const [client, edition] of Object.entries(item.editions ?? {})) {
      add(`${item.id}@${client}`, "Edition", edition.scanKey);
    }
  }
  for (const bundle of bundles) add(bundle.id, "Bundle", bundle.scanKey);
  for (const plugin of plugins) {
    const reference = `${id}.plugin.${plugin.plugin ?? plugin.path}`;
    add(reference, "Plugin", plugin.scanKey);
    if (plugin.folderScanKey !== undefined && plugin.folderScanKey !== plugin.scanKey) {
      add(`${reference}:full-folder`, "Full plugin folder", plugin.folderScanKey);
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
    for (const key of release.keys) {
      if (!indexed.has(key)) indexed.set(key, []);
      indexed.get(key).push(i + 1);
    }
  }
  const families = manifests.map((manifest) => ({
    id: manifest.framework.id,
    count: manifest.items.length,
    rows: collectRows(manifest),
  }));
  const rows = families.flatMap((family) => family.rows);
  const itemCount = families.reduce((count, family) => count + family.count, 0);
  const [keyCount, published, pending, unkeyed] = totals(rows, indexed);
  const lines = [
    "# Catalog Scan coverage",
    "",
    `**${published} of ${keyCount} distinct Scan keys have a published report. ${pending} are pending.**`,
    "",
    `This snapshot covers ${itemCount} Catalog items and ${rows.length} references across ${families.length} families. It includes client editions, runtime bundles, and plugin folders. See the [sources and refresh instructions](#sources-and-refresh).`,
    "",
    "- **Published** means a listed public Scan release indexes a report for these exact paths, bytes and file modes. A report can describe findings or incomplete inspection. The installation decision stays with you or your organization.",
    "- **Pending** means this snapshot found no indexed public report for that key.",
    "- **No Scan key** identifies an AI setup whose platform-specific evidence is recorded in [Catalog qualifications](../README.md#data).",
    "",
    "## Families",
    "",
    "The totals count distinct keys. Items, editions and plugins can share a key, even across families. The overall row counts each shared key once.",
    "",
    "| Family | Items | Distinct keys | Published | Pending | No key |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    `| **All families** | ${itemCount} | ${keyCount} | ${published} | ${pending} | ${unkeyed} |`,
    ...families.map(
      ({ id, count, rows }) =>
        `| [${id}](#${id}) | ${count} | ${totals(rows, indexed).join(" | ")} |`,
    ),
    "",
    "## Look up an item or edition",
    "",
    "Open your family below and search for an item ID, client edition (such as `@codex`), or Scan key. Follow a numbered link to a public release and find your key in its `index.json`. The entry gives the archive name and the summary's path in that archive. An item marked upstream-only is fetched at its upstream pin.",
    "",
  ];
  for (const { id, rows } of families) {
    lines.push(
      `### ${id}`,
      "",
      "| Catalog reference | Kind | Scan key | Report availability |",
      "| --- | --- | --- | --- |",
    );
    for (const { reference, kind, scanKey, fetch } of rows) {
      const matches = indexed.get(scanKey);
      const status = matches
        ? `Published (${matches.map((i) => `[${i}][release-${i}]`).join(", ")})`
        : scanKey
          ? "Pending"
          : "No Scan key";
      const note = fetch === "upstream" ? " · upstream-only" : "";
      lines.push(
        `| \`${cell(reference)}\`${note} | ${kind} | ${scanKey ? `\`${scanKey}\`` : "—"} | ${status} |`,
      );
    }
    lines.push("");
  }
  lines.push(
    "## Sources and refresh",
    "",
    `- Catalog data revision [\`${commit.slice(0, 12)}\`](https://github.com/${catalog}/tree/${commit}/data).`,
  );
  for (const [i, { tag, indexSha256 }] of releases.entries()) {
    lines.push(
      `- Release ${i + 1} [\`${tag}\`][release-${i + 1}]. Index SHA-256 \`${indexSha256}\`.`,
    );
  }
  lines.push(
    "",
    "The generator checks the index digest and checks that each referenced archive is listed with its expected digest. Its counts track publication. For findings, detector coverage and signature verification, use [Scan's instructions](https://github.com/samartomar/aih-scan#signing-and-verification).",
    "",
    "From a current Catalog checkout with Git, Node.js 26 and an authenticated GitHub CLI (`gh`), run the command below. It reads the latest commit that changed the checked-out Catalog data and discovers public Catalog-result releases from Scan. Review the generated diff before committing it.",
    "",
    "```sh",
    "node tools/catalog-scan-coverage.mjs --write",
    "```",
    "",
    "To reproduce this snapshot, run the same generator with the exact revision and release tags. It prints the Markdown to standard output.",
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
  return lines.join("\n");
}

function main() {
  const { values } = parseArgs({
    options: {
      catalog: { type: "string" },
      release: { type: "string", multiple: true },
      write: { type: "boolean", default: false },
    },
  });
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
    `.[] | select(.draft == false and (.tag_name | startswith("${prefix}"))) | {tag: .tag_name, assets: [.assets[] | {name,state,digest}]}`,
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
    const index = run("gh", [
      "release",
      "download",
      tag,
      "--repo",
      scan,
      "--pattern",
      "index.json",
      "--output",
      "-",
    ]);
    return readReleaseIndex(release, index);
  });
  const report = renderCoverage(commit, manifests, releases);
  if (values.write) writeFileSync(new URL("../docs/scan-coverage.md", import.meta.url), report);
  else process.stdout.write(report);
}

if (import.meta.main) main();
