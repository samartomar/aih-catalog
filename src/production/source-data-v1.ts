export interface PrepareCatalogSourceDataV1Request {
  readonly sourceId: string;
  readonly sourceBundle: Record<string, unknown>;
  readonly sequence: number;
  readonly previousDigest?: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly updateKind?: "evidence-only";
  readonly qualification?: Record<string, unknown>;
  readonly scanner?: Record<string, unknown>;
}

export interface PreparedCatalogSourceDataV1 {
  readonly version: "workbench-source-data/v1";
  readonly compatibility: "core-workbench-data/v1";
  readonly updateKind?: "evidence-only";
  readonly sequence: number;
  readonly previousDigest: string | null;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly sourceBundle: Record<string, unknown>;
  readonly qualification?: Record<string, unknown>;
  readonly scanner?: Record<string, unknown>;
}

/** Catalog produces unsigned material only; Core retains signing and acceptance authority. */
export function prepareCatalogSourceDataV1(
  request: PrepareCatalogSourceDataV1Request,
): PreparedCatalogSourceDataV1 {
  if (
    typeof request.sourceId !== "string" ||
    request.sourceId.length === 0 ||
    request.sourceBundle === null ||
    typeof request.sourceBundle !== "object" ||
    Array.isArray(request.sourceBundle) ||
    !Number.isSafeInteger(request.sequence) ||
    request.sequence < 0 ||
    !Number.isFinite(Date.parse(request.issuedAt)) ||
    !Number.isFinite(Date.parse(request.expiresAt))
  ) {
    throw new TypeError("invalid Catalog source-data preparation request");
  }
  const sources = request.sourceBundle.sources;
  if (
    sources === null ||
    typeof sources !== "object" ||
    Array.isArray(sources) ||
    Object.keys(sources).join() !== request.sourceId
  ) {
    throw new TypeError("Catalog source-data preparation identity mismatch");
  }
  return {
    version: "workbench-source-data/v1",
    compatibility: "core-workbench-data/v1",
    ...(request.updateKind === undefined ? {} : { updateKind: request.updateKind }),
    sequence: request.sequence,
    previousDigest: request.previousDigest ?? null,
    issuedAt: request.issuedAt,
    expiresAt: request.expiresAt,
    sourceBundle: structuredClone(request.sourceBundle),
    ...(request.qualification === undefined
      ? {}
      : { qualification: structuredClone(request.qualification) }),
    ...(request.scanner === undefined ? {} : { scanner: structuredClone(request.scanner) }),
  };
}
