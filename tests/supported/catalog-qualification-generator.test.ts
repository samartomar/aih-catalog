import { createHash, generateKeyPairSync } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as sourceApi from "../../src/index.js";

const root = resolve(import.meta.dirname, "../..");
const temporaryRoots: string[] = [];
const inputs = JSON.parse(
  readFileSync(join(root, "defaults/catalog-qualification-inputs-v1.json"), "utf8"),
);

interface GeneratedFiles {
  readonly files: ReadonlyArray<{ readonly path: string; readonly bytes: Buffer }>;
  readonly entries: number;
}
interface Generator {
  checkCatalogQualification(
    root: string,
    options: { full?: boolean; api: typeof sourceApi },
  ): Promise<GeneratedFiles>;
}

async function generator(): Promise<Generator> {
  // @ts-expect-error The maintenance generator is intentionally plain ESM JavaScript.
  return import("../../tools/generate-catalog-qualification.mjs");
}

/** The source API, so this suite never races a concurrent build that cleans `dist/`. */
const check = async (at: string) =>
  (await generator()).checkCatalogQualification(at, { api: sourceApi });

/** A disposable copy of exactly the files the generator reads and publishes. */
function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), "aih-catalog-qualification-"));
  temporaryRoots.push(directory);
  const copy = (path: string) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    cpSync(join(root, path), join(directory, path), { recursive: true });
  };
  for (const path of [
    "package.json",
    "defaults/catalog-qualification-inputs-v1.json",
    inputs.signedCatalogPath,
    inputs.lastAcceptedHeadPath,
    ...inputs.signerRootPaths,
    "defaults/catalog-qualification-v1.json",
    "defaults/signed-catalog-v2.json",
    "defaults/catalog-signer-root.json",
    "defaults/qualification",
  ]) {
    copy(path);
  }
  return directory;
}

const receiptPath = (entryId: string) => `defaults/qualification/receipts/${entryId}.json`;
const NAMED_ENTRY = "agent.aih.governance-quality.core-0-6-2";

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("catalog qualification generator drift gate", () => {
  it("reproduces every committed byte from the committed signed head", async () => {
    const generated = await check(root);
    const committedReceipts = readdirSync(join(root, "defaults/qualification/receipts"));
    expect(generated.entries).toBe(committedReceipts.length);
    const paths = generated.files.map((file) => file.path);
    for (const name of committedReceipts) {
      expect(paths).toContain(`defaults/qualification/receipts/${name}`);
    }
    for (const path of [
      "defaults/catalog-qualification-v1.json",
      "defaults/qualification/receipt-set.json",
      "defaults/signed-catalog-v2.json",
      "defaults/catalog-signer-root.json",
    ]) {
      expect(paths).toContain(path);
    }
    // The shipped copies are the committed originals, byte for byte.
    expect(
      readFileSync(join(root, "defaults/signed-catalog-v2.json")).equals(
        readFileSync(join(root, inputs.signedCatalogPath)),
      ),
    ).toBe(true);
    expect(
      readFileSync(join(root, "defaults/catalog-signer-root.json")).equals(
        readFileSync(join(root, inputs.signerRootPaths[0])),
      ),
    ).toBe(true);
  }, 60_000);

  it("projects exactly the receipts the public emitter produces", async () => {
    const generated = await check(root);
    const signed = JSON.parse(readFileSync(join(root, inputs.signedCatalogPath), "utf8"));
    const emission = {
      catalogSignerRoots: [JSON.parse(readFileSync(join(root, inputs.signerRootPaths[0]), "utf8"))],
      expectedClaims: inputs.expectedClaims,
      lastAccepted: JSON.parse(readFileSync(join(root, inputs.lastAcceptedHeadPath), "utf8")),
      now: inputs.issuedAt,
      replay: { acceptedIdentities: [] },
      signed,
    };
    // Members the projection did not sample, re-emitted independently here.
    for (const entryId of [NAMED_ENTRY, "skill.anthropic.academy-guide"]) {
      const emitted = sourceApi.canonicalQualificationReceiptBytes(
        sourceApi.emitQualificationReceipt({ ...emission, entryId }),
      );
      const projected = generated.files.find((file) => file.path === receiptPath(entryId));
      expect(projected?.bytes.equals(emitted)).toBe(true);
    }
  }, 60_000);

  it("fails on a one-byte receipt change, a stray receipt and a missing receipt", async () => {
    const mutated = fixture();
    const target = join(mutated, receiptPath(NAMED_ENTRY));
    const bytes = readFileSync(target);
    bytes[bytes.length - 3] = bytes[bytes.length - 3] === 0x30 ? 0x31 : 0x30;
    writeFileSync(target, bytes);
    await expect(check(mutated)).rejects.toThrow(`${receiptPath(NAMED_ENTRY)} is stale`);

    const stray = fixture();
    writeFileSync(join(stray, receiptPath("zzz.stray")), "{}\n");
    await expect(check(stray)).rejects.toThrow("is not published by the inputs file");

    const missing = fixture();
    rmSync(join(missing, receiptPath(NAMED_ENTRY)));
    await expect(check(missing)).rejects.toThrow(`${receiptPath(NAMED_ENTRY)} is missing`);
  }, 60_000);

  it("fails when the sidecar or the shipped head copy drift from the inputs", async () => {
    const sidecar = fixture();
    const sidecarPath = join(sidecar, "defaults/catalog-qualification-v1.json");
    writeFileSync(
      sidecarPath,
      readFileSync(sidecarPath, "utf8").replace('"state":"absent"', '"state":"published"'),
    );
    await expect(check(sidecar)).rejects.toThrow("defaults/catalog-qualification-v1.json is stale");

    const head = fixture();
    writeFileSync(
      join(head, "defaults/signed-catalog-v2.json"),
      readFileSync(join(root, "catalog/genesis/signed-catalog-v2.json")),
    );
    await expect(check(head)).rejects.toThrow("defaults/signed-catalog-v2.json is stale");

    // A different fixed issuance instant re-dates every receipt: nothing matches.
    const reissued = fixture();
    const inputsPath = join(reissued, "defaults/catalog-qualification-inputs-v1.json");
    const changed = { ...inputs, issuedAt: "2026-09-22T00:00:01Z" };
    writeFileSync(inputsPath, `${JSON.stringify(changed, null, 2)}\n`);
    await expect(check(reissued)).rejects.toThrow("is stale");
  }, 60_000);

  it("refuses a foreign signer root, claims for another publisher and non-public root material", async () => {
    const foreign = fixture();
    const { publicKey } = generateKeyPairSync("ed25519");
    const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    const fingerprint = createHash("sha256").update(der).digest("hex");
    writeFileSync(
      join(foreign, inputs.signerRootPaths[0]),
      JSON.stringify({
        class: "administrator-ed25519",
        identity: "administrator:test-publisher/never-official",
        keyId: `ed25519:${fingerprint}`,
        publicKeySpkiDerBase64: der.toString("base64"),
        publicKeySpkiSha256: fingerprint,
      }),
    );
    // The head verifier's own refusal: no supplied root signed this head.
    await expect(check(foreign)).rejects.toThrow(/^root$/);

    const publisher = fixture();
    writeFileSync(
      join(publisher, "defaults/catalog-qualification-inputs-v1.json"),
      JSON.stringify({
        ...inputs,
        publisher: { ...inputs.publisher, repository: "someone-else/aih-catalog" },
      }),
    );
    await expect(check(publisher)).rejects.toThrow("claims repository");

    const privateMaterial = fixture();
    const rootPath = join(privateMaterial, inputs.signerRootPaths[0]);
    writeFileSync(
      rootPath,
      JSON.stringify({ ...JSON.parse(readFileSync(rootPath, "utf8")), privateKeyPem: "redacted" }),
    );
    await expect(check(privateMaterial)).rejects.toThrow("non-public material");
  }, 60_000);
});
