import { chmodSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { fixtureGitEnvironment } from "./git-environment.js";
import { FixtureRepository } from "./git-fixture.js";

const repositories: FixtureRepository[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const repository of repositories.splice(0)) repository.dispose();
});

it.each([
  false,
  true,
])("confines fixture operations under inherited hook state (failure=%s)", (fail) => {
  const parent = new FixtureRepository();
  repositories.push(parent);
  parent.commit({ "parent.txt": "parent\n" }, "parent");
  parent.git("config", "fixture.marker", "parent");
  const gitDir = join(parent.dir, ".git");
  const snapshot = () => ({
    head: readFileSync(join(gitDir, "HEAD")),
    ref: readFileSync(join(gitDir, "refs/heads/main")),
    index: readFileSync(join(gitDir, "index")),
    config: readFileSync(join(gitDir, "config")),
    objects: readdirSync(join(gitDir, "objects"), { recursive: true }).sort(),
  });
  const before = snapshot();
  for (const [key, value] of Object.entries({
    GIT_DIR: gitDir,
    GIT_WORK_TREE: parent.dir,
    GIT_COMMON_DIR: gitDir,
    GIT_INDEX_FILE: join(gitDir, "index"),
    GIT_OBJECT_DIRECTORY: join(gitDir, "objects"),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(gitDir, "objects"),
    GIT_CONFIG: join(gitDir, "config"),
    GIT_CONFIG_PARAMETERS: "'fixture.injected=parent'",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "fixture.counted",
    GIT_CONFIG_VALUE_0: "parent",
  }))
    vi.stubEnv(key, value);
  try {
    const fixture = new FixtureRepository();
    repositories.push(fixture);
    const head = fixture.commit({ "fixture.txt": "fixture\n" }, "fixture");
    fixture.git("config", "fixture.marker", "fixture");
    expect(fixture.git("rev-parse", "--show-toplevel")).toBe(fixture.dir);
    expect(fixture.git("config", "--get-regexp", "^fixture\\.")).toBe("fixture.marker fixture");
    expect(Buffer.from(fixture.run("show", `${head}:fixture.txt`)).toString()).toBe("fixture\n");
    if (fail) {
      const hook = join(fixture.dir, ".git/hooks/pre-commit");
      writeFileSync(hook, "#!/bin/sh\nexit 1\n");
      chmodSync(hook, 0o755);
      expect(() => fixture.commit({ "refused.txt": "refused\n" }, "refused")).toThrow();
      expect(fixture.git("rev-parse", "HEAD")).toBe(head);
      expect(fixture.git("status", "--porcelain")).toBe("A  refused.txt");
    } else expect(fixture.git("status", "--porcelain")).toBe("");
  } finally {
    vi.unstubAllEnvs();
    expect(snapshot()).toEqual(before);
    expect(parent.git("show", "HEAD:parent.txt")).toBe("parent");
    expect(parent.git("status", "--porcelain")).toBe("");
  }
});

it("preserves hooks explicitly installed inside the fixture", () => {
  const fixture = new FixtureRepository();
  repositories.push(fixture);
  const hook = join(fixture.dir, ".git/hooks/pre-commit");
  writeFileSync(hook, "#!/bin/sh\nprintf 'ran' > hook-ran.txt\n");
  chmodSync(hook, 0o755);
  fixture.commit({ "fixture.txt": "fixture\n" }, "hooked fixture");
  expect(readFileSync(join(fixture.dir, "hook-ran.txt"), "utf8")).toBe("ran");
});

it("removes mixed-case hook environment carriers", () => {
  const keys = [
    "git_dir",
    "Git_Work_Tree",
    "git_common_dir",
    "Git_Index_File",
    "git_object_directory",
    "Git_Alternate_Object_Directories",
    "git_config",
    "Git_Config_Parameters",
    "Git_Config_Count",
    "Git_Config_Key_0",
    "Git_Config_Value_0",
  ];
  for (const key of keys) vi.stubEnv(key, "parent-state");
  const remaining = Object.keys(fixtureGitEnvironment()).map((key) => key.toLowerCase());
  for (const key of keys) expect(remaining).not.toContain(key.toLowerCase());
});
