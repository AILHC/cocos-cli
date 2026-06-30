import { posix, win32 } from 'path';
import { fileURLToPath } from 'url';

export interface ScriptCompileDiagnosticLocation {
    filePath?: string;
    relativeFilePath?: string;
    assetUrl?: string;
    line?: number;
    column?: number;
}

export type RuntimePreviewOutputState =
    | 'latest'
    | 'lastGoodDueToFailure'
    | 'noUsableOutput';

export interface ScriptCompileDiagnostic {
    phase: 'startup' | 'refresh' | 'reload-refresh' | 'build' | 'unknown';
    target?: 'editor' | 'preview' | string;
    message: string;
    name?: string;
    location: ScriptCompileDiagnosticLocation;
    codeFrame?: string;
    stackSummary?: string;
    logFilePath?: string;
    refreshId?: string;
    taskId?: string;
    outputState?: RuntimePreviewOutputState;
}

export interface CreateScriptCompileDiagnosticOptions {
    phase: ScriptCompileDiagnostic['phase'];
    target?: ScriptCompileDiagnostic['target'];
    projectRoot?: string;
    assetUrl?: string;
    logFilePath?: string;
    refreshId?: string;
    taskId?: string;
    outputState?: RuntimePreviewOutputState;
    sourceLoader?: (filePath: string) => string | undefined;
}

type ErrorLike = {
    message?: unknown;
    name?: unknown;
    stack?: unknown;
    loc?: {
        line?: unknown;
        column?: unknown;
    };
    codeFrame?: unknown;
    filename?: unknown;
    file?: unknown;
};

interface ExtractedLocation {
    filePath?: string;
    line?: number;
    column?: number;
}

interface LocationPattern {
    regex: RegExp;
    groupIndex: number;
}

export function createScriptCompileDiagnostic(
    error: unknown,
    options: CreateScriptCompileDiagnosticOptions,
): ScriptCompileDiagnostic {
    const errorLike = toErrorLike(error);
    const rawMessage = stripAnsi(getString(errorLike.message) ?? String(error)) ?? '';
    const messageParts = splitMessageAndCodeFrame(rawMessage);
    const message = normalizeDiagnosticMessage(messageParts.message);
    const filenameLocation = extractLocationFromPathCandidate(getString(errorLike.filename));
    const fileLocation = extractLocationFromPathCandidate(getString(errorLike.file));
    const acceptProjectLocation = (location: ExtractedLocation) => !options.projectRoot
        || !location.filePath
        || isFilePathUnderProject(location.filePath, options.projectRoot);
    const stackLocation = extractLocationFromText(getString(errorLike.stack), acceptProjectLocation);
    const messageLocation = extractLocationFromText(rawMessage, acceptProjectLocation)
        ?? extractLocationFromText(rawMessage);
    const messageLineColumn = extractBabelLineColumn(rawMessage);

    const filePath = filenameLocation?.filePath
        ?? fileLocation?.filePath
        ?? stackLocation?.filePath
        ?? messageLocation?.filePath;
    const line = toNumber(errorLike.loc?.line)
        ?? messageLineColumn?.line
        ?? filenameLocation?.line
        ?? fileLocation?.line
        ?? stackLocation?.line
        ?? messageLocation?.line;
    const column = toNumber(errorLike.loc?.column)
        ?? messageLineColumn?.column
        ?? filenameLocation?.column
        ?? fileLocation?.column
        ?? stackLocation?.column
        ?? messageLocation?.column;

    const codeFrame = trimCodeFrame(
        getString(errorLike.codeFrame)
        ?? messageParts.codeFrame
        ?? createCodeFrameFromSource(filePath, line, column, options.sourceLoader),
    );

    return {
        phase: options.phase,
        target: options.target,
        message,
        name: getString(errorLike.name),
        location: {
            filePath,
            relativeFilePath: createRelativeFilePath(filePath, options.projectRoot),
            assetUrl: options.assetUrl,
            line,
            column,
        },
        codeFrame,
        stackSummary: trimStack(stripAnsi(getString(errorLike.stack))),
        logFilePath: options.logFilePath,
        refreshId: options.refreshId,
        taskId: options.taskId,
        outputState: options.outputState,
    };
}

export function formatScriptCompileDiagnosticForConsole(
    diagnostic: ScriptCompileDiagnostic,
): string[] {
    const lines = [
        `script-compile:failed phase=${diagnostic.phase} target=${diagnostic.target ?? 'unknown'} file=${formatLocation(diagnostic)}`,
        diagnostic.message,
    ];

    if (diagnostic.codeFrame) {
        lines.push(...diagnostic.codeFrame.split(/\r?\n/));
    }
    if (diagnostic.outputState === 'lastGoodDueToFailure') {
        lines.push('current change was not applied; preview keeps last good scripts');
    } else if (diagnostic.outputState === 'noUsableOutput') {
        lines.push('no usable output is available; preview cannot load compiled scripts');
    }
    if (diagnostic.logFilePath) {
        lines.push(`details: ${diagnostic.logFilePath}`);
    }

    return lines;
}

export function formatScriptCompileDiagnosticSummary(
    diagnostic: ScriptCompileDiagnostic,
): string {
    return `Script compile failed: ${formatLocation(diagnostic)} ${diagnostic.message}`;
}

function toErrorLike(error: unknown): ErrorLike {
    if (error && typeof error === 'object') {
        return error as ErrorLike;
    }
    return {};
}

function getString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function toNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function trimBabelLocationSuffix(message: string): string {
    return message.replace(/\s+\(\d+:\d+\)\s*$/, '');
}

function stripAnsi(value: string | undefined): string | undefined {
    return value?.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function splitMessageAndCodeFrame(message: string): { message: string; codeFrame?: string } {
    const [firstPart, ...restParts] = message.split(/\r?\n\s*\r?\n/);
    return {
        message: firstPart,
        codeFrame: restParts.length > 0 ? restParts.join('\n\n') : undefined,
    };
}

function normalizeDiagnosticMessage(message: string): string {
    const firstLine = message.split(/\r?\n/)[0] ?? message;
    const pathPrefixedMessage = firstLine.match(/\.(?:[cm]?[jt]sx?):\s*(.+)$/);
    return trimBabelLocationSuffix((pathPrefixedMessage?.[1] ?? firstLine).trim());
}

function extractBabelLineColumn(message: string): Pick<ExtractedLocation, 'line' | 'column'> | undefined {
    const firstLine = message.split(/\r?\n/, 1)[0] ?? message;
    const match = firstLine.match(/\((\d+):(\d+)\)\s*$/);
    if (!match) {
        return undefined;
    }
    return {
        line: Number(match[1]),
        column: Number(match[2]),
    };
}

function extractLocationFromText(
    text: string | undefined,
    acceptLocation: (location: ExtractedLocation) => boolean = () => true,
): ExtractedLocation | undefined {
    if (!text) {
        return undefined;
    }

    const patterns: LocationPattern[] = [
        { regex: /(file:\/\/\/[^\s)"'<>]+)/g, groupIndex: 1 },
        { regex: /file:\\([A-Za-z]:[\\/][^\s)"'<>]+)/g, groupIndex: 1 },
        { regex: /(?:^|[^\w])([A-Za-z]:[\\/][^\s)"'<>]+)/g, groupIndex: 1 },
        { regex: /(?:^|[\s("'<>])((?:\/(?!\/)[^\s)"'<>?]+))/g, groupIndex: 1 },
    ];

    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern.regex)) {
            const candidate = match[pattern.groupIndex];
            if (!candidate) {
                continue;
            }
            const location = extractLocationFromPathCandidate(candidate);
            if (location?.filePath && acceptLocation(location)) {
                return location;
            }
        }
    }

    return undefined;
}

function extractLocationFromPathCandidate(candidate: string | undefined): ExtractedLocation | undefined {
    if (!candidate) {
        return undefined;
    }

    const trimmed = trimPathToken(candidate);
    const withLineColumn = splitTrailingLineColumn(trimmed);
    const filePath = normalizeFilePath(withLineColumn.filePath);
    if (!filePath) {
        return undefined;
    }

    return {
        filePath,
        line: withLineColumn.line,
        column: withLineColumn.column,
    };
}

function trimPathToken(value: string): string {
    return value.trim().replace(/^[("'<>]+/, '').replace(/[)"'<>]+$/, '');
}

function splitTrailingLineColumn(value: string): ExtractedLocation & { filePath: string } {
    const match = value.match(/^(.*):(\d+):(\d+)$/);
    if (!match) {
        return { filePath: trimTrailingMessageSeparator(value) };
    }
    return {
        filePath: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
    };
}

function trimTrailingMessageSeparator(value: string): string {
    if (/^(?:file:\/\/\/)?[A-Za-z]:[\\/].+:$/.test(value) || /^file:\\[A-Za-z]:[\\/].+:$/.test(value)) {
        return value.slice(0, -1);
    }
    return value;
}

function normalizeFilePath(filePath: string): string | undefined {
    if (!filePath) {
        return undefined;
    }

    if (filePath.startsWith('file:///')) {
        const windowsDriveFileUrl = filePath.match(/^file:\/\/\/([A-Za-z]:\/.*)$/);
        if (windowsDriveFileUrl) {
            return decodeURIComponent(windowsDriveFileUrl[1]).replace(/\//g, '\\');
        }

        try {
            return fileURLToPath(filePath);
        } catch {
            const withoutProtocol = filePath.replace(/^file:\/\/\//, '');
            return decodeURIComponent(withoutProtocol).replace(/\//g, '\\');
        }
    }

    if (/^[A-Za-z]:\//.test(filePath)) {
        return filePath.replace(/\//g, '\\');
    }

    return filePath;
}

function createRelativeFilePath(filePath: string | undefined, projectRoot: string | undefined): string | undefined {
    if (!filePath || !projectRoot) {
        return undefined;
    }

    const pathFlavor = getPathFlavor(filePath);
    if (!pathFlavor || pathFlavor !== getPathFlavor(projectRoot) || !isFilePathUnderProject(filePath, projectRoot)) {
        return undefined;
    }

    const pathApi = getPathApi(pathFlavor);
    const relativeFilePath = pathApi.relative(pathApi.resolve(projectRoot), pathApi.resolve(filePath));
    if (!relativeFilePath) {
        return undefined;
    }

    return relativeFilePath;
}

function isFilePathUnderProject(filePath: string, projectRoot: string): boolean {
    const pathFlavor = getPathFlavor(filePath);
    if (!pathFlavor || pathFlavor !== getPathFlavor(projectRoot)) {
        return false;
    }

    const pathApi = getPathApi(pathFlavor);
    const relativeFilePath = pathApi.relative(pathApi.resolve(projectRoot), pathApi.resolve(filePath));
    return relativeFilePath === ''
        || (!relativeFilePath.startsWith('..') && !pathApi.isAbsolute(relativeFilePath));
}

function getPathFlavor(filePath: string): 'win32' | 'posix' | undefined {
    if (/^[A-Za-z]:[\\/]/.test(filePath)) {
        return 'win32';
    }
    if (filePath.startsWith('/')) {
        return 'posix';
    }
    return undefined;
}

function getPathApi(pathFlavor: 'win32' | 'posix'): typeof win32 | typeof posix {
    return pathFlavor === 'win32' ? win32 : posix;
}

function trimCodeFrame(codeFrame: string | undefined): string | undefined {
    if (!codeFrame) {
        return undefined;
    }
    return codeFrame.split(/\r?\n/).slice(0, 5).join('\n');
}

function trimStack(stack: string | undefined): string | undefined {
    if (!stack) {
        return undefined;
    }
    return stack.split(/\r?\n/).slice(0, 8).join('\n');
}

function createCodeFrameFromSource(
    filePath: string | undefined,
    line: number | undefined,
    column: number | undefined,
    sourceLoader: CreateScriptCompileDiagnosticOptions['sourceLoader'],
): string | undefined {
    if (!filePath || !line || !sourceLoader) {
        return undefined;
    }

    let source: string | undefined;
    try {
        source = sourceLoader(filePath);
    } catch {
        return undefined;
    }
    if (source === undefined) {
        return undefined;
    }

    const sourceLines = source.split(/\r?\n/);
    const targetIndex = line - 1;
    if (targetIndex < 0 || targetIndex >= sourceLines.length) {
        return undefined;
    }

    const hasColumn = typeof column === 'number';
    const sourceLineBudget = hasColumn ? 4 : 5;
    const startIndex = calculateFrameStartIndex(targetIndex, sourceLines.length, sourceLineBudget);
    const endIndex = Math.min(sourceLines.length, startIndex + sourceLineBudget);
    const width = String(endIndex).length;
    const frameLines: string[] = [];

    for (let index = startIndex; index < endIndex; index++) {
        const lineNumber = index + 1;
        const marker = lineNumber === line ? '>' : ' ';
        frameLines.push(`${marker} ${String(lineNumber).padStart(width, ' ')} | ${sourceLines[index]}`);

        if (lineNumber === line && hasColumn) {
            frameLines.push(`${' '.repeat(width + 3)}| ${' '.repeat(Math.max(0, column))}^`);
        }
    }

    return frameLines.slice(0, 5).join('\n');
}

function calculateFrameStartIndex(targetIndex: number, sourceLineCount: number, sourceLineBudget: number): number {
    const preferredStartIndex = Math.max(0, targetIndex - 2);
    const latestStartIndex = Math.max(0, sourceLineCount - sourceLineBudget);
    return Math.min(preferredStartIndex, latestStartIndex);
}

function formatLocation(diagnostic: ScriptCompileDiagnostic): string {
    const location = diagnostic.location;
    const file = location.relativeFilePath ?? location.filePath ?? 'unknown';
    if (location.line === undefined) {
        return file;
    }
    if (location.column === undefined) {
        return `${file}:${location.line}`;
    }
    return `${file}:${location.line}:${location.column}`;
}
