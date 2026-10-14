import type { ProjectModel } from '../core/model/types';

/** Stable key order; undefined object properties follow JSON's omission rule. */
export function canonicalModelJson(model: ProjectModel): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, canonical(item)]));
    }
    return value;
  };
  return JSON.stringify(canonical(model));
}

/** Deterministic non-cryptographic fingerprint, explicitly named in reports. */
export function modelFingerprint(model: ProjectModel): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(canonicalModelJson(model))) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}
