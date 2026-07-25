/**
 * claim 目录命名、解析与枚举的单测(临时 fixture + 真实 fs)。
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { claimInfoFromDir, formatClaimDirName, listPreviewSessionClaims, parseClaimDirName } from '../claim';
import { CLI_TEMP_DIR } from '../constants';
import { resolvePreviewSessionDeps } from '../deps';
import { cleanupFixtureRoot, createFixtureRoot, seedClaim } from './helpers';

const fs = resolvePreviewSessionDeps().fs;

describe('claim dir name', () => {
    it('round-trips sessionId containing dashes and numeric pid', () => {
        const name = formatClaimDirName('11111111-2222-4333-8444-555555555555', 12345);
        expect(name).toBe('preview-session-11111111-2222-4333-8444-555555555555-12345');
        expect(parseClaimDirName(name)).toEqual({
            sessionId: '11111111-2222-4333-8444-555555555555',
            pid: 12345,
        });
    });

    it('rejects names outside the claim pattern', () => {
        expect(parseClaimDirName('preview-session-')).toBeNull();
        expect(parseClaimDirName('preview-session-abc')).toBeNull();
        expect(parseClaimDirName('asset-db')).toBeNull();
        expect(parseClaimDirName('')).toBeNull();
    });

    it('extracts claim info from a full claim dir path', () => {
        const claimDir = join('project', 'temp', 'cli', formatClaimDirName('s-1', 99));
        expect(claimInfoFromDir(claimDir)).toEqual({ claimDir, sessionId: 's-1', pid: 99 });
        expect(claimInfoFromDir(join('project', 'temp', 'cli', 'other'))).toBeNull();
    });
});

describe('listPreviewSessionClaims', () => {
    let fixtureRoot: string;

    beforeEach(() => {
        fixtureRoot = createFixtureRoot();
    });

    afterEach(() => {
        cleanupFixtureRoot(fixtureRoot);
    });

    it('returns an empty list when temp/cli does not exist', async () => {
        await expect(listPreviewSessionClaims(fs, fixtureRoot)).resolves.toEqual([]);
    });

    it('lists only parseable claim directories, ignoring files and other entries', async () => {
        const seeded = seedClaim(fixtureRoot, { sessionId: 's-1', pid: 40001 });
        const cliTemp = join(fixtureRoot, CLI_TEMP_DIR);
        mkdirSync(join(cliTemp, 'asset-db'), { recursive: true });
        writeFileSync(join(cliTemp, 'preview-session-not-a-dir-123'), '{}', 'utf8');
        writeFileSync(join(cliTemp, 'random.txt'), '', 'utf8');

        await expect(listPreviewSessionClaims(fs, fixtureRoot)).resolves.toEqual([
            { claimDir: seeded.claimDir, sessionId: 's-1', pid: 40001 },
        ]);
    });
});
