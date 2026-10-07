/** Internal: a named acquisition refusal; converted to a diagnostic at the public boundary. */
export class AcquisitionFailure extends Error {
  constructor(
    readonly reason: string,
    readonly path?: string,
  ) {
    super(reason);
  }
}
