/**
 * Phase 1 of the packed-consumer replay, run inside the disposable consumer. It acquires the
 * journeys' inputs only through the installed package's own `fetchSource`: Catalog's data,
 * port report and pinned upstream fixtures from the Catalog repository's Git history at the
 * packed commit (a local Git source), plus, with `network`, real upstream pins. It also
 * computes Git's own tree hashes for journey 13 with `git write-tree`, independently of Scan.
 * Prints one JSON object: the input identities.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fetchSource } from "@aihq/catalog/node";
import { SCAN_FOLDER, SCAN_TREES } from "./fixtures.mjs";
import { canonical } from "./lib.mjs";

let text = "";
for await (const chunk of process.stdin) text += chunk;
const { repository, commit, inputs, network } = JSON.parse(text);
mkdirSync(inputs, { recursive: true });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Writes fetched files as a plain folder, keeping execute bits, and returns their identity. */
function materialise(folder, files) {
  const listing = [];
  for (const file of files) {
    if (file.mode !== "100644" && file.mode !== "100755") continue;
    const target = join(folder, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.bytes);
    chmodSync(target, file.mode === "100755" ? 0o755 : 0o644);
    listing.push(`${file.mode} ${file.sha256} ${file.path}`);
  }
  listing.sort();
  return { files: listing.length, sha256: sha(listing.join("\n")) };
}

async function fetchInto(name, candidate) {
  const outDir = mkdtempSync(join(tmpdir(), "aih-catalog-fetch-"));
  try {
    const result = await fetchSource(candidate, { outDir });
    if (result.status !== "ok")
      throw new Error(`${name}: ${JSON.stringify(result).slice(0, 1000)}`);
    const identity = materialise(join(inputs, name), result.files);
    return { ...result.source, ...identity, skipped: result.skipped.length };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

const identity = {};
for (const subpath of ["data", "port-report", "tests/fixtures"])
  identity[subpath] = await fetchInto(subpath, { kind: "git", repository, ref: commit, subpath });
for (const source of Object.values(identity)) {
  if (source.commit !== commit) throw new Error(`fetched ${source.commit}, wanted ${commit}`);
  delete source.repository; // a machine path: the commit identifies the source
}

if (network) {
  // Real upstream pins, for checks that need every upstream byte.
  identity.upstream = {
    ecc: await fetchInto("upstream/ecc", {
      kind: "git",
      repository: "https://github.com/affaan-m/ECC",
      ref: "5064474d4d762dc9640234a41617cccb79185cec",
    }),
    superpowers: await fetchInto("upstream/superpowers", {
      kind: "git",
      repository: "https://github.com/obra/superpowers",
      ref: "5bf4e78011075bcfc0dc295f0724994cd123ee71",
    }),
  };
}

// Git's own tree hash of each journey 13 folder, computed by git itself.
const trees = {};
const parent = mkdtempSync(join(tmpdir(), "aih-catalog-tree-"));
try {
  for (const [name, layout] of Object.entries(SCAN_TREES)) {
    const folder = join(parent, name);
    const git = (...argv) =>
      execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...argv], {
        cwd: folder,
        encoding: "utf8",
        env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      }).trim();
    mkdirSync(folder);
    git("init", "--quiet");
    for (const [path, from] of Object.entries(layout)) {
      const entry = SCAN_FOLDER[from];
      const target = join(folder, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, typeof entry === "string" ? entry : entry.text);
      chmodSync(target, typeof entry === "object" && entry.executable ? 0o755 : 0o644);
    }
    git("add", "--all");
    trees[name] = `git-sha1:${git("write-tree")}`;
  }
} finally {
  rmSync(parent, { recursive: true, force: true });
}

// Journey 14: a disposable data repository whose second commit adds one qualification (a
// fixture record) for codebase-memory-mcp on darwin-arm64, read back through fetchSource.
{
  const repo = mkdtempSync(join(tmpdir(), "aih-catalog-data-"));
  const git = (...argv) =>
    execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "user.name=Consumer",
        "-c",
        "user.email=consumer@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...argv,
      ],
      {
        cwd: repo,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_AUTHOR_DATE: "2026-11-04T00:00:00Z",
          GIT_COMMITTER_DATE: "2026-11-04T00:00:00Z",
        },
      },
    ).trim();
  try {
    git("init", "--quiet", "--initial-branch=main");
    cpSync(join(inputs, "data", "cbm"), join(repo, "data", "cbm"), { recursive: true });
    cpSync(join(inputs, "data", "qualifications"), join(repo, "data", "qualifications"), {
      recursive: true,
    });
    git("add", "--all");
    git("commit", "--quiet", "-m", "data at the packed commit");
    const before = git("rev-parse", "HEAD");
    const folder = join(repo, "data", "qualifications");
    const unknown = readdirSync(folder)
      .map((name) => JSON.parse(readFileSync(join(folder, name), "utf8")))
      .find(
        (record) =>
          record.subject.aiSetup === "cbm.ai-setup.codebase-memory-mcp" &&
          record.subject.cell === "darwin-arm64",
      );
    const added = canonical({
      ...unknown,
      result: { status: "qualified", run: "5".repeat(64), date: "2026-11-04" },
    });
    const addedSha = sha(added);
    writeFileSync(join(folder, `${addedSha}.json`), added);
    const contentPath = join(repo, "data", "cbm", "content.json");
    const document = JSON.parse(readFileSync(contentPath, "utf8"));
    const item = document.items.find((entry) => entry.kind === "ai-setup");
    item.aiSetup.qualifications = [...item.aiSetup.qualifications, addedSha].sort();
    writeFileSync(contentPath, canonical(document));
    git("add", "--all");
    git("commit", "--quiet", "-m", "add a qualification");
    const after = git("rev-parse", "HEAD");
    for (const [name, ref] of [
      ["before", before],
      ["after", after],
    ]) {
      const outDir = mkdtempSync(join(tmpdir(), "aih-catalog-fetch-"));
      try {
        const result = await fetchSource(
          { kind: "git", repository: repo, ref, subpath: "data" },
          { outDir },
        );
        if (result.status !== "ok")
          throw new Error(`journey 14 ${name}: ${JSON.stringify(result)}`);
        materialise(join(inputs, "data-commits", name), result.files);
      } finally {
        rmSync(outDir, { recursive: true, force: true });
      }
    }
    identity.dataCommits = {
      before: { commit: before },
      after: { commit: after, qualification: addedSha },
    };
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

process.stdout.write(JSON.stringify({ identity, trees }));
