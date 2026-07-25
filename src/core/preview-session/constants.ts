/**
 * Preview session ownership 的契约常量。
 * 决策来源:.scratch/preview-session-cli-discovery/spec.md 与 issues/13、15、16、17、18。
 */

// 协议版本:descriptor 与 identity endpoint 均携带;CLI 与 server 同包发布,
// 不匹配即硬失败(提示重启 Preview),不做协商。
export const PREVIEW_SESSION_PROTOCOL_VERSION = 1;

// 统一 server 的只读 identity endpoint 路径(由 T2 实现,此处仅固定契约)。
export const PREVIEW_SESSION_IDENTITY_PATH = '/__cocos-cli/session';

// MCP endpoint 固定路径:mcpUrl 由 serverUrl + 该路径推导,不单独存储。
export const PREVIEW_SESSION_MCP_PATH = '/mcp';

// claim 目录名前缀:位于 <project>/temp/cli/ 下,完整格式为
// `preview-session-<sessionId>-<pid>`,mkdir 原子创建成功即 ownership 成立。
export const PREVIEW_SESSION_CLAIM_PREFIX = 'preview-session-';

// descriptor 文件名(claim 目录内),发布与更新一律 tmp+rename。
export const PREVIEW_SESSION_DESCRIPTOR_NAME = 'descriptor.json';
export const PREVIEW_SESSION_DESCRIPTOR_TMP_NAME = 'descriptor.json.tmp';

// claim 所在目录(相对 canonical project root)。
export const CLI_TEMP_DIR = 'temp/cli';

// identity endpoint 默认探测超时:本机 loopback,失败按不可达处理。
export const DEFAULT_IDENTITY_FETCH_TIMEOUT_MS = 1500;

// 死亡确认/释放等待的默认轮询间隔。
export const DEFAULT_POLL_INTERVAL_MS = 100;

// SIGTERM 后死亡确认超时:Windows 上 SIGTERM 是硬杀(不触发 handler),可以短;
// POSIX 走优雅关闭,长尾更长。超时即 fail closed,不接管。
export const DEFAULT_SIGTERM_TIMEOUT_MS = process.platform === 'win32' ? 3000 : 10000;

// draining 窗口等待 claim 释放的超时:close 开始即释放 claim,正常应极短。
export const DEFAULT_DRAIN_TIMEOUT_MS = 5000;
