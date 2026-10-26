/** Release views this package's readers produced. Other operations accept nothing else. */
export const checkedReleases = new WeakSet<object>();
/** A view carrying attached sets, mapped to the checked release it extends. */
export const extendedReleases = new WeakMap<object, object>();
