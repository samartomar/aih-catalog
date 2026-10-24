import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const archive = process.env.AIHQ_SCAN_FIXTURE_ARCHIVE;
const digest = process.env.AIHQ_SCAN_FIXTURE_SHA256;

// Supply an exact reviewed candidate before the pinned registry version exists.
it.skipIf(!archive)(
  "reads Scan's schema-adjacent cases and refuses schema-valid artifact corruption",
  () => {
    if (!digest) throw new Error("AIHQ_SCAN_FIXTURE_SHA256 is required with the archive");
    const root = resolve(import.meta.dirname, "../..");
    const output = execFileSync(
      process.execPath,
      [
        resolve(root, "tools/check-pinned-scan-fixtures.mjs"),
        "--archive",
        archive as string,
        "--sha256",
        digest,
      ],
      { cwd: root, encoding: "utf8", timeout: 240_000, windowsHide: true },
    );
    expect(JSON.parse(output)).toMatchObject({
      status: "checked",
      contracts: 7,
      cases: 14,
      artifacts: 2,
      schemaValidReaderRefusals: 1,
      archiveSha256: digest,
    });
  },
  250_000,
);
