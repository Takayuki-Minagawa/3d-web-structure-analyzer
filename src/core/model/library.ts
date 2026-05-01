import type { Material, Section } from './types';

export type MaterialPreset = Omit<Material, 'id'>;
export type SectionPreset = Omit<Section, 'id' | 'materialId'>;

export const MATERIAL_PRESETS: MaterialPreset[] = [
  { name: 'Steel SS400', E: 20500, G: 7900, nu: 0.3, expansion: 0.000012 },
  { name: 'Concrete Fc24', E: 2400, G: 1000, nu: 0.2, expansion: 0.00001 },
  { name: 'Timber C24', E: 1100, G: 70, nu: 0.35, expansion: 0.000005 },
  { name: 'Aluminum A6061', E: 6900, G: 2600, nu: 0.33, expansion: 0.000023 },
];

export const SECTION_PRESETS: SectionPreset[] = [
  { name: 'H-200x100', A: 27.16, Ix: 134, Iy: 1840, Iz: 134, ky: 0, kz: 0 },
  { name: 'H-300x150', A: 46.78, Ix: 508, Iy: 7210, Iz: 508, ky: 0, kz: 0 },
  { name: 'Box-200x200x9', A: 67.5, Ix: 2890, Iy: 4080, Iz: 4080, ky: 0, kz: 0 },
  { name: 'Pipe-216.3x8.2', A: 53.6, Ix: 544, Iy: 2790, Iz: 2790, ky: 0, kz: 0 },
  { name: 'Rect-30x45', A: 1350, Ix: 0, Iy: 227812.5, Iz: 101250, ky: 0, kz: 0 },
];
