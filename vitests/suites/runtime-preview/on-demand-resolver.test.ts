import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { getFixturePaths } from '@shared/fixture-paths';
import { createRuntimePreviewContext } from '@runtime-preview/context/runtime-preview-context';
import { resolveLibraryRequest } from '@runtime-preview/library/resolve-library-request';
import { resolveProgrammingRequest } from '@runtime-preview/programming/resolve-programming-request';

async function createLibraryFile(root: string, relativePath: string, content = '{}'): Promise<string> {
  const absolutePath = join(root, ...relativePath.split('/'));
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
  return absolutePath;
}

async function createResolverFixture() {
  const root = await mkdtemp(join(tmpdir(), 'runtime-preview-resolver-'));
  const projectLibraryRoot = join(root, 'project-library');
  const extensionLibraryRoot = join(root, 'extension-library');
  const internalLibraryRoot = join(root, 'internal-library');
  await mkdir(projectLibraryRoot, { recursive: true });
  await mkdir(extensionLibraryRoot, { recursive: true });
  await mkdir(internalLibraryRoot, { recursive: true });
  const context = createRuntimePreviewContext({
    projectRoot: root,
    engineRoot: join(root, 'engine'),
    projectLibraryRoot,
    extensionLibraryRoots: [{ name: 'view-state-group', root: extensionLibraryRoot }],
    internalLibraryRoot,
    projectProgrammingRoot: join(root, 'temp', 'cli', 'programming'),
  });
  return { root, projectLibraryRoot, extensionLibraryRoot, internalLibraryRoot, context };
}

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

  it('serves non-general import requests by tail from project library root', async () => {
    const { context, projectLibraryRoot } = await createResolverFixture();
    await createLibraryFile(projectLibraryRoot, '20/207a3957-d7e1-4fdb-8903-c63948195ada@f9941.json', '{"ok":true}');

    const resolved = await resolveLibraryRequest(
      context,
      '/assets/product/import/20/207a3957-d7e1-4fdb-8903-c63948195ada@f9941.json',
    );

    expect(resolved?.absolutePath).toBe(join(projectLibraryRoot, '20', '207a3957-d7e1-4fdb-8903-c63948195ada@f9941.json'));
  });

  it('serves extension library roots without deriving cli-extensions path in resolver', async () => {
    const { context, extensionLibraryRoot } = await createResolverFixture();
    await createLibraryFile(extensionLibraryRoot, 'aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json', '{"extension":true}');

    const resolved = await resolveLibraryRequest(
      context,
      '/assets/view-state-group/import/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json',
    );

    expect(resolved?.absolutePath).toBe(join(extensionLibraryRoot, 'aa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json'));
  });

  it('serves remote native requests by tail from explicit library roots', async () => {
    const { context, projectLibraryRoot, internalLibraryRoot } = await createResolverFixture();
    await createLibraryFile(projectLibraryRoot, 'cc/cccccccc-cccc-4ccc-8ccc-cccccccccccc/texture.png', 'project-native');
    await createLibraryFile(internalLibraryRoot, 'dd/dddddddd-dddd-4ddd-8ddd-dddddddddddd/font.ttf', 'internal-native');

    const projectResolved = await resolveLibraryRequest(
      context,
      '/remote/product/native/cc/cccccccc-cccc-4ccc-8ccc-cccccccccccc/texture.png',
    );
    const internalResolved = await resolveLibraryRequest(
      context,
      '/remote/internal/native/dd/dddddddd-dddd-4ddd-8ddd-dddddddddddd/font.ttf',
    );

    expect(projectResolved?.absolutePath).toBe(join(projectLibraryRoot, 'cc', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'texture.png'));
    expect(internalResolved?.absolutePath).toBe(join(internalLibraryRoot, 'dd', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'font.ttf'));
  });

  it('does not map namespace or artifact kind into the physical path', async () => {
    const { context, projectLibraryRoot } = await createResolverFixture();
    await createLibraryFile(projectLibraryRoot, 'bb/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.json', '{"ok":true}');

    const resolved = await resolveLibraryRequest(
      context,
      '/assets/resources/import/bb/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.json',
    );

    expect(resolved?.absolutePath).toBe(join(projectLibraryRoot, 'bb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.json'));
  });

  it('serves canonical root library artifacts generated from empty engine bases', async () => {
    const { context, projectLibraryRoot, internalLibraryRoot } = await createResolverFixture();
    const jsonTail = '97/970b0598-bcb0-4714-91fb-2e81440dccd8.json';
    const subAssetTail = '21/21a3957d-d7e1-4fdb-8903-c63948195ada@b47c0@40c10.bin';
    const versionedNativeTail = 'cc/cccccccc-cccc-4ccc-8ccc-cccccccccccc.a12bc.png';
    const ttfTail = 'dd/dddddddd-dddd-4ddd-8ddd-dddddddddddd.9a8b7/font.ttf';
    await createLibraryFile(projectLibraryRoot, jsonTail, '{"root":true}');
    await createLibraryFile(projectLibraryRoot, subAssetTail, 'subasset');
    await createLibraryFile(projectLibraryRoot, versionedNativeTail, 'native');
    await createLibraryFile(internalLibraryRoot, ttfTail, 'font');

    await expect(resolveLibraryRequest(context, `/${jsonTail}`)).resolves.toEqual({
      absolutePath: join(projectLibraryRoot, ...jsonTail.split('/')),
    });
    await expect(resolveLibraryRequest(context, `/${subAssetTail}`)).resolves.toEqual({
      absolutePath: join(projectLibraryRoot, ...subAssetTail.split('/')),
    });
    await expect(resolveLibraryRequest(context, `/${versionedNativeTail}`)).resolves.toEqual({
      absolutePath: join(projectLibraryRoot, ...versionedNativeTail.split('/')),
    });
    await expect(resolveLibraryRequest(context, `/${ttfTail}`)).resolves.toEqual({
      absolutePath: join(internalLibraryRoot, ...ttfTail.split('/')),
    });
  });

  it('keeps canonical root library requests inside the engine URL contract', async () => {
    const { context, projectLibraryRoot } = await createResolverFixture();
    const wrongShard = 'aa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.json';
    const arbitraryFile = 'aa/arbitrary.json';
    const arbitraryNestedFile = 'aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/texture.png';
    const nonTtfNestedFile = 'aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/__original-animation-0.cconb';
    const rootMetadata = '.internal-data.json';
    for (const tail of [wrongShard, arbitraryFile, arbitraryNestedFile, nonTtfNestedFile, rootMetadata]) {
      await createLibraryFile(projectLibraryRoot, tail, 'must-not-be-served');
    }

    await expect(resolveLibraryRequest(context, `/${wrongShard}`)).resolves.toBeNull();
    await expect(resolveLibraryRequest(context, `/${arbitraryFile}`)).resolves.toBeNull();
    await expect(resolveLibraryRequest(context, `/${arbitraryNestedFile}`)).resolves.toBeNull();
    await expect(resolveLibraryRequest(context, `/${nonTtfNestedFile}`)).resolves.toBeNull();
    await expect(resolveLibraryRequest(context, `/${rootMetadata}`)).resolves.toBeNull();
    await expect(resolveLibraryRequest(context, '/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/%2e%2e/secret.ttf')).resolves.toBeNull();
    await expect(resolveLibraryRequest(context, '/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa%5cfont.ttf')).resolves.toBeNull();
  });

  it('does not enter library file lookup for import or native base URLs', async () => {
    const { context } = await createResolverFixture();

    await expect(resolveLibraryRequest(context, '/assets/general/import/')).resolves.toBeNull();
    await expect(resolveLibraryRequest(context, '/assets/general/native/')).resolves.toBeNull();
  });

  it('uses allowed request paths only when capture mode provides them', async () => {
    const { context, projectLibraryRoot } = await createResolverFixture();
    const allowedRoute = '/assets/general/import/ee/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json';
    const uncapturedRoute = '/assets/general/import/ff/ffffffff-ffff-4fff-8fff-ffffffffffff.json';
    await createLibraryFile(projectLibraryRoot, 'ee/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json', '{"allowed":true}');
    await createLibraryFile(projectLibraryRoot, 'ff/ffffffff-ffff-4fff-8fff-ffffffffffff.json', '{"uncaptured":true}');

    await expect(resolveLibraryRequest(context, allowedRoute, {
      allowedRequestPaths: [allowedRoute],
    })).resolves.toEqual({
      absolutePath: join(projectLibraryRoot, 'ee', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json'),
    });
    await expect(resolveLibraryRequest(context, uncapturedRoute, {
      allowedRequestPaths: [allowedRoute],
    })).resolves.toBeNull();
    await expect(resolveLibraryRequest(context, uncapturedRoute)).resolves.toEqual({
      absolutePath: join(projectLibraryRoot, 'ff', 'ffffffff-ffff-4fff-8fff-ffffffffffff.json'),
    });
  });

  it('applies the captured URL allowlist exactly to canonical root requests', async () => {
    const { context, projectLibraryRoot } = await createResolverFixture();
    const allowedRoute = '/ee/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json';
    const uncapturedRoute = '/ff/ffffffff-ffff-4fff-8fff-ffffffffffff.json';
    await createLibraryFile(projectLibraryRoot, allowedRoute.slice(1), '{"allowed":true}');
    await createLibraryFile(projectLibraryRoot, uncapturedRoute.slice(1), '{"uncaptured":true}');

    await expect(resolveLibraryRequest(context, allowedRoute, {
      allowedRequestPaths: [allowedRoute],
    })).resolves.toEqual({
      absolutePath: join(projectLibraryRoot, 'ee', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json'),
    });
    await expect(resolveLibraryRequest(context, uncapturedRoute, {
      allowedRequestPaths: [allowedRoute],
    })).resolves.toBeNull();
  });

  it('rejects decoded traversal, backslash, drive, and absolute tails', async () => {
    const { context, projectLibraryRoot } = await createResolverFixture();
    await createLibraryFile(projectLibraryRoot, 'secret.json', '{"secret":true}');

    await expect(resolveLibraryRequest(context, '/assets/general/import/%2e%2e/secret.json')).resolves.toBeNull();
    await expect(resolveLibraryRequest(context, '/assets/general/import/a/../secret.json')).resolves.toBeNull();
    await expect(resolveLibraryRequest(context, '/assets/general/import/a/%2e%2e/secret.json')).resolves.toBeNull();
    await expect(resolveLibraryRequest(context, '/assets/general/import/./secret.json')).resolves.toBeNull();
    await expect(resolveLibraryRequest(context, '/assets/general/import/20%5csecret.json')).resolves.toBeNull();
    await expect(resolveLibraryRequest(context, '/assets/general/import/C%3a/secret.json')).resolves.toBeNull();
    await expect(resolveLibraryRequest(context, '/assets/general/import/%2fsecret.json')).resolves.toBeNull();
  });
});
