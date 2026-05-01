import { describe, expect, it } from 'vitest';
import { MATERIAL_PRESETS, SECTION_PRESETS } from '../../core/model/library';

describe('model library presets', () => {
  it('provides usable material presets', () => {
    expect(MATERIAL_PRESETS.length).toBeGreaterThan(0);
    for (const preset of MATERIAL_PRESETS) {
      expect(preset.name).not.toBe('');
      expect(preset.E).toBeGreaterThan(0);
      expect(preset.G).toBeGreaterThan(0);
      expect(preset.nu).toBeGreaterThanOrEqual(0);
    }
  });

  it('provides usable section presets', () => {
    expect(SECTION_PRESETS.length).toBeGreaterThan(0);
    for (const preset of SECTION_PRESETS) {
      expect(preset.name).not.toBe('');
      expect(preset.A).toBeGreaterThan(0);
      expect(preset.Ix).toBeGreaterThanOrEqual(0);
      expect(preset.Iy).toBeGreaterThan(0);
      expect(preset.Iz).toBeGreaterThan(0);
    }
  });
});
