/**
 * liveness 验活分级的单测(临时 fixture + fake process table + fake identity fetcher)。
 * 覆盖六级 + draining 瞬态,以及 descriptor 缺失时基于目录名 pid 的判读。
 */
import { probePreviewSessionClaim } from '../liveness';
import { PREVIEW_SESSION_PROTOCOL_VERSION } from '../constants';
import { writePreviewSessionDescriptorAtomic } from '../descriptor';
import { resolvePreviewSessionDeps } from '../deps';
import {
    buildIdentity,
    cleanupFixtureRoot,
    createFakeProcessControl,
    createFixtureRoot,
    createProjectFixture,
    seedClaim,
} from './helpers';

describe('probePreviewSessionClaim', () => {
    let fixtureRoot: string;
    let projectRoot: string;

    beforeEach(() => {
        fixtureRoot = createFixtureRoot();
        projectRoot = createProjectFixture(fixtureRoot);
    });

    afterEach(() => {
        cleanupFixtureRoot(fixtureRoot);
    });

    it('classifies a dead owner as confirmed-dead without probing the endpoint', async () => {
        const { claimDir } = seedClaim(projectRoot, { pid: 40001 });
        const table = createFakeProcessControl([]);
        const fetchIdentity = jest.fn().mockResolvedValue(null);

        const probe = await probePreviewSessionClaim(claimDir, {
            processControl: table.control,
            fetchIdentity,
        });

        expect(probe.liveness).toBe('confirmed-dead');
        expect(fetchIdentity).not.toHaveBeenCalled();
    });

    it('classifies a live pid with state starting as starting and never probes the endpoint', async () => {
        const { claimDir } = seedClaim(projectRoot, { pid: 40002, state: 'starting' });
        const table = createFakeProcessControl([40002]);
        const fetchIdentity = jest.fn().mockResolvedValue(null);

        const probe = await probePreviewSessionClaim(claimDir, {
            processControl: table.control,
            fetchIdentity,
        });

        expect(probe.liveness).toBe('starting');
        expect(fetchIdentity).not.toHaveBeenCalled();
    });

    it('classifies a live pid with state draining as draining', async () => {
        const { claimDir } = seedClaim(projectRoot, { pid: 40003, state: 'draining' });
        const table = createFakeProcessControl([40003]);

        const probe = await probePreviewSessionClaim(claimDir, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        expect(probe.liveness).toBe('draining');
    });

    it('treats a missing descriptor with a live pid as starting (publish window)', async () => {
        const { claimDir } = seedClaim(projectRoot, { pid: 40004, skipDescriptor: true });
        const table = createFakeProcessControl([40004]);

        const probe = await probePreviewSessionClaim(claimDir, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        expect(probe.liveness).toBe('starting');
        expect(probe.descriptorError).toBe('missing');
    });

    it('treats a missing descriptor with a dead pid as confirmed-dead', async () => {
        const { claimDir } = seedClaim(projectRoot, { pid: 40005, skipDescriptor: true });
        const table = createFakeProcessControl([]);

        const probe = await probePreviewSessionClaim(claimDir, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        expect(probe.liveness).toBe('confirmed-dead');
    });

    it('classifies a corrupted descriptor with a live pid as invalid-owner-alive', async () => {
        const { claimDir } = seedClaim(projectRoot, { pid: 40006, rawDescriptor: '{"sessionId":' });
        const table = createFakeProcessControl([40006]);

        const probe = await probePreviewSessionClaim(claimDir, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        // 损坏不能证明该进程不是仍在写项目的 owner:fail closed。
        expect(probe.liveness).toBe('invalid-owner-alive');
        expect(probe.descriptorError).toBe('parse-error');
    });

    it('classifies a corrupted descriptor with a dead pid as invalid', async () => {
        const { claimDir } = seedClaim(projectRoot, { pid: 40006, rawDescriptor: '{"sessionId":' });
        const table = createFakeProcessControl([]);

        const probe = await probePreviewSessionClaim(claimDir, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        expect(probe.liveness).toBe('invalid');
        expect(probe.descriptorError).toBe('parse-error');
    });

    it('classifies a descriptor that does not match the claim name as invalid-owner-alive when the pid is alive', async () => {
        // 目录名里的 sessionId/pid 与 descriptor 不一致:descriptor 无效。
        const { claimDir } = seedClaim(projectRoot, { pid: 40007 });
        const table = createFakeProcessControl([40007]);
        const fs = resolvePreviewSessionDeps().fs;
        await writePreviewSessionDescriptorAtomic(fs, claimDir, {
            sessionId: 'someone-else',
            projectRoot,
            pid: 99999,
            state: 'starting',
            protocolVersion: PREVIEW_SESSION_PROTOCOL_VERSION,
            startedAt: '2026-07-24T00:00:00.000Z',
        });

        const probe = await probePreviewSessionClaim(claimDir, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        expect(probe.liveness).toBe('invalid-owner-alive');
        expect(probe.descriptorError).toBe('descriptor-claim-mismatch');
    });

    it('classifies a descriptor that does not match the claim name as invalid when the pid is dead', async () => {
        const { claimDir } = seedClaim(projectRoot, { pid: 40007 });
        const table = createFakeProcessControl([]);
        const fs = resolvePreviewSessionDeps().fs;
        await writePreviewSessionDescriptorAtomic(fs, claimDir, {
            sessionId: 'someone-else',
            projectRoot,
            pid: 99999,
            state: 'starting',
            protocolVersion: PREVIEW_SESSION_PROTOCOL_VERSION,
            startedAt: '2026-07-24T00:00:00.000Z',
        });

        const probe = await probePreviewSessionClaim(claimDir, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        expect(probe.liveness).toBe('invalid');
        expect(probe.descriptorError).toBe('descriptor-claim-mismatch');
    });

    it('classifies a descriptor protocol version mismatch as live-incompatible before any endpoint probe', async () => {
        // 旧 schema/404 + descriptor 版本不匹配:绝不落入 unreachable-owner-alive。
        const seeded = seedClaim(projectRoot, {
            pid: 40013,
            protocolVersion: PREVIEW_SESSION_PROTOCOL_VERSION + 1,
        });
        const table = createFakeProcessControl([40013]);
        const fetchIdentity = jest.fn().mockResolvedValue(null);

        const probe = await probePreviewSessionClaim(seeded.claimDir, {
            processControl: table.control,
            fetchIdentity,
        });

        expect(probe.liveness).toBe('live-incompatible');
        expect(fetchIdentity).not.toHaveBeenCalled();
    });

    it('never reports live-compatible when the descriptor version mismatches even if identity matches', async () => {
        const seeded = seedClaim(projectRoot, {
            pid: 40014,
            protocolVersion: PREVIEW_SESSION_PROTOCOL_VERSION + 1,
        });
        const table = createFakeProcessControl([40014]);

        const probe = await probePreviewSessionClaim(seeded.claimDir, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(buildIdentity({
                sessionId: seeded.sessionId,
                projectRoot,
            })),
        });

        // live-compatible 要求 descriptor 与 identity 的版本都与本地一致。
        expect(probe.liveness).toBe('live-incompatible');
    });

    it('classifies a ready owner with unreachable endpoint as unreachable-owner-alive', async () => {
        const { claimDir } = seedClaim(projectRoot, { pid: 40008 });
        const table = createFakeProcessControl([40008]);

        const probe = await probePreviewSessionClaim(claimDir, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        expect(probe.liveness).toBe('unreachable-owner-alive');
    });

    it('classifies a triple-matching endpoint as live-compatible', async () => {
        const seeded = seedClaim(projectRoot, { pid: 40009 });
        const table = createFakeProcessControl([40009]);
        const identity = buildIdentity({
            sessionId: seeded.sessionId,
            projectRoot,
        });

        const probe = await probePreviewSessionClaim(seeded.claimDir, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(identity),
        });

        expect(probe.liveness).toBe('live-compatible');
        expect(probe.identity).toEqual(identity);
    });

    it('classifies a protocol version mismatch as live-incompatible', async () => {
        const seeded = seedClaim(projectRoot, { pid: 40010 });
        const table = createFakeProcessControl([40010]);

        const probe = await probePreviewSessionClaim(seeded.claimDir, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(buildIdentity({
                sessionId: seeded.sessionId,
                projectRoot,
                protocolVersion: PREVIEW_SESSION_PROTOCOL_VERSION + 1,
            })),
        });

        expect(probe.liveness).toBe('live-incompatible');
    });

    it('classifies an endpoint sessionId mismatch as invalid (PID reuse protection)', async () => {
        const seeded = seedClaim(projectRoot, { pid: 40011 });
        const table = createFakeProcessControl([40011]);

        const probe = await probePreviewSessionClaim(seeded.claimDir, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(buildIdentity({
                sessionId: 'another-session',
                projectRoot,
            })),
        });

        expect(probe.liveness).toBe('invalid');
        expect(probe.descriptorError).toBe('identity-session-id-mismatch');
    });

    it('classifies an endpoint projectRoot mismatch as invalid', async () => {
        const seeded = seedClaim(projectRoot, { pid: 40012 });
        const table = createFakeProcessControl([40012]);
        const otherProject = createProjectFixture(fixtureRoot, 'other-project');

        const probe = await probePreviewSessionClaim(seeded.claimDir, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(buildIdentity({
                sessionId: seeded.sessionId,
                projectRoot: otherProject,
            })),
        });

        expect(probe.liveness).toBe('invalid');
        expect(probe.descriptorError).toBe('identity-project-root-mismatch');
    });
});
