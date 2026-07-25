/**
 * descriptor 读写与校验的单测(临时 fixture + 真实 fs)。
 * 覆盖:字段校验(starting 缺席 serverUrl、ready 必须带 serverUrl)、
 * tmp+rename 原子发布、半 JSON / 损坏内容读取、identity 形状校验、mcpUrl 推导。
 */
import { existsSync } from 'fs';
import { join } from 'path';
import {
    deriveMcpUrl,
    descriptorPathOf,
    parsePreviewSessionDescriptor,
    parsePreviewSessionIdentity,
    readPreviewSessionDescriptor,
    writePreviewSessionDescriptorAtomic,
} from '../descriptor';
import { resolvePreviewSessionDeps } from '../deps';
import { PREVIEW_SESSION_DESCRIPTOR_TMP_NAME, PREVIEW_SESSION_PROTOCOL_VERSION } from '../constants';
import type { PreviewSessionDescriptor } from '../types';
import { cleanupFixtureRoot, createFixtureRoot, seedClaim } from './helpers';

const fs = resolvePreviewSessionDeps().fs;

describe('parsePreviewSessionDescriptor', () => {
    const base: PreviewSessionDescriptor = {
        sessionId: 's-1',
        projectRoot: '/project',
        pid: 1234,
        state: 'starting',
        protocolVersion: PREVIEW_SESSION_PROTOCOL_VERSION,
        startedAt: '2026-07-24T00:00:00.000Z',
    };

    it('accepts a starting descriptor without serverUrl', () => {
        expect(parsePreviewSessionDescriptor(base)).toEqual(base);
    });

    it('accepts a ready descriptor with serverUrl', () => {
        const ready = { ...base, state: 'ready', serverUrl: 'http://127.0.0.1:7456' };
        expect(parsePreviewSessionDescriptor(ready)).toEqual(ready);
    });

    it('rejects a ready descriptor without serverUrl', () => {
        expect(parsePreviewSessionDescriptor({ ...base, state: 'ready' })).toBeNull();
    });

    it('rejects unknown state / non-integer pid / missing fields', () => {
        expect(parsePreviewSessionDescriptor({ ...base, state: 'closed' })).toBeNull();
        expect(parsePreviewSessionDescriptor({ ...base, pid: 1.5 })).toBeNull();
        expect(parsePreviewSessionDescriptor({ ...base, pid: 0 })).toBeNull();
        expect(parsePreviewSessionDescriptor({ ...base, sessionId: '' })).toBeNull();
        expect(parsePreviewSessionDescriptor('not-an-object')).toBeNull();
        expect(parsePreviewSessionDescriptor(null)).toBeNull();
    });
});

describe('parsePreviewSessionIdentity', () => {
    it('accepts a well-formed identity and rejects malformed ones', () => {
        const identity = {
            sessionId: 's-1',
            projectRoot: '/project',
            state: 'ready',
            protocolVersion: PREVIEW_SESSION_PROTOCOL_VERSION,
            serverUrl: 'http://127.0.0.1:7456',
            mcpUrl: 'http://127.0.0.1:7456/mcp',
            startedAt: '2026-07-24T00:00:00.000Z',
        };
        expect(parsePreviewSessionIdentity(identity)).toEqual(identity);
        expect(parsePreviewSessionIdentity({ ...identity, protocolVersion: '1' })).toBeNull();
        expect(parsePreviewSessionIdentity({ ...identity, mcpUrl: '' })).toBeNull();
        expect(parsePreviewSessionIdentity([])).toBeNull();
    });
});

describe('readPreviewSessionDescriptor / writePreviewSessionDescriptorAtomic', () => {
    let fixtureRoot: string;

    beforeEach(() => {
        fixtureRoot = createFixtureRoot();
    });

    afterEach(() => {
        cleanupFixtureRoot(fixtureRoot);
    });

    it('publishes atomically via tmp+rename and leaves no tmp residue', async () => {
        const { claimDir } = seedClaim(fixtureRoot, { skipDescriptor: true });
        const descriptor: PreviewSessionDescriptor = {
            sessionId: 's-1',
            projectRoot: fixtureRoot,
            pid: 4321,
            state: 'starting',
            protocolVersion: PREVIEW_SESSION_PROTOCOL_VERSION,
            startedAt: '2026-07-24T00:00:00.000Z',
        };
        await writePreviewSessionDescriptorAtomic(fs, claimDir, descriptor);

        expect(existsSync(join(claimDir, PREVIEW_SESSION_DESCRIPTOR_TMP_NAME))).toBe(false);
        const read = await readPreviewSessionDescriptor(fs, claimDir);
        expect(read).toEqual({ ok: true, descriptor });
    });

    it('reports missing descriptor', async () => {
        const { claimDir } = seedClaim(fixtureRoot, { skipDescriptor: true });
        await expect(readPreviewSessionDescriptor(fs, claimDir)).resolves.toEqual({ ok: false, reason: 'missing' });
    });

    it('reports half-written JSON as parse-error', async () => {
        const { claimDir } = seedClaim(fixtureRoot, { rawDescriptor: '{"sessionId":"s-1","pro' });
        await expect(readPreviewSessionDescriptor(fs, claimDir)).resolves.toEqual({ ok: false, reason: 'parse-error' });
    });

    it('reports schema-invalid JSON as invalid-schema', async () => {
        const { claimDir } = seedClaim(fixtureRoot, { rawDescriptor: '{"hello":"world"}' });
        await expect(readPreviewSessionDescriptor(fs, claimDir)).resolves.toEqual({ ok: false, reason: 'invalid-schema' });
    });

    it('descriptorPathOf points inside the claim dir', () => {
        expect(descriptorPathOf('/claim/dir')).toBe(join('/claim/dir', 'descriptor.json'));
    });
});

describe('deriveMcpUrl', () => {
    it('derives mcpUrl from serverUrl and strips trailing slashes', () => {
        expect(deriveMcpUrl('http://127.0.0.1:7456')).toBe('http://127.0.0.1:7456/mcp');
        expect(deriveMcpUrl('http://127.0.0.1:7456/')).toBe('http://127.0.0.1:7456/mcp');
    });
});
