import { copyFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { findProgram, npmProgram } from "../../src/catalog/internal/acquire.js";
import { folder } from "./helpers.js";

const windows = process.platform === "win32";
const executable = (name: string) => (windows ? `${name}.exe` : name);

/** A folder holding a runnable copy of node under `name`. */
function programFolder(name: string, label: string): string {
  const root = folder({}, label);
  copyFileSync(process.execPath, join(root, executable(name)));
  return root;
}

describe("finding the programs a fetch runs", () => {
  it("returns the absolute path from the first absolute PATH entry holding the program", () => {
    const first = programFolder("tool", "first");
    const second = programFolder("tool", "second");
    const env = { PATH: ["relative-bin", "", first, second].join(delimiter) };
    expect(findProgram("tool", env)).toBe(join(first, executable("tool")));
  });

  it("never resolves through a relative or empty PATH entry, or the current folder", () => {
    const here = programFolder("tool", "here");
    const previous = process.cwd();
    process.chdir(here);
    try {
      expect(findProgram("tool", { PATH: [".", "", "bin"].join(delimiter) })).toBeNull();
      expect(findProgram("tool", {})).toBeNull();
    } finally {
      process.chdir(previous);
    }
  });

  it.runIf(windows)("on Windows, never picks a batch file, which needs a shell", () => {
    const root = folder({ "tool.cmd": "@echo off\r\n", "tool.bat": "@echo off\r\n" }, "batch");
    expect(findProgram("tool", { Path: root })).toBeNull();
  });

  it.runIf(windows)(
    "on Windows, runs npm's own script with node instead of the npm.cmd shim",
    () => {
      const root = folder(
        { "npm.cmd": "@echo off\r\n", "node_modules/npm/bin/npm-cli.js": "" },
        "nodejs",
      );
      copyFileSync(process.execPath, join(root, "node.exe"));
      expect(npmProgram({ Path: root })).toEqual({
        program: join(root, "node.exe"),
        args: [join(root, "node_modules", "npm", "bin", "npm-cli.js")],
      });
      expect(npmProgram({ Path: folder({ "npm.cmd": "" }, "shim-only") })).toBeNull();
    },
  );
});
