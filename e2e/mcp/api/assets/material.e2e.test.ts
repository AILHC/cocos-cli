import { readFile, pathExists } from 'fs-extra';

import { MCPTestClient } from '../../../helpers/mcp-client';
import { createTestProject, E2E_TIMEOUTS, generateTestId } from '../../../helpers/test-utils';

const MUTABLE_PROJECT_ROOT_ENV = 'COCOS_CLI_OFFICIAL_SYNC_MUTABLE_PROJECT_ROOT';
const POLL_TIMEOUT_MS = 30_000;

type Primitive = boolean | number | string;
type PropertyCollection = 'props' | 'defines';

interface MaterialPropertyLocation {
    passIndex: number;
    collection: PropertyCollection;
    name: string;
}

describe('MCP Assets API - Material', () => {
    test('saves, reimports, and persists material edits after restarting the MCP server', async () => {
        const mutableProjectRoot = process.env[MUTABLE_PROJECT_ROOT_ENV];
        if (!mutableProjectRoot) {
            throw new Error(`${MUTABLE_PROJECT_ROOT_ENV} is required for the Material persistence E2E.`);
        }
        if (!await pathExists(mutableProjectRoot)) {
            throw new Error(`Mutable project fixture does not exist: ${mutableProjectRoot}`);
        }

        const testId = generateTestId();
        const testProject = await createTestProject(mutableProjectRoot, `material-persistence-${testId}`);
        const testRootUrl = `db://assets/e2e-official-sync/material-${testId}`;
        const materialName = `material-${testId}`;
        const materialUrl = `${testRootUrl}/${materialName}.mtl`;

        let client: MCPTestClient | null = null;
        let sourcePath = '';
        let assetDeleted = false;

        try {
            client = new MCPTestClient({
                projectPath: testProject.path,
                startTimeout: E2E_TIMEOUTS.BUILD_OPERATION,
            });
            await client.start();

            const createDirectoryResult = await client.callTool('assets-create-asset', {
                options: { target: testRootUrl },
            });
            expect(createDirectoryResult).toMatchObject({ code: 200 });

            const createMaterialResult = await client.callTool('assets-create-asset-by-type', {
                ccType: 'material',
                dirOrUrl: testRootUrl,
                baseName: materialName,
                options: { overwrite: false },
            });
            expect(createMaterialResult).toMatchObject({ code: 200 });

            const infoResult = await client.callTool('assets-query-asset-info', {
                urlOrUUIDOrPath: materialUrl,
            });
            expect(infoResult).toMatchObject({
                code: 200,
                data: {
                    file: expect.any(String),
                    uuid: expect.any(String),
                    imported: true,
                    invalid: false,
                    importer: 'material',
                },
            });

            sourcePath = (infoResult.data as any).file;
            const materialUuid = (infoResult.data as any).uuid as string;
            const sourceBeforeSave = await readFile(sourcePath, 'utf8');
            const queryBeforeSave = await client.callTool('assets-material-query', {
                uuidOrUrlOrPath: materialUrl,
            });
            expect(queryBeforeSave).toMatchObject({ code: 200 });
            expect(queryBeforeSave.data).toBeDefined();

            const editable = findEditablePrimitive(queryBeforeSave.data);
            expect(editable).toBeDefined();
            const savedValue = nextPrimitiveValue(editable!.value);
            editable!.property.value = savedValue;

            const saveResult = await client.callTool('assets-material-save', {
                uuidOrUrlOrPath: materialUrl,
                dump: queryBeforeSave.data as any,
            });
            expect(saveResult).toMatchObject({ code: 200, data: null });

            await waitForCondition('material source change', async () => {
                return (await readFile(sourcePath, 'utf8')) !== sourceBeforeSave;
            });

            await waitForMaterialValue(client, materialUrl, materialUuid, editable!.location, savedValue);

            await client.close();
            client = null;

            client = new MCPTestClient({
                projectPath: testProject.path,
                startTimeout: E2E_TIMEOUTS.BUILD_OPERATION,
            });
            await client.start();

            await waitForMaterialValue(client, materialUrl, materialUuid, editable!.location, savedValue);

            const deleteResult = await client.callTool('assets-delete-asset', {
                dbPath: materialUrl,
            });
            expect(deleteResult).toMatchObject({ code: 200 });

            await waitForCondition('material deletion', async () => {
                const uuidResult = await client!.callTool('assets-query-uuid', {
                    urlOrPath: materialUrl,
                });
                return uuidResult.code === 200
                    && uuidResult.data === ''
                    && !await pathExists(sourcePath)
                    && !await pathExists(`${sourcePath}.meta`);
            });
            assetDeleted = true;

            const deleteDirectoryResult = await client.callTool('assets-delete-asset', {
                dbPath: testRootUrl,
            });
            expect(deleteDirectoryResult).toMatchObject({ code: 200 });
        } finally {
            if (client && !assetDeleted) {
                try {
                    await client.callTool('assets-delete-asset', { dbPath: materialUrl });
                } catch {
                    // Workspace cleanup below is the final isolation boundary.
                }
            }
            await client?.close();
            await testProject.cleanup();
        }
    });
});

function findEditablePrimitive(dump: any): {
    location: MaterialPropertyLocation;
    property: { value: Primitive };
    value: Primitive;
} | undefined {
    const technique = dump?.data?.[dump.technique];
    const candidates: Array<{
        location: MaterialPropertyLocation;
        property: { value: Primitive };
        value: Primitive;
    }> = [];

    for (let passIndex = 0; passIndex < (technique?.passes?.length || 0); passIndex++) {
        const pass = technique.passes[passIndex];
        for (const collection of ['props', 'defines'] as const) {
            for (const property of pass[collection] || []) {
                if (!property.name || property.visible === false || property.readonly === true) {
                    continue;
                }
                if (!['boolean', 'number', 'string'].includes(typeof property.value)) {
                    continue;
                }
                candidates.push({
                    location: { passIndex, collection, name: property.name },
                    property,
                    value: property.value,
                });
            }
        }
    }

    return candidates.find((candidate) => typeof candidate.value === 'boolean') || candidates[0];
}

function nextPrimitiveValue(value: Primitive): Primitive {
    switch (typeof value) {
        case 'boolean':
            return !value;
        case 'number':
            return value + 1;
        case 'string':
            return `${value}-e2e`;
    }
}

function queryLocatedValue(dump: any, location: MaterialPropertyLocation): Primitive | undefined {
    const pass = dump?.data?.[dump.technique]?.passes?.[location.passIndex];
    return pass?.[location.collection]?.find((property: any) => property.name === location.name)?.value;
}

async function waitForMaterialValue(
    client: MCPTestClient,
    materialUrl: string,
    materialUuid: string,
    location: MaterialPropertyLocation,
    expectedValue: Primitive,
): Promise<void> {
    await waitForCondition(`reimported material value ${location.name}`, async () => {
        const infoResult = await client.callTool('assets-query-asset-info', {
            urlOrUUIDOrPath: materialUrl,
        });
        if (infoResult.code !== 200
            || (infoResult.data as any)?.uuid !== materialUuid
            || !(infoResult.data as any)?.imported
            || (infoResult.data as any)?.invalid) {
            return false;
        }

        const queryResult = await client.callTool('assets-material-query', {
            uuidOrUrlOrPath: materialUrl,
        });
        return queryResult.code === 200
            && queryLocatedValue(queryResult.data, location) === expectedValue;
    });
}

async function waitForCondition(
    description: string,
    predicate: () => Promise<boolean>,
    timeoutMs = POLL_TIMEOUT_MS,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;

    while (Date.now() < deadline) {
        try {
            if (await predicate()) {
                return;
            }
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
    throw new Error(`Timed out waiting for ${description}.${detail}`);
}
