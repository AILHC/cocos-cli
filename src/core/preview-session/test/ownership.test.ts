/**
 * ownership acquire / release 主流程的单测(临时 fixture + fake process table / fetcher)。
 * 覆盖:首次 acquire、mkdir 冲突验活分支、stale 回收接管、retry 仅一次、
 * release 与旧 owner 不删后继 claim、ready/draining 状态发布、discovery。
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
    acquirePreviewSessionOwnership,
    discoverPreviewSession,
    type PreviewSessionOwnership,
} from '../ownership';
import { resolvePreviewSessionDeps, type PreviewSessionFileSystem } from '../deps';
import { CLI_TEMP_DIR, PREVIEW_SESSION_DESCRIPTOR_NAME, PREVIEW_SESSION_PROTOCOL_VERSION } from '../constants';
import type { PreviewSessionDescriptor } from '../types';
import {
    buildIdentity,
    cleanupFixtureRoot,
    createFakeClock,
    createFakeProcessControl,
    createFixtureRoot,
    createProjectFixture,
    seedClaim,
} from './helpers';

describe('acquirePreviewSessionOwnership', () => {
    let fixtureRoot: string;
    let projectRoot: string;

    beforeEach(() => {
        fixtureRoot = createFixtureRoot();
        projectRoot = createProjectFixture(fixtureRoot);
    });

    afterEach(() => {
        cleanupFixtureRoot(fixtureRoot);
    });

    function readDescriptor(claimDir: string): PreviewSessionDescriptor {
        return JSON.parse(readFileSync(join(claimDir, PREVIEW_SESSION_DESCRIPTOR_NAME), 'utf8'));
    }

    it('acquires the first claim, publishing a starting descriptor without serverUrl', async () => {
        const result = await acquirePreviewSessionOwnership({
            projectRoot,
            sessionId: 's-first',
            pid: 50001,
        });

        expect(result.acquired).toBe(true);
        if (!result.acquired) {
            return;
        }
        const { ownership } = result;
        expect(ownership.sessionId).toBe('s-first');
        expect(ownership.pid).toBe(50001);
        expect(ownership.projectRoot).toBe(projectRoot);
        expect(ownership.claimDir).toBe(join(projectRoot, CLI_TEMP_DIR, 'preview-session-s-first-50001'));
        expect(existsSync(ownership.claimDir)).toBe(true);

        const descriptor = readDescriptor(ownership.claimDir);
        expect(descriptor.state).toBe('starting');
        expect(descriptor.serverUrl).toBeUndefined();
        expect(descriptor.protocolVersion).toBe(PREVIEW_SESSION_PROTOCOL_VERSION);
        expect(descriptor.projectRoot).toBe(projectRoot);
    });

    it('canonicalizes a non-canonical project root before claiming', async () => {
        const messyRoot = join(projectRoot, 'assets', '..');
        const result = await acquirePreviewSessionOwnership({
            projectRoot: messyRoot,
            sessionId: 's-canon',
            pid: 50002,
        });

        expect(result.acquired).toBe(true);
        if (!result.acquired) {
            return;
        }
        expect(result.ownership.projectRoot).toBe(projectRoot);
        expect(result.ownership.claimDir.startsWith(join(projectRoot, CLI_TEMP_DIR))).toBe(true);
        await result.ownership.release();
    });

    it('reports an existing live-compatible session without touching its claim', async () => {
        const seeded = seedClaim(projectRoot, { pid: 40001 });
        const table = createFakeProcessControl([40001]);

        const result = await acquirePreviewSessionOwnership({
            projectRoot,
            sessionId: 's-second',
            pid: 50003,
        }, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(buildIdentity({
                sessionId: seeded.sessionId,
                projectRoot,
            })),
        });

        expect(result.acquired).toBe(false);
        if (result.acquired) {
            return;
        }
        expect(result.reason).toBe('existing-session');
        expect(result.liveness).toBe('live-compatible');
        expect(result.identity?.serverUrl).toBe('http://127.0.0.1:7456');
        expect(table.terminated).toEqual([]);
        expect(existsSync(seeded.claimDir)).toBe(true);
    });

    it('reports a starting session as existing-session', async () => {
        const seeded = seedClaim(projectRoot, { pid: 40002, state: 'starting' });
        const table = createFakeProcessControl([40002]);

        const result = await acquirePreviewSessionOwnership({ projectRoot, sessionId: 's-x', pid: 50004 }, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        expect(result.acquired).toBe(false);
        if (result.acquired) {
            return;
        }
        expect(result.liveness).toBe('starting');
        expect(result.message).toContain('40002');
        expect(existsSync(seeded.claimDir)).toBe(true);
    });

    it('never reclaims a live-incompatible session', async () => {
        const seeded = seedClaim(projectRoot, { pid: 40003 });
        const table = createFakeProcessControl([40003]);

        const result = await acquirePreviewSessionOwnership({ projectRoot, sessionId: 's-y', pid: 50005 }, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(buildIdentity({
                sessionId: seeded.sessionId,
                projectRoot,
                protocolVersion: PREVIEW_SESSION_PROTOCOL_VERSION + 1,
            })),
        });

        expect(result.acquired).toBe(false);
        if (result.acquired) {
            return;
        }
        expect(result.liveness).toBe('live-incompatible');
        expect(table.terminated).toEqual([]);
        expect(existsSync(seeded.claimDir)).toBe(true);
    });

    it('reclaims a confirmed-dead claim and acquires ownership', async () => {
        const seeded = seedClaim(projectRoot, { pid: 40004 });
        const table = createFakeProcessControl([]);

        const result = await acquirePreviewSessionOwnership({ projectRoot, sessionId: 's-new', pid: 50006 }, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        expect(result.acquired).toBe(true);
        if (!result.acquired) {
            return;
        }
        expect(table.terminated).toEqual([]);
        expect(existsSync(seeded.claimDir)).toBe(false);
        expect(existsSync(result.ownership.claimDir)).toBe(true);
        expect(readDescriptor(result.ownership.claimDir).sessionId).toBe('s-new');
        await result.ownership.release();
    });

    it('terminates the process tree of an unreachable live owner, confirms death, then acquires', async () => {
        const seeded = seedClaim(projectRoot, { pid: 40005 });
        const table = createFakeProcessControl([40005]);
        const clock = createFakeClock();

        const result = await acquirePreviewSessionOwnership({
            projectRoot,
            sessionId: 's-killer',
            pid: 50007,
            timing: { sigtermTimeoutMs: 1000, pollIntervalMs: 100 },
        }, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
            now: clock.now,
            sleep: clock.sleep,
        });

        expect(result.acquired).toBe(true);
        expect(table.terminatedTrees).toEqual([40005]);
        expect(table.terminated).toEqual([]);
        expect(existsSync(seeded.claimDir)).toBe(false);
        if (result.acquired) {
            await result.ownership.release();
        }
    });

    it('fails closed when termination death confirmation times out', async () => {
        const seeded = seedClaim(projectRoot, { pid: 40006 });
        const table = createFakeProcessControl([40006], false);
        const clock = createFakeClock();

        const result = await acquirePreviewSessionOwnership({
            projectRoot,
            sessionId: 's-blocked',
            pid: 50008,
            timing: { sigtermTimeoutMs: 200, pollIntervalMs: 100 },
        }, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
            now: clock.now,
            sleep: clock.sleep,
        });

        expect(result.acquired).toBe(false);
        if (result.acquired) {
            return;
        }
        expect(result.reason).toBe('existing-session');
        expect(result.liveness).toBe('unreachable-owner-alive');
        expect(existsSync(seeded.claimDir)).toBe(true);
    });

    it('retries the claim slot exactly once after reclaiming, then fails closed on a concurrent claim', async () => {
        const seeded = seedClaim(projectRoot, { pid: 40007 });
        const table = createFakeProcessControl([]);
        const base = resolvePreviewSessionDeps().fs;
        let mkdirCalls = 0;
        const fs: PreviewSessionFileSystem = {
            ...base,
            mkdir: async (path: string) => {
                mkdirCalls += 1;
                // retry mkdir 期间另一个进程抢先创建了自己的 claim。
                seedClaim(projectRoot, { sessionId: 'competitor', pid: 40009 });
                return base.mkdir(path);
            },
        };

        const result = await acquirePreviewSessionOwnership({ projectRoot, sessionId: 's-retry', pid: 50009 }, {
            fs,
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        expect(result.acquired).toBe(false);
        if (result.acquired) {
            return;
        }
        expect(result.reason).toBe('conflict');
        // 冲突路径跳过首次 mkdir;回收后 retry 仅一次。
        expect(mkdirCalls).toBe(1);
        // 旧 claim 已回收,竞争者的 claim 不被触碰。
        expect(existsSync(seeded.claimDir)).toBe(false);
        expect(existsSync(join(projectRoot, CLI_TEMP_DIR, 'preview-session-competitor-40009'))).toBe(true);
    });

    it('yields to a concurrent claim that appears during the initial mkdir window', async () => {
        const base = resolvePreviewSessionDeps().fs;
        const fs: PreviewSessionFileSystem = {
            ...base,
            mkdir: async (path: string) => {
                await base.mkdir(path);
                // 同启竞争:我方 mkdir 后、re-list 前对方也创建了自己的 claim。
                seedClaim(projectRoot, { sessionId: 'winner', pid: 40010, state: 'starting' });
            },
        };
        const table = createFakeProcessControl([40010]);

        const result = await acquirePreviewSessionOwnership({ projectRoot, sessionId: 's-loser', pid: 50010 }, {
            fs,
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        expect(result.acquired).toBe(false);
        if (result.acquired) {
            return;
        }
        expect(result.reason).toBe('existing-session');
        expect(result.liveness).toBe('starting');
        // 我方让位:自己的 claim 已删除,赢家的 claim 保留。
        expect(existsSync(join(projectRoot, CLI_TEMP_DIR, 'preview-session-s-loser-50010'))).toBe(false);
        expect(existsSync(join(projectRoot, CLI_TEMP_DIR, 'preview-session-winner-40010'))).toBe(true);
    });

    it('reports invalid-owner-alive as existing-session with a manual-handling message and never touches the claim', async () => {
        const seeded = seedClaim(projectRoot, { pid: 40011, rawDescriptor: '{"sessionId":' });
        const table = createFakeProcessControl([40011]);

        const result = await acquirePreviewSessionOwnership({ projectRoot, sessionId: 's-ioa', pid: 50011 }, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        expect(result.acquired).toBe(false);
        if (result.acquired) {
            return;
        }
        expect(result.reason).toBe('existing-session');
        expect(result.liveness).toBe('invalid-owner-alive');
        expect(result.message).toContain('40011');
        expect(result.message).toContain('manually');
        // 永不回收、不终止:claim 与进程都保持原样。
        expect(table.terminated).toEqual([]);
        expect(table.terminatedTrees).toEqual([]);
        expect(existsSync(seeded.claimDir)).toBe(true);
        expect(table.alive.has(40011)).toBe(true);
    });

    it('uses the final reclaim probe when the owner recovers to live-compatible mid-reclaim', async () => {
        // 第一次 probe:endpoint 不可达(unreachable-owner-alive);
        // 回收阶段重读:owner 恢复为 live-compatible。
        const seeded = seedClaim(projectRoot, { pid: 40012 });
        const table = createFakeProcessControl([40012]);
        const identity = buildIdentity({ sessionId: seeded.sessionId, projectRoot });
        const fetchIdentity = jest.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValue(identity);

        const result = await acquirePreviewSessionOwnership({ projectRoot, sessionId: 's-rec', pid: 50012 }, {
            processControl: table.control,
            fetchIdentity,
        });

        expect(result.acquired).toBe(false);
        if (result.acquired) {
            return;
        }
        expect(result.reason).toBe('existing-session');
        // 必须是最终 probe 的 liveness / descriptor / identity,不是第一次的旧数据。
        expect(result.liveness).toBe('live-compatible');
        expect(result.descriptor?.sessionId).toBe(seeded.sessionId);
        expect(result.identity).toEqual(identity);
        expect(table.terminatedTrees).toEqual([]);
        expect(existsSync(seeded.claimDir)).toBe(true);
    });

    it('resolves simultaneous mkdir + re-list with exactly one deterministic winner', async () => {
        const base = resolvePreviewSessionDeps().fs;
        const cliTempDir = join(projectRoot, CLI_TEMP_DIR);
        // barrier:前两次(双方初始 list)与前四次(含双方 re-list)readdir 两两放行,
        // 保证双方 re-list 时都能看到对方且都尚未发布 descriptor。
        let gatedCalls = 0;
        let waiter: (() => void) | null = null;
        const fs: PreviewSessionFileSystem = {
            ...base,
            readdir: async (path: string) => {
                if (path === cliTempDir && gatedCalls < 4) {
                    gatedCalls += 1;
                    await new Promise<void>((resolve) => {
                        if (waiter) {
                            const pending = waiter;
                            waiter = null;
                            pending();
                            resolve();
                        } else {
                            waiter = resolve;
                        }
                    });
                }
                return base.readdir(path);
            },
        };
        const table = createFakeProcessControl([50021, 50022]);
        const deps = {
            fs,
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        };

        const [resultA, resultB] = await Promise.all([
            acquirePreviewSessionOwnership({ projectRoot, sessionId: 'aaa-race', pid: 50021 }, deps),
            acquirePreviewSessionOwnership({ projectRoot, sessionId: 'bbb-race', pid: 50022 }, deps),
        ]);

        // 恰有一个 winner:claim 目录名最小者(aaa-race)保留,另一方让位。
        expect(resultA.acquired).toBe(true);
        expect(resultB.acquired).toBe(false);
        if (resultA.acquired) {
            expect(existsSync(resultA.ownership.claimDir)).toBe(true);
            await resultA.ownership.release();
        }
        if (!resultB.acquired) {
            expect(resultB.reason).toBe('existing-session');
        }
        expect(existsSync(join(projectRoot, CLI_TEMP_DIR, 'preview-session-bbb-race-50022'))).toBe(false);
    });
});

describe('PreviewSessionOwnership', () => {
    let fixtureRoot: string;
    let projectRoot: string;
    let ownership: PreviewSessionOwnership;

    beforeEach(async () => {
        fixtureRoot = createFixtureRoot();
        projectRoot = createProjectFixture(fixtureRoot);
        const result = await acquirePreviewSessionOwnership({ projectRoot, sessionId: 's-own', pid: 50020 });
        if (!result.acquired) {
            throw new Error('failed to acquire ownership in test setup');
        }
        ownership = result.ownership;
    });

    afterEach(() => {
        cleanupFixtureRoot(fixtureRoot);
    });

    function readDescriptor(): PreviewSessionDescriptor {
        return JSON.parse(readFileSync(join(ownership.claimDir, PREVIEW_SESSION_DESCRIPTOR_NAME), 'utf8'));
    }

    it('publishReady fills serverUrl and switches to ready atomically', async () => {
        await ownership.publishReady('http://127.0.0.1:8080');
        const descriptor = readDescriptor();
        expect(descriptor.state).toBe('ready');
        expect(descriptor.serverUrl).toBe('http://127.0.0.1:8080');
        expect(descriptor.sessionId).toBe('s-own');
    });

    it('markDraining switches to draining while preserving serverUrl', async () => {
        await ownership.publishReady('http://127.0.0.1:8080');
        await ownership.markDraining();
        const descriptor = readDescriptor();
        expect(descriptor.state).toBe('draining');
        expect(descriptor.serverUrl).toBe('http://127.0.0.1:8080');
    });

    it('markDraining is a no-op when the descriptor is already gone', async () => {
        rmSync(join(ownership.claimDir, PREVIEW_SESSION_DESCRIPTOR_NAME));
        await expect(ownership.markDraining()).resolves.toBeUndefined();
    });

    it('release removes the descriptor and the claim dir, and is idempotent', async () => {
        await ownership.publishReady('http://127.0.0.1:8080');
        await ownership.release();
        expect(existsSync(ownership.claimDir)).toBe(false);
        await expect(ownership.release()).resolves.toBeUndefined();
    });

    it('release does not delete a successor claim (sessionId mismatch)', async () => {
        // 模拟 claim 被回收后由后继 owner 接管:descriptor 换成别的 sessionId。
        writeFileSync(join(ownership.claimDir, PREVIEW_SESSION_DESCRIPTOR_NAME), JSON.stringify({
            sessionId: 's-successor',
            projectRoot,
            pid: 60001,
            state: 'starting',
            protocolVersion: PREVIEW_SESSION_PROTOCOL_VERSION,
            startedAt: '2026-07-24T01:00:00.000Z',
        }), 'utf8');

        await ownership.release();

        expect(existsSync(ownership.claimDir)).toBe(true);
        expect(readDescriptor().sessionId).toBe('s-successor');
    });
});

describe('discoverPreviewSession', () => {
    let fixtureRoot: string;
    let projectRoot: string;

    beforeEach(() => {
        fixtureRoot = createFixtureRoot();
        projectRoot = createProjectFixture(fixtureRoot);
    });

    afterEach(() => {
        cleanupFixtureRoot(fixtureRoot);
    });

    it('returns null when no claim exists', async () => {
        await expect(discoverPreviewSession(projectRoot)).resolves.toBeNull();
    });

    it('probes the existing claim for CLI discovery', async () => {
        const seeded = seedClaim(projectRoot, { pid: 40020 });
        const table = createFakeProcessControl([40020]);

        const probe = await discoverPreviewSession(projectRoot, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(buildIdentity({
                sessionId: seeded.sessionId,
                projectRoot,
            })),
        });

        expect(probe?.liveness).toBe('live-compatible');
        expect(probe?.descriptor?.sessionId).toBe(seeded.sessionId);
        expect(probe?.identity?.mcpUrl).toBe('http://127.0.0.1:7456/mcp');
    });

    it('prefers protocol-semantics priority over directory-name order across multiple claims', async () => {
        // 目录名排序最靠前的是 invalid,但 starting 的协议优先级更高。
        seedClaim(projectRoot, { sessionId: 'aaa-inv', pid: 40030, rawDescriptor: '{"sessionId":' });
        const starting = seedClaim(projectRoot, { sessionId: 'bbb-start', pid: 40031, state: 'starting' });
        seedClaim(projectRoot, { sessionId: 'ccc-unreach', pid: 40032 });
        const table = createFakeProcessControl([40031, 40032]);

        const probe = await discoverPreviewSession(projectRoot, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        // starting > unreachable-owner-alive > invalid。
        expect(probe?.claim.claimDir).toBe(starting.claimDir);
        expect(probe?.liveness).toBe('starting');
    });

    it('prefers live-incompatible over starting across multiple claims', async () => {
        // 版本不匹配的 live owner 优先于后启动中的 session 报告(提示重启 Preview)。
        seedClaim(projectRoot, {
            sessionId: 'aaa-incomp',
            pid: 40033,
            protocolVersion: PREVIEW_SESSION_PROTOCOL_VERSION + 1,
        });
        seedClaim(projectRoot, { sessionId: 'bbb-start', pid: 40034, state: 'starting' });
        const table = createFakeProcessControl([40033, 40034]);

        const probe = await discoverPreviewSession(projectRoot, {
            processControl: table.control,
            fetchIdentity: jest.fn().mockResolvedValue(null),
        });

        expect(probe?.liveness).toBe('live-incompatible');
        expect(probe?.claim.pid).toBe(40033);
    });
});
