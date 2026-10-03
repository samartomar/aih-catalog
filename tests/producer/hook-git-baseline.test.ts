import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { documentBytes } from "../../src/producer/generate.js";
import { assertHookSelectorContinuity } from "../../src/producer/hook-release.js";
import { committedHookBaseline } from "../../tools/hook-git-baseline.mjs";
import { committedRelease, sha256 } from "./helpers.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("compares with a committed hook release after working-tree deletion and repinning", () => {
  const root = mkdtempSync(join(tmpdir(), "aih-hook-git-"));
  roots.push(root);
  const run = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  run("init", "-q");
  const files = committedRelease();
  const path = "release/release-1.1.json";
  const doc = JSON.parse(Buffer.from(files.get(path) as Uint8Array).toString("utf8"));
  const recipePath = doc.items[0].recipe.path as string;
  for (const member of [path, recipePath]) {
    mkdirSync(dirname(join(root, member)), { recursive: true });
    writeFileSync(join(root, member), files.get(member) as Uint8Array);
  }
  run("add", "release");
  run(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "baseline",
  );
  const baseline = run("rev-parse", "HEAD");
  rmSync(join(root, "release"), { recursive: true });

  const candidate = new Map(files);
  const recipe = JSON.parse(Buffer.from(candidate.get(recipePath) as Uint8Array).toString("utf8"));
  recipe.operations.find(
    (operation: { kind: string }) => operation.kind === "hook.group",
  ).selector.value = "different-command";
  const bytes = documentBytes(recipe);
  candidate.set(recipePath, bytes);
  doc.items[0].recipe.sha256 = sha256(bytes);
  doc.items[0].recipe.byteLength = bytes.length;
  candidate.set(path, documentBytes(doc));

  expect(() =>
    assertHookSelectorContinuity(committedHookBaseline(root, baseline), candidate),
  ).toThrow(/hook-selector-changed/u);
  expect(() => committedHookBaseline(root, "0000000000000000000000000000000000000000")).toThrow(
    /unavailable/u,
  );
  mkdirSync(dirname(join(root, recipePath)), { recursive: true });
  writeFileSync(join(root, path), files.get(path) as Uint8Array);
  writeFileSync(join(root, recipePath), "{}\n");
  run("add", "release");
  run(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "damaged recipe",
  );
  expect(() => committedHookBaseline(root, run("rev-parse", "HEAD"))).toThrow(/damaged/u);
});
