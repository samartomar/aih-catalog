import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { compileProducerDeclaration } from "../../src/release/producer.js";
import { configureItem, readRelease, resolveSelections } from "../../src/release/reader.js";

const root = resolve(import.meta.dirname, "../..");
const memberPath = (member: unknown): string =>
  String(
    (member as { path?: string; packagePath?: string }).path ??
      (member as { packagePath?: string }).packagePath,
  );

it("offers a real Extensions skill with complete notices and explicit companion closure", () => {
  const declaration = JSON.parse(
    readFileSync(resolve(root, "producer/extensions/declaration.json"), "utf8"),
  );
  const snapshot = JSON.parse(
    readFileSync(resolve(root, "producer/extensions/snapshot.json"), "utf8"),
  );
  const sourceFiles = snapshot.sources.map(
    (source: { id: string; revision: string; files: { path: string; base64: string }[] }) => ({
      source: source.id,
      revision: source.revision,
      files: Object.fromEntries(
        source.files.map((file) => [file.path, new Uint8Array(Buffer.from(file.base64, "base64"))]),
      ),
    }),
  );
  for (const source of sourceFiles) {
    for (const [path, bytes] of Object.entries(snapshot.recipes[source.source] ?? {})) {
      source.files[path] = new TextEncoder().encode(bytes as string);
    }
  }
  const result = compileProducerDeclaration({ declaration, sourceFiles });
  expect(result.status, JSON.stringify(result.diagnostics)).toBe("ok");
  if (result.status !== "ok") return;
  const read = readRelease(result.value.releaseBytes, {
    expectedSha256: result.value.releaseSha256,
  });
  expect(read.valid).toBe(true);
  if (!read.valid) return;
  const resolved = resolveSelections({
    releases: { [read.release.sha256]: read.release },
    roots: [
      {
        releaseSha256: read.release.sha256,
        itemId: "extensions.kiro.skill.ask-sam",
        scope: "project",
        configuration: {},
      },
    ],
    skips: [],
  });
  expect(resolved.status).toBe("ok");
  if (resolved.status !== "ok") return;
  expect(resolved.value.selections.map((selection) => selection.item.itemId)).toContain(
    "extensions.kiro.matt.ask-matt",
  );
  const configured = configureItem({
    release: read.release,
    itemId: "extensions.kiro.skill.ask-sam",
    configuration: {},
    materialSource: { kind: "local", input: "content" },
  });
  expect(configured.valid).toBe(true);
  expect(
    read.release.items
      .find((item) => item.id === "extensions.notices")
      ?.materials.map((material) => memberPath(material)),
  ).toContainEqual(expect.stringContaining("NOTICE.md"));
});

it("offers individually configured Claude hook groups without claiming Kiro or Copilot interception", () => {
  const declaration = JSON.parse(
    readFileSync(resolve(root, "producer/extensions/declaration.json"), "utf8"),
  );
  const hook = declaration.items.find(
    (item: { id: string }) => item.id === "extensions.claude.hook.git-guard",
  );
  expect(hook).toBeDefined();
  expect(hook.configuration.hookCommand.required).toBe(true);
  expect(
    hook.clientCapabilities.find(
      (capability: { client: string }) => capability.client === "kiro-ide",
    ).support,
  ).toBe("unsupported");
  const snapshot = JSON.parse(
    readFileSync(resolve(root, "producer/extensions/snapshot.json"), "utf8"),
  );
  const recipe = JSON.parse(snapshot.recipes.extensions[hook.recipePath]);
  expect(
    recipe.operations.find((operation: { kind: string }) => operation.kind === "hook.group"),
  ).toMatchObject({
    selector: { path: ["hooks", 0, "command"], input: "hookCommand" },
    groupBindings: [{ path: ["hooks", 0, "command"], value: { input: "hookCommand" } }],
  });
});

it.each([
  "extensions",
  "extensions.kiro",
  "extensions.copilot",
])("%s grill-with-docs resolves its required workflow and reports required skip/removal impact", (namespace) => {
  const bytes = readFileSync(resolve(root, "release/release-extensions.json"));
  const read = readRelease(bytes, {
    expectedSha256: createHash("sha256").update(bytes).digest("hex"),
  });
  if (!read.valid) throw new Error(JSON.stringify(read.diagnostics));
  const release = read.release;
  const roots = [
    {
      releaseSha256: release.sha256,
      itemId: `${namespace}.matt.grill-with-docs`,
      scope: "project" as const,
      configuration: {},
    },
  ];
  const releases = { [release.sha256]: release };
  const resolved = resolveSelections({ releases, roots, skips: [] });
  expect(resolved.status).toBe("ok");
  if (resolved.status !== "ok") return;
  expect(resolved.value.selections.map((selection) => selection.item.itemId).sort()).toEqual(
    [
      "extensions.notices",
      `${namespace}.matt.domain-modeling`,
      `${namespace}.matt.grill-with-docs`,
      `${namespace}.matt.grilling`,
    ].sort(),
  );
  for (const name of ["domain-modeling", "grilling"]) {
    const target = {
      releaseSha256: release.sha256,
      itemId: `${namespace}.matt.${name}`,
      scope: "project" as const,
    };
    const skipped = resolveSelections({ releases, roots, skips: [target], remove: [target] });
    expect(skipped.status).toBe("refused");
    expect(skipped).not.toHaveProperty("value");
    expect(skipped.diagnostics).toContainEqual(
      expect.objectContaining({ code: "REQUIRED_ITEM_SKIPPED" }),
    );
    const removal = resolveSelections({ releases, roots, skips: [], remove: [target] });
    expect(removal.status).toBe("ok");
    if (removal.status === "ok")
      expect(removal.value.removalImpact[0]?.affectedRoots.map((item) => item.itemId)).toEqual([
        `${namespace}.matt.grill-with-docs`,
      ]);
  }
});

it.each([
  "extensions",
  "extensions.kiro",
  "extensions.copilot",
])("%s retains the required closure of every maintained same-pin Matt skill", (namespace) => {
  const checked = (path: string) => {
    const bytes = readFileSync(resolve(root, path));
    const read = readRelease(bytes, {
      expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    if (!read.valid) throw new Error(JSON.stringify(read.diagnostics));
    return read.release;
  };
  const maintained = checked("release/release.json");
  const extensions = checked("release/release-extensions.json");
  const skills = maintained.items.filter((item) => item.id.startsWith("mattpocock."));
  expect(skills).toHaveLength(27);
  const sourcePin = (release: typeof maintained, item: (typeof skills)[number]) =>
    release.sources.find((source) => source.id === item.sourceIds[0])?.origin;
  for (const skill of skills) {
    const itemId = `${namespace}.matt.${skill.id.slice("mattpocock.".length)}`;
    const projected = extensions.items.find((item) => item.id === itemId);
    if (!projected) throw new Error(`Missing companion ${itemId}`);
    expect(sourcePin(extensions, projected)).toEqual(sourcePin(maintained, skill));
    const resolveRoot = (release: typeof maintained, id: string) =>
      resolveSelections({
        releases: { [release.sha256]: release },
        roots: [{ releaseSha256: release.sha256, itemId: id, scope: "project", configuration: {} }],
        skips: [],
      });
    const baseline = resolveRoot(maintained, skill.id);
    const result = resolveRoot(extensions, itemId);
    expect(baseline.status).toBe("ok");
    expect(result.status).toBe("ok");
    if (baseline.status !== "ok" || result.status !== "ok") return;
    const expected = baseline.value.selections.map(
      (selection) => `${namespace}.matt.${selection.item.itemId.slice("mattpocock.".length)}`,
    );
    expect(
      result.value.selections.map((selection) => selection.item.itemId).sort(),
      itemId,
    ).toEqual(["extensions.notices", ...expected].sort());
  }
});
