import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

// The owning build of the Project basics content; it reads the built dist modules.
const tool = async () =>
  import(
    pathToFileURL(resolve(import.meta.dirname, "../../tools/generate-project-basics-release.mjs"))
      .href
  );

it("fails the build on any placeholder outside the closed list", async () => {
  const { buildProjectBasics, placeholderProblems } = await tool();
  expect(
    placeholderProblems("Run in {projectDir} and {itemDir}, {homeDir}, {pluginRoot}."),
  ).toEqual([]);
  expect(placeholderProblems("See {repoName}, {project_dir} and { projectDir }.")).toEqual([
    "{repoName}",
    "{project_dir}",
    "{ projectDir }",
  ]);
  expect(() =>
    buildProjectBasics({ texts: { "project-basics.router": "# Router for {repoName}\n" } }),
  ).toThrow(/project-basics\.router: unknown placeholder \{repoName\}/);
});

it("fails the build when the rendered text no longer matches the accepted bytes", async () => {
  const { buildProjectBasics } = await tool();
  expect(() =>
    buildProjectBasics({ texts: { "project-basics.working-rules": "# Changed\n" } }),
  ).toThrow(/no longer reproduces the accepted behavior-core bytes/);
});

it("builds the committed content deterministically", async () => {
  const { buildProjectBasics, CONTENT_PATH } = await tool();
  const first = buildProjectBasics();
  const second = buildProjectBasics();
  expect(first.releaseSha256).toBe(second.releaseSha256);
  expect([...first.outputs.keys()]).toContain(CONTENT_PATH);
  expect(first.release.items.map((item: { id: string }) => item.id)).toEqual([
    "project-basics.router",
    "project-basics.shared-block",
    "project-basics.working-rules",
  ]);
});
