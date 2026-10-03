import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { root } from "./helpers.js";

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
const producerSources = walk(resolve(root, "src/producer")).filter((file) => file.endsWith(".ts"));
const producerTools = ["prepare-candidate.mjs", "measure-candidate.mjs", "check-release.mjs"].map(
  (name) => resolve(root, "tools", name),
);
const specifiers = (source: string): string[] =>
  [
    ...source.matchAll(
      /\b(?:import|export)\b[^"';]*?from\s*["']([^"']+)["']|\bimport\s*\(\s*(?:["']([^"']+)["']|`([^`]+)`)/g,
    ),
  ].map((match) => (match[1] ?? match[2] ?? match[3]) as string);

describe("the producer path stays independent of retired obligations", () => {
  it("imports only node built-ins, itself and the migrated release module", () => {
    for (const file of producerSources) {
      for (const specifier of specifiers(readFileSync(file, "utf8"))) {
        if (specifier.startsWith("node:")) continue;
        const target = resolve(dirname(file), specifier);
        const relativeTarget = relative(resolve(root, "src"), target).replaceAll("\\", "/");
        expect(
          relativeTarget.startsWith("producer/") || relativeTarget.startsWith("release/"),
          `${relative(root, file)} imports ${specifier}`,
        ).toBe(true);
      }
    }
  });

  it("names no qualification, receipt, promotion, Workbench, Core-lock or cold-admin machinery", () => {
    const forbidden =
      /qualif|receipt|promot|workbench|signed-head|signed-catalog|cold-external|core-v2-lock|attestation|scanner-consumer|sibling/i;
    for (const file of [...producerSources, ...producerTools]) {
      const source = readFileSync(file, "utf8");
      expect(source.match(forbidden)?.[0], relative(root, file)).toBeUndefined();
    }
  });

  it("neither imports nor starts Scan; its only appearance is the not-awaited summary field", () => {
    for (const file of [...producerSources, ...producerTools]) {
      const source = readFileSync(file, "utf8");
      for (const specifier of specifiers(source)) expect(specifier, file).not.toMatch(/scan/i);
      expect(source, file).not.toMatch(/aih-scan|@aihq\/scan|spawn[^;]*scan/i);
    }
    const timing = readFileSync(resolve(root, "src/producer/timing.ts"), "utf8");
    expect(timing).toContain("awaited: false");
    expect(timing).toContain('status: "not-awaited"');
  });

  it("removes recursively only directories this code just created", () => {
    // Every recursive removal must name a directory made by mkdtemp/staging in the same module.
    const owned: Record<string, string[]> = {
      "install.ts": ["next", "rejected", "previous"],
      "package.ts": ["consumer"],
    };
    const found: string[] = [];
    for (const file of producerSources) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /rmSync\(\s*([A-Za-z_.]+)\s*,\s*\{[^}]*recursive: true/g,
      )) {
        const name = file.split(/[\\/]/).pop() as string;
        found.push(`${name}:${match[1]}`);
        expect(owned[name] ?? [], `${name} removes ${match[1]} recursively`).toContain(
          match[1] as string,
        );
      }
    }
    expect(found.length).toBeGreaterThan(0);
    expect(readFileSync(resolve(root, "src/producer/package.ts"), "utf8")).not.toMatch(
      /rmSync\(\s*stageDir/,
    );
    expect(readFileSync(resolve(root, "src/producer/install.ts"), "utf8")).toMatch(
      /mkdirSync\(dirname\(target\)/,
    );
  });

  it("starts no scheduler, service or listener", () => {
    for (const file of [...producerSources, ...producerTools]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/setInterval|createServer|\.listen\(|node-cron|schedule\(/);
    }
  });

  it("fetches only through the redirect-safe pinned fetch with manual redirects", () => {
    const tool = readFileSync(resolve(root, "tools/prepare-candidate.mjs"), "utf8");
    expect(tool).toMatch(/fetchSourceTree\(/);
    expect(tool).toMatch(/redirect: "manual"/);
    expect(tool).not.toMatch(/["']fetch["']/);
    expect(tool).not.toMatch(/--repo\b/);
    expect(readFileSync(resolve(root, "src/producer/fetch.ts"), "utf8")).toContain(
      "http.followRedirects=false",
    );
  });

  it("reads no moving reference: a commit must be a full explicit id", () => {
    const tree = readFileSync(resolve(root, "src/producer/tree.ts"), "utf8");
    expect(tree).toContain("/^[0-9a-f]{40}$/");
    expect(readFileSync(resolve(root, "tools/prepare-candidate.mjs"), "utf8")).toContain(
      "/^[a-f0-9]{40}$/u",
    );
  });
});

describe("the published package keeps its intended runtime subset", () => {
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    private?: boolean;
    files: string[];
    exports: Record<string, unknown>;
    scripts: Record<string, string>;
    version: string;
  };

  it("ships no producer code and keeps the publication guards and entries", () => {
    expect(manifest.files).toEqual([
      "dist/release",
      "release",
      "schemas/release",
      "schemas/core-recipe",
      "README.md",
      "CHANGELOG.md",
    ]);
    expect(Object.keys(manifest.exports)).toEqual([
      "./contracts",
      "./reader",
      "./node",
      "./release.json",
      "./release-1.1.json",
      "./schemas/release/1.0.0.json",
      "./schemas/release/1.1.0.json",
      "./package.json",
    ]);
    expect(manifest.private).toBe(true);
    expect(manifest.scripts.prepublishOnly).toBe("node tools/refuse-publication.mjs");
    expect(manifest.version).toBe("0.1.0");
  });

  it("wires the producer through explicit maintainer scripts only", () => {
    expect(manifest.scripts["prepare:candidate"]).toBe(
      "npm run build:dist && node tools/prepare-candidate.mjs",
    );
    expect(manifest.scripts["measure:candidate"]).toBe("node tools/measure-candidate.mjs");
    expect(manifest.scripts["check:release"]).toBe("node tools/check-release.mjs");
    for (const [name, command] of Object.entries(manifest.scripts)) {
      if (
        /^(?:pre|post)?(?:install|publish|pack|prepare|version)$|^prepublishOnly$/.test(name) &&
        name !== "prepublishOnly"
      ) {
        expect(command, name).not.toMatch(/prepare-candidate|measure-candidate/);
      }
    }
  });
});
