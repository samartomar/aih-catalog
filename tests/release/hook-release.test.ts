import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { listItems, readRelease } from "../../src/release/reader.js";
import { sha256 } from "./fixtures.js";

const root = resolve(import.meta.dirname, "../..");
const bytesAt = (path: string) => readFileSync(resolve(root, path));
const pkg = JSON.parse(bytesAt("package.json").toString("utf8"));

const ITEM_ID = "aihq.hook.claude.protect-env";
const COMMAND = 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/aihq-protect-env.mjs"';

function hookRelease() {
  const bytes = bytesAt("release/release-1.1.json");
  const result = readRelease(bytes, { expectedSha256: sha256(bytes) });
  if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
  return result.release;
}

describe("carried hook release 1.1", () => {
  it("is exactly what the generator produces", () => {
    if (!existsSync(resolve(root, "dist/release/hook-content.js")))
      throw new Error("run npm run build:dist first");
    const output = execFileSync(process.execPath, ["tools/generate-release.mjs", "--check"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(output).toContain("release/release-1.1.json");
  });

  it("is a 1.1 release of this package that leaves the 1.0 release untouched", () => {
    const release = hookRelease();
    expect(release.schema).toBe("urn:aihq:catalog:release:1.1.0");
    expect(release.package).toEqual({ name: pkg.name, version: pkg.version });
    expect(release.sources).toEqual([{ id: "aihq-client-hooks", origin: { kind: "authored" } }]);
    expect(listItems(release).map((item) => item.id)).toEqual([ITEM_ID]);
    const one = JSON.parse(bytesAt("release/release.json").toString("utf8"));
    expect(one.schema).toBe("urn:aihq:catalog:release:1.0.0");
    expect(
      one.items.every((item: { recipe: { schema: string } }) =>
        item.recipe.schema.endsWith("1.0.0"),
      ),
    ).toBe(true);
  });

  it("registers one fixed wrapper-command group for Claude Code through the generic operation", () => {
    const item = listItems(hookRelease())[0];
    expect(item).toMatchObject({
      id: ITEM_ID,
      kind: "hook",
      scopes: ["project"],
      inputs: {},
      dependencies: { requires: [], optional: [], conflicts: [] },
    });
    expect(item?.recipe.schema).toBe("urn:aihq:core:recipe:1.1.0");
    const recipe = JSON.parse(bytesAt(item?.recipe.path as string).toString("utf8"));
    const hooks = recipe.operations.filter((op: { kind: string }) => op.kind === "hook.group");
    expect(hooks).toHaveLength(1);
    const [hook] = hooks;
    expect(hook).toMatchObject({
      scope: "project",
      target: {
        root: "project",
        segments: [{ literal: ".claude" }, { literal: "settings.json" }],
      },
      format: "json",
      container: ["hooks", "PreToolUse"],
      action: "set",
      requires: ["write-script"],
      selector: { path: ["hooks", 0, "command"], value: COMMAND },
      group: {
        literal: {
          matcher: "Edit|Write",
          hooks: [{ type: "command", command: COMMAND }],
        },
      },
    });
    // The selector names a documented client field; Core inserts no identity of its own.
    expect(Object.keys(hook.group.literal).sort()).toEqual(["hooks", "matcher"]);
    // The wrapper arrives as a separately owned, hash-checked file written first.
    const write = recipe.operations.find((op: { id: string }) => op.id === "write-script");
    expect(write).toMatchObject({
      kind: "file.write",
      material: "script",
      target: {
        root: "project",
        segments: [
          { literal: ".claude" },
          { literal: "hooks" },
          { literal: "aihq-protect-env.mjs" },
        ],
      },
    });
    expect(recipe.checks).toContainEqual(
      expect.objectContaining({ kind: "file.sha256", sha256: item?.materials[0]?.sha256 }),
    );
    expect(recipe.prerequisites).toEqual([{ kind: "executable", name: "node" }]);
    expect(item?.targets).toEqual(recipe.prerequisites);
  });

  it("validates against Core's published recipe 1.1 structure", () => {
    const schema = JSON.parse(bytesAt("schemas/core-recipe/1.1.0.json").toString("utf8"));
    expect(schema.$id).toBe("urn:aihq:core:recipe:1.1.0");
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    const item = listItems(hookRelease())[0];
    const recipe = JSON.parse(bytesAt(item?.recipe.path as string).toString("utf8"));
    expect(validate(recipe), JSON.stringify(validate.errors)).toBe(true);
    expect(recipe.inputs).toEqual(item?.inputs);
    expect(recipe.materials).toEqual(
      item?.materials.map(({ id, sha256: hash, byteLength }) => ({ id, sha256: hash, byteLength })),
    );
  });

  it("delivers a wrapper that blocks env-file edits and nothing else", () => {
    const material = listItems(hookRelease())[0]?.materials[0];
    const script = resolve(root, material?.path as string);
    const run = (payload: object) =>
      spawnSync(process.execPath, [script], { input: JSON.stringify(payload), encoding: "utf8" });
    const edit = (file_path: string) => ({ tool_name: "Edit", tool_input: { file_path } });
    const blocked = run(edit("/work/app/.env"));
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain(".env");
    expect(run(edit("C:\\work\\app\\.env.local")).status).toBe(2);
    expect(run(edit("C:\\work\\app\\.ENV")).status).toBe(2);
    expect(run(edit("C:\\work\\app\\.ENV.Local")).status).toBe(2);
    expect(
      run({ tool_name: "Write", tool_input: { file_path: "/work/app/.env.production" } }).status,
    ).toBe(2);
    expect(run(edit("/work/app/.env.example")).status).toBe(0);
    expect(run(edit("C:\\work\\app\\.ENV.EXAMPLE")).status).toBe(0);
    expect(run(edit("/work/app/src/environment.ts")).status).toBe(0);
    expect(run({ tool_name: "Bash", tool_input: { command: "ls" } }).status).toBe(0);
    expect(spawnSync(process.execPath, [script], { input: "{", encoding: "utf8" }).status).toBe(2);
  });
});
