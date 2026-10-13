import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { compileProducerDeclaration } from "../../src/release/producer.js";
import { configureItem, readRelease, resolveSelections } from "../../src/release/reader.js";

const root = resolve(import.meta.dirname, "../..");
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
      ?.materials.map((material) => material.path),
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
