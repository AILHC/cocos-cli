import { describe, expect, it, vi } from 'vitest';
import {
  createCommonJSBareSpecifierFallbackResolution,
  installCommonJSBareSpecifierFallback,
} from '../../../src/core/scripting/packer-driver/commonjs-bare-specifier-fallback';

describe('runtime preview script recovery', () => {
  it('falls back unresolved CommonJS bare specifiers to a visible CJS meta module', () => {
    const logger = { error: vi.fn() };
    const resolution = createCommonJSBareSpecifierFallbackResolution(
      '@scope/pkg/subpath',
      new URL('file:///project/assets/legacy-commonjs.js'),
      'commonjs',
      new Error('Module "@scope/pkg/subpath" not found'),
      logger,
    );

    expect(resolution?.resolved.type).toBe('module');
    const fallbackURL = resolution?.resolved.type === 'module' ? resolution.resolved.url : undefined;
    expect(fallbackURL?.protocol).toBe('data:');
    expect(decodeURIComponent(fallbackURL?.href ?? '')).toContain("export const __cjsMetaURL = '@scope/pkg/subpath';");
    expect(resolution?.messages).toEqual([
      expect.objectContaining({
        level: 'error',
        text: expect.stringContaining('@scope/pkg/subpath'),
      }),
    ]);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Module "@scope/pkg/subpath" not found'));
  });

  it.each([
    ['./local', 'commonjs'],
    ['../local', 'commonjs'],
    ['/abs/path', 'commonjs'],
    ['C:/abs/path', 'commonjs'],
    ['file:///x.js', 'commonjs'],
    ['node:fs', 'commonjs'],
    ['q-bundled:///virtual/cc.js', 'commonjs'],
    ['cce:/internal/x/cc', 'commonjs'],
    ['pkg', 'esm'],
    ['pkg', 'json'],
  ])('does not fall back unsupported specifier or module type: %s %s', (specifier, moduleType) => {
    const logger = { error: vi.fn() };

    expect(createCommonJSBareSpecifierFallbackResolution(
      specifier,
      new URL('file:///project/assets/entry.ts'),
      moduleType,
      new Error('missing'),
      logger,
    )).toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('wraps QuickPack private resolve while preserving successful non-module resolutions', () => {
    const externalResolution = {
      resolved: {
        type: 'external',
        source: 'cc',
      },
      messages: [],
    };
    const quickPack = {
      _resolve: vi.fn(() => externalResolution),
    };
    const logger = { error: vi.fn(), warn: vi.fn() };

    installCommonJSBareSpecifierFallback(quickPack as any, logger as any);

    expect(quickPack._resolve(
      { value: 'cc' },
      new URL('file:///project/assets/entry.ts'),
      'esm',
    )).toBe(externalResolution);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('rethrows unsupported private resolve failures instead of hiding them', () => {
    const originalError = new Error('relative module missing');
    const quickPack = {
      _resolve: vi.fn(() => {
        throw originalError;
      }),
    };
    const logger = { error: vi.fn(), warn: vi.fn() };

    installCommonJSBareSpecifierFallback(quickPack as any, logger as any);

    expect(() => quickPack._resolve(
      { value: './missing' },
      new URL('file:///project/assets/entry.ts'),
      'commonjs',
    )).toThrow(originalError);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('warns when QuickPack private resolve is unavailable', () => {
    const quickPack = {};
    const logger = { error: vi.fn(), warn: vi.fn() };

    installCommonJSBareSpecifierFallback(quickPack as any, logger as any);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('_resolve is unavailable'));
  });
});
