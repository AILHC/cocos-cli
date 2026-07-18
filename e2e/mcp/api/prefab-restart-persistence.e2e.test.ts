import { copyFile, readFile } from 'fs/promises';
import { join } from 'path';
import { pathExists } from 'fs-extra';

import { MCPTestClient } from '../../helpers/mcp-client';
import { createTestProject, E2E_TIMEOUTS, generateTestId } from '../../helpers/test-utils';

const MUTABLE_PROJECT_ROOT_ENV = 'COCOS_CLI_OFFICIAL_SYNC_MUTABLE_PROJECT_ROOT';
const SOURCE_PREFAB_URL = 'db://assets/resources/test_assets/prefab.prefab';
const SOURCE_PREFAB_RELATIVE_PATH = join('assets', 'resources', 'test_assets', 'prefab.prefab');
const POLL_TIMEOUT_MS = 60_000;

interface LabeledFailure {
    label: string;
    error: unknown;
}

describe('MCP Prefab API - Restart Persistence', () => {
    test('persists prefab component values and node references after restarting the MCP server', async () => {
        const mutableProjectRoot = process.env[MUTABLE_PROJECT_ROOT_ENV]?.trim();
        if (!mutableProjectRoot) {
            throw new Error(`${MUTABLE_PROJECT_ROOT_ENV} is required for the Prefab restart persistence E2E.`);
        }
        if (!await pathExists(mutableProjectRoot)) {
            throw new Error(`Mutable project fixture does not exist: ${mutableProjectRoot}`);
        }

        const fixtureSourcePath = join(mutableProjectRoot, SOURCE_PREFAB_RELATIVE_PATH);
        const fixtureMetaPath = `${fixtureSourcePath}.meta`;
        if (!await pathExists(fixtureSourcePath) || !await pathExists(fixtureMetaPath)) {
            throw new Error(`Mutable project fixture prefab source/meta is missing: ${fixtureSourcePath}`);
        }

        const fixtureSourceBefore = await readFile(fixtureSourcePath);
        const fixtureMetaBefore = await readFile(fixtureMetaPath);
        const testId = generateTestId();
        const testProject = await createTestProject(mutableProjectRoot, `prefab-restart-persistence-${testId}`);
        const testRootUrl = 'db://assets/e2e-official-sync';
        const assetName = `prefab-restart-${testId}.prefab`;
        const assetUrl = `${testRootUrl}/${assetName}`;
        const assetPath = join(testProject.path, 'assets', 'e2e-official-sync', assetName);
        const assetMetaPath = `${assetPath}.meta`;
        const markerName = `Marker-${testId}`;
        const buttonHostName = `ButtonHost-${testId}`;

        let client: MCPTestClient | null = null;
        let clientStarted = false;
        let assetCopied = false;
        let assetDeleted = false;
        let importedUuid = '';
        let bodyFailed = false;
        let bodyFailure: unknown;

        try {
            client = createClient(testProject.path);
            await client.start();
            clientStarted = true;

            const originalUuidResult = await client.callTool('assets-query-uuid', {
                urlOrPath: SOURCE_PREFAB_URL,
            });
            expect(originalUuidResult).toMatchObject({ code: 200, data: expect.any(String) });
            expect(originalUuidResult.data).not.toBe('');
            const originalUuid = originalUuidResult.data;

            const createDirectoryResult = await client.callTool('assets-create-asset', {
                options: { target: testRootUrl },
            });
            if (createDirectoryResult.code !== 200) {
                throw createToolResponseError('assets-create-asset', createDirectoryResult);
            }
            expect(createDirectoryResult.code).toBe(200);

            expect(await pathExists(assetPath)).toBe(false);
            expect(await pathExists(assetMetaPath)).toBe(false);
            await copyFile(join(testProject.path, SOURCE_PREFAB_RELATIVE_PATH), assetPath);
            assetCopied = true;

            const refreshResult = await client.callTool('assets-refresh', {
                dir: testRootUrl,
            });
            if (refreshResult.code !== 200) {
                throw createToolResponseError('assets-refresh', refreshResult);
            }
            expect(refreshResult.code).toBe(200);

            await waitForCondition('copied prefab AssetDB import', async () => {
                const uuidResult = await client!.callTool('assets-query-uuid', {
                    urlOrPath: assetUrl,
                });
                if (uuidResult.code !== 200 || !uuidResult.data || uuidResult.data === originalUuid) {
                    return false;
                }
                importedUuid = uuidResult.data;
                return await pathExists(assetMetaPath);
            });
            expect(importedUuid).not.toBe(originalUuid);
            const sourceBeforeEdit = await readFile(assetPath, 'utf8');

            const openResult = await client.callTool('scene-open', {
                options: {
                    dbURLOrUUID: importedUuid,
                    includeChildren: true,
                    includeComponents: true,
                },
            });
            expect(openResult).toMatchObject({
                code: 200,
                data: {
                    nodeId: expect.any(String),
                    path: expect.any(String),
                    prefab: {
                        asset: {
                            uuid: importedUuid,
                        },
                    },
                },
            });

            const markerResult = await client.callTool('scene-create-node-by-type', {
                options: {
                    path: '',
                    name: markerName,
                    nodeType: 'Empty',
                },
            });
            expect(markerResult).toMatchObject({
                code: 200,
                data: {
                    nodeId: expect.any(String),
                    path: expect.any(String),
                    name: markerName,
                },
            });

            const buttonHostResult = await client.callTool('scene-create-node-by-type', {
                options: {
                    path: '',
                    name: buttonHostName,
                    nodeType: 'Empty',
                },
            });
            expect(buttonHostResult).toMatchObject({
                code: 200,
                data: {
                    nodeId: expect.any(String),
                    path: expect.any(String),
                    name: buttonHostName,
                },
            });

            const addButtonResult = await client.callTool('scene-add-component', {
                addComponentInfo: {
                    nodePath: buttonHostResult.data.path,
                    component: 'cc.Button',
                },
            });
            expect(addButtonResult).toMatchObject({
                code: 200,
                data: {
                    path: expect.any(String),
                    type: 'cc.Button',
                },
            });
            if (!addButtonResult.data) {
                throw new Error('Adding cc.Button returned no component data.');
            }
            const buttonComponentPath = addButtonResult.data.path;

            const setButtonResult = await client.callTool('scene-set-component-property', {
                setPropertyOptions: {
                    componentPath: buttonComponentPath,
                    properties: {
                        interactable: false,
                        target: { uuid: markerResult.data.nodeId },
                    },
                },
            });
            expect(setButtonResult).toMatchObject({ code: 200, data: true });

            const beforeSaveButton = await client.callTool('scene-query-component', {
                component: { componentPath: buttonComponentPath },
            });
            expect(beforeSaveButton).toMatchObject({
                code: 200,
                data: {
                    type: 'cc.Button',
                    properties: {
                        interactable: { value: false },
                    },
                },
            });
            expectNodeReference(beforeSaveButton.data?.properties.target?.value, {
                uuid: markerResult.data.nodeId,
                path: markerResult.data.path,
            });

            const saveResult = await client.callTool('scene-save', {});
            expect(saveResult.code).toBe(200);

            await waitForCondition('saved prefab AssetDB reimport', async () => {
                const [uuidResult, infoResult, sourceAfterSave] = await Promise.all([
                    client!.callTool('assets-query-uuid', { urlOrPath: assetUrl }),
                    client!.callTool('assets-query-asset-info', { urlOrUUIDOrPath: assetUrl }),
                    readFile(assetPath, 'utf8'),
                ]);
                const observation = {
                    uuid: {
                        code: uuidResult.code,
                        value: uuidResult.data ?? null,
                    },
                    info: {
                        code: infoResult.code,
                        uuid: (infoResult.data as any)?.uuid ?? null,
                        imported: (infoResult.data as any)?.imported ?? null,
                        invalid: (infoResult.data as any)?.invalid ?? null,
                    },
                    sourceChangedFromBeforeEdit: sourceAfterSave !== sourceBeforeEdit,
                    includesMarker: sourceAfterSave.includes(markerName),
                    includesButtonHost: sourceAfterSave.includes(buttonHostName),
                };
                const ready = uuidResult.code === 200
                    && uuidResult.data === importedUuid
                    && infoResult.code === 200
                    && (infoResult.data as any)?.uuid === importedUuid
                    && (infoResult.data as any)?.imported === true
                    && (infoResult.data as any)?.invalid === false
                    && observation.sourceChangedFromBeforeEdit
                    && observation.includesMarker
                    && observation.includesButtonHost;
                if (!ready) {
                    throw new Error(`Saved prefab observation not ready: ${JSON.stringify(observation)}`);
                }
                return true;
            });

            await client.close();
            client = null;
            clientStarted = false;

            client = createClient(testProject.path);
            await client.start();
            clientStarted = true;

            const reopenResult = await client.callTool('scene-open', {
                options: {
                    dbURLOrUUID: importedUuid,
                    includeChildren: true,
                    includeComponents: true,
                },
            });
            expect(reopenResult).toMatchObject({
                code: 200,
                data: {
                    nodeId: expect.any(String),
                    path: expect.any(String),
                    prefab: {
                        asset: {
                            uuid: importedUuid,
                        },
                    },
                },
            });

            const persistedMarker = await client.callTool('scene-query-node', {
                options: {
                    path: markerResult.data.path,
                    includeChildren: false,
                    includeComponents: true,
                },
            });
            expect(persistedMarker).toMatchObject({
                code: 200,
                data: {
                    nodeId: expect.any(String),
                    path: markerResult.data.path,
                    name: markerName,
                },
            });

            const persistedButtonHost = await client.callTool('scene-query-node', {
                options: {
                    path: buttonHostResult.data.path,
                    includeChildren: false,
                    includeComponents: true,
                },
            });
            expect(persistedButtonHost).toMatchObject({
                code: 200,
                data: {
                    path: buttonHostResult.data.path,
                    name: buttonHostName,
                },
            });
            expect(persistedButtonHost.data?.components).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: 'cc.Button' }),
            ]));

            const persistedButton = await client.callTool('scene-query-component', {
                component: { componentPath: buttonComponentPath },
            });
            expect(persistedButton).toMatchObject({
                code: 200,
                data: {
                    path: buttonComponentPath,
                    type: 'cc.Button',
                    properties: {
                        interactable: { value: false },
                    },
                },
            });
            expectNodeReference(persistedButton.data?.properties.target?.value, {
                uuid: persistedMarker.data.nodeId,
                path: persistedMarker.data.path,
            });
        } catch (error) {
            bodyFailed = true;
            bodyFailure = error;
        } finally {
            const cleanupFailures: LabeledFailure[] = [];

            if (assetCopied && importedUuid && !assetDeleted) {
                if (!client || !clientStarted) {
                    await collectCleanupFailure(cleanupFailures, 'close inactive MCP client', async () => {
                        await client?.close();
                    });
                    await collectCleanupFailure(cleanupFailures, 'start MCP client for AssetDB cleanup', async () => {
                        client = createClient(testProject.path);
                        await client.start();
                        clientStarted = true;
                    });
                }

                if (client && clientStarted) {
                    try {
                        const closeSceneResult = await client.callTool('scene-close', {});
                        if (closeSceneResult.code !== 200) {
                            cleanupFailures.push({
                                label: 'scene-close returned non-200 during cleanup',
                                error: createToolResponseError('scene-close', closeSceneResult),
                            });
                        }
                    } catch (error) {
                        cleanupFailures.push({ label: 'scene-close threw during cleanup', error });
                    }

                    let deleteSucceeded = false;
                    try {
                        const deleteResult = await client.callTool('assets-delete-asset', {
                            dbPath: assetUrl,
                        });
                        if (deleteResult.code !== 200) {
                            cleanupFailures.push({
                                label: 'assets-delete-asset returned non-200 during cleanup',
                                error: createToolResponseError('assets-delete-asset', deleteResult),
                            });
                        } else {
                            deleteSucceeded = true;
                        }
                    } catch (error) {
                        cleanupFailures.push({ label: 'assets-delete-asset threw during cleanup', error });
                    }

                    if (deleteSucceeded) {
                        await collectCleanupFailure(cleanupFailures, 'poll prefab AssetDB deletion', async () => {
                            await waitForCondition('prefab AssetDB deletion', async () => {
                                const uuidResult = await client!.callTool('assets-query-uuid', {
                                    urlOrPath: assetUrl,
                                });
                                return uuidResult.code === 200
                                    && uuidResult.data === ''
                                    && !await pathExists(assetPath)
                                    && !await pathExists(assetMetaPath);
                            });
                            assetDeleted = true;
                        });
                    }
                } else {
                    cleanupFailures.push({
                        label: 'AssetDB cleanup client unavailable',
                        error: new Error(
                            'AssetDB cleanup client is unavailable; real assets-delete-asset was not executed.',
                        ),
                    });
                }
            }

            await collectCleanupFailure(cleanupFailures, 'close MCP client', async () => {
                await client?.close();
            });
            await collectCleanupFailure(cleanupFailures, 'cleanup isolated E2E workspace', async () => {
                await testProject.cleanup();
            });
            await collectCleanupFailure(cleanupFailures, 'verify mutable fixture prefab source', async () => {
                const fixtureSourceAfter = await readFile(fixtureSourcePath);
                if (!fixtureSourceAfter.equals(fixtureSourceBefore)) {
                    throw new Error(`Mutable fixture prefab source changed: ${fixtureSourcePath}`);
                }
            });
            await collectCleanupFailure(cleanupFailures, 'verify mutable fixture prefab meta', async () => {
                const fixtureMetaAfter = await readFile(fixtureMetaPath);
                if (!fixtureMetaAfter.equals(fixtureMetaBefore)) {
                    throw new Error(`Mutable fixture prefab meta changed: ${fixtureMetaPath}`);
                }
            });

            if (bodyFailed || cleanupFailures.length > 0) {
                throw createDiagnosticError(
                    bodyFailed ? { label: 'prefab restart persistence test body', error: bodyFailure } : undefined,
                    cleanupFailures,
                );
            }
        }
    });
});

function createClient(projectPath: string): MCPTestClient {
    return new MCPTestClient({
        projectPath,
        startTimeout: E2E_TIMEOUTS.BUILD_OPERATION,
    });
}

function createToolResponseError(
    toolName: string,
    result: { code: number; reason?: string; data?: unknown },
): Error {
    const response = JSON.stringify({
        code: result.code,
        reason: result.reason ?? null,
        data: result.data ?? null,
    });
    return new Error(`${toolName} returned a non-200 response: ${response}`);
}

async function collectCleanupFailure(
    failures: LabeledFailure[],
    description: string,
    action: () => Promise<void>,
): Promise<void> {
    try {
        await action();
    } catch (error) {
        failures.push({ label: description, error });
    }
}

function createDiagnosticError(
    bodyFailure: LabeledFailure | undefined,
    cleanupFailures: LabeledFailure[],
): Error {
    const sections = ['Prefab restart persistence failed.'];

    sections.push('=== BODY FAILURE ===');
    sections.push(bodyFailure ? formatFailure(bodyFailure, 1) : '(none)');

    sections.push('=== CLEANUP FAILURES ===');
    if (cleanupFailures.length === 0) {
        sections.push('(none)');
    } else {
        cleanupFailures.forEach((failure, index) => {
            sections.push(formatFailure(failure, index + 1));
        });
    }

    return new Error(sections.join('\n'), {
        cause: {
            body: bodyFailure?.error,
            cleanup: cleanupFailures.map((failure) => failure.error),
        },
    });
}

function formatFailure(failure: LabeledFailure, index: number): string {
    const prefix = `[${index}] label=${failure.label}`;
    if (failure.error instanceof Error) {
        return [
            prefix,
            `name=${failure.error.name}`,
            `message=${failure.error.message}`,
            `stack=${failure.error.stack ?? '(unavailable)'}`,
        ].join('\n');
    }

    return [
        prefix,
        'name=NonErrorFailure',
        `message=${safeStringify(failure.error)}`,
        'stack=(unavailable)',
    ].join('\n');
}

function safeStringify(value: unknown): string {
    try {
        const json = JSON.stringify(value);
        return json === undefined ? String(value) : json;
    } catch {
        return String(value);
    }
}

function expectNodeReference(
    value: unknown,
    expected: { uuid: string; path: string },
): void {
    const reference = value as { uuid?: string; nodeId?: string; path?: string } | null | undefined;
    const referencedUuid = reference?.uuid ?? reference?.nodeId;
    const matchesUuid = Boolean(referencedUuid) && referencedUuid === expected.uuid;
    const matchesPath = Boolean(reference?.path) && reference?.path === expected.path;
    expect(matchesUuid || matchesPath).toBe(true);
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
