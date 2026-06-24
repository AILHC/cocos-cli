import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { ensureDir, pathExists, readJSON, writeJSON } from 'fs-extra';

describe('asset-db sidecar bootstrap', () => {
    async function makeEditorLibraryFixture() {
        const root = await mkdtemp(join(tmpdir(), 'asset-db-sidecar-bootstrap-'));
        const target = join(root, 'assets');
        const library = join(root, 'library');
        await ensureDir(target);
        await ensureDir(library);

        await writeJSON(join(library, '.assets-info1.0.0.json'), {
            version: '1.0.0',
            map: {
                [join(target, 'a.scene')]: {
                    time: 1,
                    uuid: 'uuid-a',
                },
            },
            missing: {},
        }, { spaces: 2 });

        await writeJSON(join(library, '.assets-data.json'), {
            'uuid-a': {
                importer: 'scene',
                versionCode: 1,
                value: { depends: [] },
            },
        }, { spaces: 2 });

        await writeJSON(join(library, '.assets-dependency.json'), {
            path: {
                [join(target, 'a.scene')]: [
                    join(target, 'dep.ts'),
                ],
            },
            uuid: {
                [join(target, 'a.scene')]: [
                    'uuid-dep',
                ],
            },
        }, { spaces: 2 });

        return {
            root,
            target,
            library,
            records: {
                info: join(library, '.cli-assets-info.json'),
                data: join(library, '.cli-assets-data.json'),
                dependency: join(library, '.cli-assets-dependency.json'),
                cache: join(library, '.cli-assets'),
            },
        };
    }

    it('creates CLI sidecar records from Editor records without mutating Editor records', async () => {
        const fixture = await makeEditorLibraryFixture();
        try {
            const { bootstrapAssetsSidecarRecords } = require('../asset-db-sidecar-bootstrap') as typeof import('../asset-db-sidecar-bootstrap');

            await bootstrapAssetsSidecarRecords({
                target: fixture.target,
                library: fixture.library,
                records: fixture.records,
            });

            expect(await pathExists(fixture.records.info)).toBe(true);
            expect(await pathExists(fixture.records.data)).toBe(true);
            expect(await pathExists(fixture.records.dependency)).toBe(true);
            expect(await pathExists(fixture.records.cache)).toBe(true);

            const cliDependency = await readJSON(fixture.records.dependency);
            expect(cliDependency).toEqual({
                data: {
                    path: {
                        'a.scene': [
                            'dep.ts',
                        ],
                    },
                    uuid: {
                        'a.scene': [
                            'uuid-dep',
                        ],
                    },
                },
                version: '1.0.0',
            });
            const cliInfo = await readJSON(fixture.records.info);
            expect(cliInfo.version).toBe('1.0.1');
            expect(cliInfo.missing).toEqual({});
            expect(cliInfo.map['a.scene'].uuid).toBe('uuid-a');

            const editorInfo = await readJSON(join(fixture.library, '.assets-info1.0.0.json'));
            expect(editorInfo.version).toBe('1.0.0');
            expect(editorInfo.map[join(fixture.target, 'a.scene')].uuid).toBe('uuid-a');
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });
});
