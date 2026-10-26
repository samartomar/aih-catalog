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

it("fails the build when a text names a folder or an adapter note", async () => {
  const { buildProjectBasics, folderProblems } = await tool();
  expect(folderProblems("Read `ai-coding/RULE_ROUTER.md` and `adapters/claude.md`.")).toEqual([
    "ai-coding",
    "adapters/",
  ]);
  expect(() =>
    buildProjectBasics({ texts: { "project-basics.working-rules": "# See ai-coding/\n" } }),
  ).toThrow(
    /project-basics\.working-rules: names ai-coding; Project basics text is folder-neutral/,
  );
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

it("keeps the folder-neutral texts on the one authored discipline", async () => {
  const content = await import(
    pathToFileURL(resolve(import.meta.dirname, "../../dist/release/context-content.js")).href
  );
  const tail = (text: string, from: string) => text.slice(text.indexOf(from));
  expect(tail(content.projectBasicsSharedBlock(), "## Working agreement")).toBe(
    tail(content.sharedBlockBody(), "## Working agreement"),
  );
  expect(tail(content.projectBasicsWorkingRulesDoc(), "## 1.")).toBe(
    tail(content.behaviorCoreDoc(), "## 1."),
  );
  expect(tail(content.projectBasicsRouterDoc(), "## External action boundary")).not.toContain(
    "ai-coding",
  );
});
