import { describe, expect, it } from 'vitest';
import { installUuidUtilsCompatibility } from '../../../src/core/engine/editor-extends/uuid-utils-compatibility';

describe('EditorExtends UuidUtils compatibility', () => {
  it('installs aliases required by engine editor runtime code', () => {
    const uuidUtils = {
      compressUUID: () => 'compressed',
      decompressUUID: () => 'decompressed',
      isUUID: () => true,
      generate: () => 'generated',
    };

    installUuidUtilsCompatibility(uuidUtils);

    expect(uuidUtils.compressUuid).toBe(uuidUtils.compressUUID);
    expect(uuidUtils.decompressUuid).toBe(uuidUtils.decompressUUID);
    expect(uuidUtils.isUuid).toBe(uuidUtils.isUUID);
    expect(uuidUtils.uuid).toBe(uuidUtils.generate);
    expect(uuidUtils.uuid()).toBe('generated');
  });
});
