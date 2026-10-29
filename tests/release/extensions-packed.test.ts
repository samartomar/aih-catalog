import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("configures real Extensions projections and an additional ordinary item through packed public exports", () => {
  const output = execFileSync(
    process.execPath,
    ["tools/verify-extensions-consumer.mjs", "--without-core"],
    {
      cwd: resolve(import.meta.dirname, "../.."),
      encoding: "utf8",
      timeout: 180_000,
    },
  );
  const result = JSON.parse(output);
  // Matt: 81 plugin files plus the 22 files of his pinned in-progress and misc skills.
  expect(result.inventory).toEqual({ extensions: 149, matt: 103 });
  // 172 plus the three tool copies of each of those ten skills.
  expect(result.items).toBe(202);
  expect(result.expansion.itemId).toBe("extensions.extra.security-reference");
  expect(result.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(result.core.status).toBe("not-run");
}, 180_000);
