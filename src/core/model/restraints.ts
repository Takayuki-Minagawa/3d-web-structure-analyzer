import type { DofName, Restraint } from './types';

/** Nodal DOF names in global DOF order. */
export const DOF_NAMES: readonly DofName[] = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'];

export type RestraintPresetName = 'free' | 'pin' | 'roller-z' | 'fixed';

export const FREE_RESTRAINT: Readonly<Restraint> = Object.freeze({
  ux: false, uy: false, uz: false, rx: false, ry: false, rz: false,
});
export const PINNED_RESTRAINT: Readonly<Restraint> = Object.freeze({
  ux: true, uy: true, uz: true, rx: false, ry: false, rz: false,
});
export const FIXED_RESTRAINT: Readonly<Restraint> = Object.freeze({
  ux: true, uy: true, uz: true, rx: true, ry: true, rz: true,
});
export const ROLLER_Z_RESTRAINT: Readonly<Restraint> = Object.freeze({
  ux: false, uy: false, uz: true, rx: false, ry: false, rz: false,
});

const PRESETS: ReadonlyArray<[RestraintPresetName, Readonly<Restraint>]> = [
  ['fixed', FIXED_RESTRAINT],
  ['pin', PINNED_RESTRAINT],
  ['roller-z', ROLLER_Z_RESTRAINT],
  ['free', FREE_RESTRAINT],
];

/** Six values of a per-DOF record in global DOF order. */
export function dofValues<T>(record: Readonly<Record<DofName, T>>): T[] {
  return DOF_NAMES.map((dof) => record[dof]);
}

/** Name of the support preset matching `restraint`, or null for a custom mix. */
export function restraintPresetName(restraint: Readonly<Restraint>): RestraintPresetName | null {
  for (const [name, preset] of PRESETS) {
    if (DOF_NAMES.every((dof) => restraint[dof] === preset[dof])) return name;
  }
  return null;
}

/** A fresh restraint for a preset name, or null when the name is not a preset. */
export function restraintFromPreset(name: string): Restraint | null {
  const preset = PRESETS.find(([presetName]) => presetName === name);
  return preset ? { ...preset[1] } : null;
}
