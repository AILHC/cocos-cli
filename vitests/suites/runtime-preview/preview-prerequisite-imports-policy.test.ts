import { describe, expect, it } from 'vitest';
import { shouldUseTentativePrerequisiteImportsMod } from '../../../src/core/scripting/packer-driver/target-policy';

describe('runtime preview prerequisite imports policy', () => {
  it('uses tentative dynamic imports for preview target to avoid loading all chunks at once', () => {
    expect(shouldUseTentativePrerequisiteImportsMod('preview', { isEditor: false })).toBe(true);
  });

  it('keeps editor target tentative behavior', () => {
    expect(shouldUseTentativePrerequisiteImportsMod('editor', { isEditor: true })).toBe(true);
  });
});
