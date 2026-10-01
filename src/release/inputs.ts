/**
 * Core scalar InputSpec rules, applied identically by the portable reader:
 * no coercion, code-point string lengths, safe integers, finite numbers and
 * canonical enum membership. Core repeats these checks and owns binding.
 */
import type { InputSpec, Json } from "./contracts.js";
import { canonicalJson } from "./json.js";

export function inputAccepts(spec: InputSpec, value: unknown): value is Json {
  if (spec.type === "integer" ? !Number.isSafeInteger(value) : typeof value !== spec.type) {
    return false;
  }
  if (typeof value === "string") {
    const length = [...value].length;
    if (spec.minLength !== undefined && length < spec.minLength) return false;
    if (spec.maxLength !== undefined && length > spec.maxLength) return false;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) return false;
    if (spec.minimum !== undefined && value < spec.minimum) return false;
    if (spec.maximum !== undefined && value > spec.maximum) return false;
  }
  return !spec.enum || spec.enum.some((item) => canonicalJson(item) === canonicalJson(value));
}

/** Internal consistency of one definition (Core recipe input semantics). */
export function checkInputSpec(spec: InputSpec): string[] {
  const reasons: string[] = [];
  if (
    (spec.type !== "string" && (spec.minLength !== undefined || spec.maxLength !== undefined)) ||
    ((spec.type === "string" || spec.type === "boolean") &&
      (spec.minimum !== undefined || spec.maximum !== undefined)) ||
    (spec.minLength !== undefined &&
      spec.maxLength !== undefined &&
      spec.minLength > spec.maxLength) ||
    (spec.minimum !== undefined && spec.maximum !== undefined && spec.minimum > spec.maximum)
  ) {
    reasons.push("input-bounds");
  }
  if (
    spec.default !== undefined &&
    (spec.sensitive === true || !inputAccepts(spec, spec.default))
  ) {
    reasons.push("input-default");
  }
  if (spec.enum?.some((value) => !inputAccepts({ ...spec, enum: undefined }, value))) {
    reasons.push("input-enum");
  }
  return reasons;
}
