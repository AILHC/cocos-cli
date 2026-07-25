/**
 * Preview session ownership 与 discovery 核心原语。
 * 决策来源:.scratch/preview-session-cli-discovery/spec.md(issues/13、15、16、17、18)。
 * 本目录只提供纯逻辑原语;command 层接线见 T3,identity endpoint 见 T2。
 */
export * from './constants';
export * from './types';
export {
    resolvePreviewSessionDeps,
    type PreviewSessionDeps,
    type PreviewSessionFileSystem,
    type PreviewSessionIdentityFetcher,
    type PreviewSessionProcessControl,
    type ResolvedPreviewSessionDeps,
} from './deps';
export {
    deriveMcpUrl,
    descriptorPathOf,
    parsePreviewSessionDescriptor,
    parsePreviewSessionIdentity,
    readPreviewSessionDescriptor,
    writePreviewSessionDescriptorAtomic,
} from './descriptor';
export {
    claimInfoFromDir,
    cliTempDirOf,
    formatClaimDirName,
    listPreviewSessionClaims,
    parseClaimDirName,
} from './claim';
export { probePreviewSessionClaim } from './liveness';
export {
    reclaimPreviewSessionClaim,
    type PreviewSessionReclaimResult,
    type PreviewSessionReclaimTiming,
} from './reclaim';
export {
    acquirePreviewSessionOwnership,
    discoverPreviewSession,
    type AcquirePreviewSessionOwnershipOptions,
    type AcquirePreviewSessionOwnershipResult,
    type PreviewSessionOwnership,
} from './ownership';
export {
    canonicalizeProjectRoot,
    isCocosProjectRoot,
    resolveProjectRootFromCwd,
} from './project-root';
