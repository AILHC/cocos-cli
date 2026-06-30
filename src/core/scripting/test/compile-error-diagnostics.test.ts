import {
    createScriptCompileDiagnostic,
    formatScriptCompileDiagnosticForConsole,
    formatScriptCompileDiagnosticSummary,
} from '../compile-error-diagnostics';

describe('compile error diagnostics', () => {
    const projectRoot = 'D:\\project';
    const filePath = 'D:\\project\\assets\\tests\\TestApi.ts';
    const relativeFilePath = 'assets\\tests\\TestApi.ts';

    test('extracts Babel syntax error filename loc message and codeFrame', () => {
        const error = new Error('Invalid left-hand side in assignment (2047:0)') as Error & {
            filename: string;
            loc: { line: number; column: number };
            codeFrame: string;
        };
        error.filename = filePath;
        error.loc = { line: 2047, column: 0 };
        error.codeFrame = '> 2047 | export const = broken;\n       | ^';

        const diagnostic = createScriptCompileDiagnostic(error, {
            projectRoot,
            phase: 'refresh',
            target: 'preview',
            outputState: 'lastGoodDueToFailure',
        });

        expect(diagnostic.message).toBe('Invalid left-hand side in assignment');
        expect(diagnostic.location.filePath).toBe(filePath);
        expect(diagnostic.location.relativeFilePath).toBe(relativeFilePath);
        expect(diagnostic.location.line).toBe(2047);
        expect(diagnostic.location.column).toBe(0);
        expect(diagnostic.codeFrame).toBe(error.codeFrame);
    });

    test('formats console output with last-good fallback text', () => {
        const diagnostic = createScriptCompileDiagnostic(new Error('compile failed (2047:0)'), {
            projectRoot,
            phase: 'refresh',
            target: 'preview',
            outputState: 'lastGoodDueToFailure',
            sourceLoader: () => 'first line\nsecond line',
        });
        diagnostic.location.filePath = filePath;
        diagnostic.location.relativeFilePath = relativeFilePath;

        const lines = formatScriptCompileDiagnosticForConsole(diagnostic);

        expect(lines[0]).toBe(
            'script-compile:failed phase=refresh target=preview file=assets\\tests\\TestApi.ts:2047:0',
        );
        expect(lines).toContain('compile failed');
        expect(lines.join('\n')).toContain('current change was not applied; preview keeps last good scripts');
    });

    test('formats summary for RuntimeRefreshResult.error', () => {
        const diagnostic = createScriptCompileDiagnostic(new Error('compile failed'), {
            projectRoot,
            phase: 'refresh',
            target: 'preview',
            outputState: 'noUsableOutput',
        });
        diagnostic.location.filePath = filePath;
        diagnostic.location.relativeFilePath = relativeFilePath;
        diagnostic.location.line = 12;
        diagnostic.location.column = 3;

        expect(formatScriptCompileDiagnosticSummary(diagnostic)).toBe(
            'Script compile failed: assets\\tests\\TestApi.ts:12:3 compile failed',
        );
    });

    test('extracts QuickPack wrapped file URI location from stack and relative path', () => {
        const error = new Error('QuickPack failed while compiling scripts');
        error.stack = [
            'Error: QuickPack failed while compiling scripts',
            '    at transform (file:///D:/project/assets/tests/TestApi.ts:12:3)',
            '    at compile (D:\\tools\\quick-pack.js:1:1)',
        ].join('\n');

        const diagnostic = createScriptCompileDiagnostic(error, {
            projectRoot,
            phase: 'refresh',
            target: 'preview',
            outputState: 'noUsableOutput',
        });

        expect(diagnostic.location.filePath).toBe(filePath);
        expect(diagnostic.location.relativeFilePath).toBe(relativeFilePath);
        expect(diagnostic.location.line).toBe(12);
        expect(diagnostic.location.column).toBe(3);
    });

    test('extracts Windows path location from message without trailing text', () => {
        const diagnostic = createScriptCompileDiagnostic(
            new Error('D:\\project\\assets\\tests\\TestApi.ts:12:3 compile failed'),
            {
                projectRoot,
                phase: 'refresh',
                target: 'preview',
                outputState: 'noUsableOutput',
            },
        );

        expect(diagnostic.location.filePath).toBe(filePath);
        expect(diagnostic.location.relativeFilePath).toBe(relativeFilePath);
        expect(diagnostic.location.line).toBe(12);
        expect(diagnostic.location.column).toBe(3);
    });

    test('extracts file URL location from message', () => {
        const diagnostic = createScriptCompileDiagnostic(
            new Error('QuickPack failed at file:///D:/project/assets/tests/TestApi.ts:12:3'),
            {
                projectRoot,
                phase: 'refresh',
                target: 'preview',
                outputState: 'noUsableOutput',
            },
        );

        expect(diagnostic.location.filePath).toBe(filePath);
        expect(diagnostic.location.relativeFilePath).toBe(relativeFilePath);
        expect(diagnostic.location.line).toBe(12);
        expect(diagnostic.location.column).toBe(3);
    });

    test('does not generate relative path for a Windows sibling project', () => {
        const siblingFilePath = 'D:\\project-other\\assets\\a.ts';
        const diagnostic = createScriptCompileDiagnostic(
            new Error(`${siblingFilePath}:1:2 compile failed`),
            {
                projectRoot,
                phase: 'refresh',
                target: 'preview',
                outputState: 'noUsableOutput',
            },
        );

        expect(diagnostic.location.filePath).toBe(siblingFilePath);
        expect(diagnostic.location.relativeFilePath).toBeUndefined();
        expect(diagnostic.location.line).toBe(1);
        expect(diagnostic.location.column).toBe(2);
    });

    test('extracts POSIX absolute path and relative path', () => {
        const diagnostic = createScriptCompileDiagnostic(
            new Error('/Users/me/project/assets/a.ts:1:2 compile failed'),
            {
                projectRoot: '/Users/me/project',
                phase: 'refresh',
                target: 'preview',
                outputState: 'noUsableOutput',
            },
        );

        expect(diagnostic.location.filePath).toBe('/Users/me/project/assets/a.ts');
        expect(diagnostic.location.relativeFilePath).toBe('assets/a.ts');
        expect(diagnostic.location.line).toBe(1);
        expect(diagnostic.location.column).toBe(2);
    });

    test('does not extract POSIX location from ordinary URLs', () => {
        for (const message of [
            'compile failed at https://host/path.ts:12:3',
            'compile failed at http://host/assets/a.ts:1:2',
        ]) {
            const diagnostic = createScriptCompileDiagnostic(new Error(message), {
                projectRoot: '/Users/me/project',
                phase: 'refresh',
                target: 'preview',
                outputState: 'noUsableOutput',
            });

            expect(diagnostic.location.filePath).toBeUndefined();
            expect(diagnostic.location.relativeFilePath).toBeUndefined();
            expect(diagnostic.location.line).toBeUndefined();
            expect(diagnostic.location.column).toBeUndefined();
        }
    });

    test('does not extract POSIX location from URL query values', () => {
        const diagnostic = createScriptCompileDiagnostic(
            new Error('compile failed at https://host/preview?file=/assets/a.ts:1:2'),
            {
                projectRoot: '/Users/me/project',
                phase: 'refresh',
                target: 'preview',
                outputState: 'noUsableOutput',
            },
        );

        expect(diagnostic.location.filePath).toBeUndefined();
        expect(diagnostic.location.relativeFilePath).toBeUndefined();
        expect(diagnostic.location.line).toBeUndefined();
        expect(diagnostic.location.column).toBeUndefined();
    });

    test('splits QuickPack wrapped Babel message into concise message and clean code frame', () => {
        const error = new SyntaxError([
            'E:\\own_space\\engines\\cocos-cli\\file:\\D:\\ps_copy\\p7\\trunk\\GameClient\\Client-fight-roguelike-migration\\assets\\tests\\TestApi.ts: Invalid left-hand side in assignment expression. (2047:0)',
            '',
            '\u001b[0m \u001b[90m 2046 |\u001b[39m }',
            '\u001b[31m\u001b[1m>\u001b[22m\u001b[39m\u001b[90m 2047 |\u001b[39m window\u001b[33m.\u001b[39m\u001b[33mTestRefresh\u001b[39m() \u001b[33m=\u001b[39m \u001b[36mfunction\u001b[39m (){',
            ' \u001b[90m      |\u001b[39m \u001b[31m\u001b[1m^\u001b[22m\u001b[39m',
            ' \u001b[90m 2048 |\u001b[39m     console\u001b[33m.\u001b[39mlog(\u001b[32m"refresh"\u001b[39m)',
        ].join('\n'));

        const diagnostic = createScriptCompileDiagnostic(error, {
            projectRoot: 'D:\\ps_copy\\p7\\trunk\\GameClient\\Client-fight-roguelike-migration',
            phase: 'refresh',
            target: 'preview',
            outputState: 'lastGoodDueToFailure',
        });

        expect(diagnostic.message).toBe('Invalid left-hand side in assignment expression.');
        expect(diagnostic.location.relativeFilePath).toBe('assets\\tests\\TestApi.ts');
        expect(diagnostic.location.line).toBe(2047);
        expect(diagnostic.location.column).toBe(0);
        expect(diagnostic.codeFrame).toContain('window.TestRefresh() = function (){');
        expect(diagnostic.codeFrame).not.toContain('\u001b');
    });

    test('generates a focused code frame with sourceLoader when codeFrame is missing', () => {
        const error = new Error('compile failed (4:2)');
        (error as Error & { file: string }).file = filePath;

        const diagnostic = createScriptCompileDiagnostic(error, {
            projectRoot,
            phase: 'refresh',
            target: 'preview',
            outputState: 'noUsableOutput',
            sourceLoader: () => [
                'line 1',
                'line 2',
                'line 3',
                'line 4',
                'line 5',
                'line 6',
                'line 7',
            ].join('\n'),
        });

        expect(diagnostic.codeFrame).toBe([
            '  2 | line 2',
            '  3 | line 3',
            '> 4 | line 4',
            '    |   ^',
            '  5 | line 5',
        ].join('\n'));
    });

    test('keeps diagnostic stable when sourceLoader throws', () => {
        const error = new Error('compile failed (4:2)');
        (error as Error & { file: string }).file = filePath;

        const diagnostic = createScriptCompileDiagnostic(error, {
            projectRoot,
            phase: 'refresh',
            target: 'preview',
            outputState: 'noUsableOutput',
            sourceLoader: () => {
                throw new Error('source unavailable');
            },
        });

        expect(diagnostic.message).toBe('compile failed');
        expect(diagnostic.location.filePath).toBe(filePath);
        expect(diagnostic.location.line).toBe(4);
        expect(diagnostic.location.column).toBe(2);
        expect(diagnostic.codeFrame).toBeUndefined();
    });

    test('keeps generic errors without location stable', () => {
        const diagnostic = createScriptCompileDiagnostic(new Error('generic failure'), {
            projectRoot,
            phase: 'startup',
            target: 'preview',
            outputState: 'noUsableOutput',
        });

        expect(diagnostic.message).toBe('generic failure');
        expect(diagnostic.location.filePath).toBeUndefined();
        expect(diagnostic.location.line).toBeUndefined();

        const lines = formatScriptCompileDiagnosticForConsole(diagnostic);
        expect(lines[0]).toBe('script-compile:failed phase=startup target=preview file=unknown');
        expect(lines.join('\n')).toContain('no usable output');
    });
});
