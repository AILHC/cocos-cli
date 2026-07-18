import fs from 'fs-extra';
import ps from 'path';

const previewOutputIntegrityVersion = 1;
const previewOutputIntegritySealName = '.cocos-cli-output-integrity.json';

const previewOutputArtifactNames = [
    'main-record.json',
    'assembly-record.json',
    'import-map.json',
    'resolution-detail-map.json',
    'chunks',
] as const;

interface PreviewOutputIntegritySeal {
    version: number;
    target: 'preview';
}

export type PreviewCachePreparation = 'fresh' | 'trusted' | 'invalidated';

export function getPreviewOutputIntegritySealPath(recordsRoot: string): string {
    return ps.join(recordsRoot, previewOutputIntegritySealName);
}

export function removePreviewOutputIntegritySeal(recordsRoot: string): void {
    fs.removeSync(getPreviewOutputIntegritySealPath(recordsRoot));
    fs.removeSync(`${getPreviewOutputIntegritySealPath(recordsRoot)}.tmp`);
}

export function writePreviewOutputIntegritySeal(recordsRoot: string): void {
    const sealPath = getPreviewOutputIntegritySealPath(recordsRoot);
    const temporaryPath = `${sealPath}.tmp`;
    const seal: PreviewOutputIntegritySeal = {
        version: previewOutputIntegrityVersion,
        target: 'preview',
    };
    fs.ensureDirSync(recordsRoot);
    fs.writeFileSync(temporaryPath, `${JSON.stringify(seal)}\n`, 'utf8');
    fs.renameSync(temporaryPath, sealPath);
}

export function hasValidPreviewOutputIntegritySeal(recordsRoot: string): boolean {
    try {
        const seal = fs.readJsonSync(getPreviewOutputIntegritySealPath(recordsRoot)) as Partial<PreviewOutputIntegritySeal>;
        return seal.version === previewOutputIntegrityVersion && seal.target === 'preview';
    } catch {
        return false;
    }
}

export function assertPreviewOutputIntegritySeal(recordsRoot: string): void {
    if (!hasValidPreviewOutputIntegritySeal(recordsRoot)) {
        throw new Error('Runtime preview programming output is uncommitted or was produced by an incompatible cache version.');
    }
}

export function preparePreviewCacheForLoad(recordsRoot: string): PreviewCachePreparation {
    const artifactPaths = previewOutputArtifactNames.map((name) => ps.join(recordsRoot, name));
    const existingArtifactCount = artifactPaths.filter((artifactPath) => fs.pathExistsSync(artifactPath)).length;
    const sealExists = fs.pathExistsSync(getPreviewOutputIntegritySealPath(recordsRoot));

    if (existingArtifactCount === 0 && !sealExists) {
        return 'fresh';
    }
    if (existingArtifactCount === artifactPaths.length && hasValidPreviewOutputIntegritySeal(recordsRoot)) {
        return 'trusted';
    }

    for (const artifactPath of artifactPaths) {
        fs.removeSync(artifactPath);
        fs.removeSync(`${artifactPath}.tmp`);
    }
    removePreviewOutputIntegritySeal(recordsRoot);
    return 'invalidated';
}

export function assertScriptChunkRegistersUuid(moduleURL: string, code: string, compressedUuid: string): void {
    if (!doesScriptChunkRegisterUuid(code, compressedUuid)) {
        throw new Error(
            `Runtime preview script registration is missing or inconsistent: ${moduleURL} does not register UUID ${compressedUuid}.`,
        );
    }
}

export function doesScriptChunkRegisterUuid(code: string, compressedUuid: string): boolean {
    const escapedUuid = escapeRegExp(compressedUuid);
    const pushPattern = new RegExp(`\\._RF\\.push\\(\\{\\},\\s*(["'])${escapedUuid}\\1\\s*,`);
    const popPattern = /\._RF\.pop\(\)/;
    return pushPattern.test(code) && popPattern.test(code);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
