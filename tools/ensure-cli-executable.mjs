import { chmodSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cli = resolve(root, "dist", "cli.js");
if (!readFileSync(cli, "utf8").startsWith("#!/usr/bin/env node\n"))
  throw new Error("cli-shebang-missing");
if (process.platform !== "win32") chmodSync(cli, 0o755);
