import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { getFixturePaths } from '@shared/fixture-paths';
import { createRuntimePreviewContext } from '@runtime-preview/context/runtime-preview-context';
import { resolveLibraryRequest } from '@runtime-preview/library/resolve-library-request';
import { resolveProgrammingRequest } from '@runtime-preview/programming/resolve-programming-request';

describe('runtime preview on-demand resolvers', () => {
  it('does not scan artifacts at startup and only resolves fact-backed safe requests', async () => {
    const paths = getFixturePaths();
    const context = createRuntimePreviewContext({
      projectRoot: paths.projectRoot,
      engineRoot: paths.engineRoot,
      projectLibraryRoot: paths.editorLibraryRef,
      projectProgrammingRoot: join(paths.editorProgrammingRef, 'programming'),
    });

    expect(context.startupStrategy).toBe('lazy');
    expect(context.preloadedLibraryFileCount).toBe(0);

    await expect(resolveLibraryRequest(context, '/../secret.json')).resolves.toBeNull();
    await expect(resolveLibraryRequest(context, '/not-captured-route/file.json')).resolves.toBeNull();

    const programming = await resolveProgrammingRequest(context, '/scripting/x/packer-driver/targets/preview/import-map.json');
    expect(programming?.absolutePath.replace(/\\/g, '/')).toMatch(/\/programming\/packer-driver\/targets\/preview\/import-map\.json$/);
  });
});
