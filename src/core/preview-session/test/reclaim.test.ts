/**
 * stale claim 回收策略的单测(临时 fixture + fake process table + fake clock)。
 * 覆盖:confirmed-dead / invalid(PID 死的损坏 claim、identity 证明非本 session)
 * 直接回收且不终止进程、invalid-owner-alive 永不回收、unreachable-owner-alive 的
 * 进程树终止 + 死亡确认 + 超时 fail closed、live-incompatible / starting 永不回收、
 * draining 等待释放、回收结果带回最终完整 probe。
 */
import { existsSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { reclaimPreviewSessionClaim } from '../reclaim';
import { PREVIEW_SESSION_PROTOCOL_VERSION } from '../constants';
import {
    buildIdentity,
    cleanupFixtureRoot,
    createFakeClock,
    createFakeProcessControl,
    createFixtureRoot,
    createProjectFixture,
    seedClaim,
} from './helpers';

describe('reclaimPreviewSessionClaim', () => {
    let fixtureRoot: string;
    let projectRoot: string;

    beforeEach(() => {
        fixtureRoot = createFixtureRoot();
        projectRoot = createProjectFixture(fixtureRoot);
    });

    afterEach(() => {
        cleanupFixtureRoot(fixtureRoot);
    });

    it('reclaims a confirmed-dead claim without termination and returns the final probe', async () => {
        const { claimDir } = seedClaim(projectRoot, { pid: 40001 });
        const table = createFakeProcessControl([]);

        const result = await reclaimPreviewSessionClaim(claimDir, {}, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        expect(result.reclaimed).toBe(true);
        expect(result.liveness).toBe('confirmed-dead');
        expect(result.probe.liveness).toBe('confirmed-dead');
        expect(result.probe.claim.claimDir).toBe(claimDir);
        expect(table.terminated).toEqual([]);
        expect(table.terminatedTrees).toEqual([]);
        expect(existsSync(claimDir)).toBe(false);
    });

    it('reclaims a dead-pid corrupted claim (garbage) without termination', async () => {
        const { claimDir } = seedClaim(projectRoot, { pid: 40002, rawDescriptor: '{"sessionId":' });
        const table = createFakeProcessControl([]);

        const result = await reclaimPreviewSessionClaim(claimDir, {}, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        expect(result.reclaimed).toBe(true);
        expect(result.liveness).toBe('invalid');
        // invalid 不终止进程:PID 死的垃圾 claim。
        expect(table.terminated).toEqual([]);
        expect(table.terminatedTrees).toEqual([]);
        expect(existsSync(claimDir)).toBe(false);
    });

    it('reclaims a dead-pid descriptor-claim-mismatched claim without termination', async () => {
        // descriptor 里的 pid 与目录名不一致且目录名 pid 已死:垃圾,直接回收。
        const seeded = seedClaim(projectRoot, { pid: 40012 });
        const table = createFakeProcessControl([]);
        writeFileSync(join(seeded.claimDir, 'descriptor.json'),
            JSON.stringify({ ...seeded.descriptor, pid: 99999 }), 'utf8');

        const result = await reclaimPreviewSessionClaim(seeded.claimDir, {}, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        expect(result.reclaimed).toBe(true);
        expect(result.liveness).toBe('invalid');
        expect(table.terminatedTrees).toEqual([]);
        expect(existsSync(seeded.claimDir)).toBe(false);
    });

    it('never reclaims or terminates a corrupted claim whose pid is alive (invalid-owner-alive)', async () => {
        const { claimDir, pid } = seedClaim(projectRoot, { pid: 40002, rawDescriptor: '{"sessionId":' });
        const table = createFakeProcessControl([40002]);

        const result = await reclaimPreviewSessionClaim(claimDir, {}, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        // fail closed:损坏不能证明该进程不是仍在写项目的 owner。
        expect(result.reclaimed).toBe(false);
        expect(result.liveness).toBe('invalid-owner-alive');
        expect(result.probe.liveness).toBe('invalid-owner-alive');
        expect(table.terminated).toEqual([]);
        expect(table.terminatedTrees).toEqual([]);
        expect(existsSync(claimDir)).toBe(true);
        expect(table.alive.has(pid)).toBe(true);
    });

    it('reclaims an endpoint-identity-mismatched claim without termination', async () => {
        const seeded = seedClaim(projectRoot, { pid: 40003 });
        const table = createFakeProcessControl([40003]);

        const result = await reclaimPreviewSessionClaim(seeded.claimDir, {}, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(buildIdentity({
                sessionId: 'another-session',
                projectRoot,
            })),
        });

        expect(result.reclaimed).toBe(true);
        expect(result.liveness).toBe('invalid');
        // identity 证明非本 session:直接回收,不终止进程。
        expect(table.terminated).toEqual([]);
        expect(table.terminatedTrees).toEqual([]);
        expect(existsSync(seeded.claimDir)).toBe(false);
    });

    it('terminates the process tree of an unreachable live owner and reclaims after confirming death', async () => {
        const { claimDir, pid } = seedClaim(projectRoot, { pid: 40004 });
        const table = createFakeProcessControl([40004]);
        const clock = createFakeClock();

        const result = await reclaimPreviewSessionClaim(claimDir, {
            sigtermTimeoutMs: 1000,
            pollIntervalMs: 100,
        }, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
            now: clock.now,
            sleep: clock.sleep,
        });

        expect(result.reclaimed).toBe(true);
        expect(result.liveness).toBe('unreachable-owner-alive');
        // 进程树终止(scene 子进程依赖树终止,而非 IPC disconnect 自愈)。
        expect(table.terminatedTrees).toEqual([pid]);
        expect(table.terminated).toEqual([]);
        expect(existsSync(claimDir)).toBe(false);
    });

    it('fails closed when the owner does not die within the termination timeout', async () => {
        const { claimDir, pid } = seedClaim(projectRoot, { pid: 40005 });
        // killOnTerminate=false:进程拒绝退出。
        const table = createFakeProcessControl([40005], false);
        const clock = createFakeClock();

        const result = await reclaimPreviewSessionClaim(claimDir, {
            sigtermTimeoutMs: 300,
            pollIntervalMs: 100,
        }, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
            now: clock.now,
            sleep: clock.sleep,
        });

        expect(result.reclaimed).toBe(false);
        if (!result.reclaimed) {
            expect(result.liveness).toBe('unreachable-owner-alive');
            expect(result.message).toContain(`PID ${pid}`);
        }
        expect(table.terminatedTrees).toEqual([pid]);
        // fail closed:claim 保持原样,不接管。
        expect(existsSync(claimDir)).toBe(true);
        expect(existsSync(join(claimDir, 'descriptor.json'))).toBe(true);
    });

    it('never reclaims a live-incompatible claim and never terminates it', async () => {
        const seeded = seedClaim(projectRoot, { pid: 40006 });
        const table = createFakeProcessControl([40006]);

        const result = await reclaimPreviewSessionClaim(seeded.claimDir, {}, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(buildIdentity({
                sessionId: seeded.sessionId,
                projectRoot,
                protocolVersion: PREVIEW_SESSION_PROTOCOL_VERSION + 1,
            })),
        });

        expect(result.reclaimed).toBe(false);
        if (!result.reclaimed) {
            expect(result.liveness).toBe('live-incompatible');
        }
        expect(table.terminated).toEqual([]);
        expect(table.terminatedTrees).toEqual([]);
        expect(existsSync(seeded.claimDir)).toBe(true);
    });

    it('never terminates an old-schema owner whose descriptor version mismatches even when its endpoint 404s', async () => {
        // 旧 server 对新客户端 404 / schema 不符(fetchIdentity → null),
        // descriptor 版本不匹配必须先判 live-incompatible,绝不进 destructive reclaim。
        const seeded = seedClaim(projectRoot, {
            pid: 40011,
            protocolVersion: PREVIEW_SESSION_PROTOCOL_VERSION + 1,
        });
        const table = createFakeProcessControl([40011]);

        const result = await reclaimPreviewSessionClaim(seeded.claimDir, {}, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        expect(result.reclaimed).toBe(false);
        if (!result.reclaimed) {
            expect(result.liveness).toBe('live-incompatible');
        }
        expect(table.terminated).toEqual([]);
        expect(table.terminatedTrees).toEqual([]);
        expect(existsSync(seeded.claimDir)).toBe(true);
        expect(existsSync(join(seeded.claimDir, 'descriptor.json'))).toBe(true);
    });

    it('never reclaims a live-compatible or starting claim', async () => {
        const liveSeeded = seedClaim(projectRoot, { sessionId: 'live-1', pid: 40007 });
        const table = createFakeProcessControl([40007, 40008]);

        const liveResult = await reclaimPreviewSessionClaim(liveSeeded.claimDir, {}, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(buildIdentity({
                sessionId: liveSeeded.sessionId,
                projectRoot,
            })),
        });
        expect(liveResult.reclaimed).toBe(false);

        const startingSeeded = seedClaim(projectRoot, { sessionId: 'starting-1', pid: 40008, state: 'starting' });
        const startingResult = await reclaimPreviewSessionClaim(startingSeeded.claimDir, {}, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });
        expect(startingResult.reclaimed).toBe(false);
        expect(table.terminated).toEqual([]);
        expect(existsSync(liveSeeded.claimDir)).toBe(true);
        expect(existsSync(startingSeeded.claimDir)).toBe(true);
    });

    it('reclaims a draining claim once the owner releases it', async () => {
        const { claimDir } = seedClaim(projectRoot, { pid: 40009, state: 'draining' });
        const table = createFakeProcessControl([40009]);

        const result = await reclaimPreviewSessionClaim(claimDir, {
            drainTimeoutMs: 5000,
            pollIntervalMs: 100,
        }, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
            // 第一次轮询时模拟 owner 完成 close 并释放 claim。
            sleep: async () => {
                rmSync(claimDir, { recursive: true, force: true });
            },
        });

        expect(result.reclaimed).toBe(true);
        expect(result.liveness).toBe('draining');
        expect(table.terminated).toEqual([]);
        expect(existsSync(claimDir)).toBe(false);
    });

    it('fails closed when a draining claim is not released in time', async () => {
        const { claimDir } = seedClaim(projectRoot, { pid: 40010, state: 'draining' });
        const table = createFakeProcessControl([40010]);
        const clock = createFakeClock();

        const result = await reclaimPreviewSessionClaim(claimDir, {
            drainTimeoutMs: 300,
            pollIntervalMs: 100,
        }, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
            now: clock.now,
            sleep: clock.sleep,
        });

        expect(result.reclaimed).toBe(false);
        if (!result.reclaimed) {
            expect(result.liveness).toBe('draining');
        }
        expect(existsSync(claimDir)).toBe(true);
    });
});
