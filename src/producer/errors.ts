/**
 * A producer refusal is a deliberate, named stop. Nothing is written when one is
 * raised; `reason` is stable for callers and `details` carries bounded context.
 */
export class ProducerRefusal extends Error {
  constructor(
    readonly reason: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(`${reason}: ${message}`);
    this.name = "ProducerRefusal";
  }
}

export const refuse = (
  reason: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never => {
  throw new ProducerRefusal(reason, message, details);
};
