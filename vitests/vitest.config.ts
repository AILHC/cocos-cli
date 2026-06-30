import { defineConfig } from 'vitest/config';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = dirname(fileURLToPath(import.meta.url));
const configuredProjectRoot = process.env.COCOS_CLI_TEST_PROJECT_ROOT;
const configuredEngineRoot = process.env.COCOS_CLI_TEST_ENGINE_ROOT;

function readProjectEngineRoot(projectRoot: string): string | undefined {
  const packageJsonPath = resolve(projectRoot, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    'cocos-cli'?: {
      enginePath?: unknown;
    };
  };
  const enginePath = packageJson['cocos-cli']?.enginePath;
  if (typeof enginePath !== 'string' || !enginePath.trim()) {
    return undefined;
  }
  return isAbsolute(enginePath)
    ? resolve(enginePath)
    : resolve(projectRoot, enginePath);
}

const projectEngineRoot = configuredProjectRoot
  ? readProjectEngineRoot(configuredProjectRoot)
  : undefined;
const engineRoot = configuredEngineRoot
  ? resolve(configuredEngineRoot)
  : projectEngineRoot;

if (!engineRoot) {
  throw new Error('Missing COCOS_CLI_TEST_ENGINE_ROOT. When a test uses COCOS_CLI_TEST_PROJECT_ROOT, prefer deriving it from that project package.json cocos-cli.enginePath.');
}

if (projectEngineRoot && configuredEngineRoot && resolve(configuredEngineRoot) !== projectEngineRoot) {
  throw new Error([
    'COCOS_CLI_TEST_ENGINE_ROOT does not match COCOS_CLI_TEST_PROJECT_ROOT package.json cocos-cli.enginePath.',
    `projectRoot=${resolve(configuredProjectRoot!)}`,
    `projectEngineRoot=${projectEngineRoot}`,
    `envEngineRoot=${resolve(configuredEngineRoot)}`,
    'Use the project-configured engine root unless the test explicitly documents an override.',
  ].join('\n'));
}

export default defineConfig({
  root,
  plugins: [
    {
      name: 'cocos-engine-source-typescript-transform',
      enforce: 'pre',
      transform(code, id) {
        const normalizedId = id.split('?')[0].replace(/\\/g, '/');
        const normalizedEngineRoot = engineRoot.replace(/\\/g, '/');
        if (!normalizedId.startsWith(normalizedEngineRoot) || !normalizedId.endsWith('.ts')) {
          return null;
        }

        const result = ts.transpileModule(code, {
          compilerOptions: {
            experimentalDecorators: true,
            module: ts.ModuleKind.ES2022,
            target: ts.ScriptTarget.ES2015,
            useDefineForClassFields: false,
          },
          fileName: normalizedId,
        });

        return { code: result.outputText, map: null };
      },
    },
  ],
  test: {
    environment: 'jsdom',
    setupFiles: [resolve(root, 'shared/setup-engine-env.ts')],
    include: ['suites/**/*.test.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@runtime-preview': resolve(root, '../src/runtime-preview'),
      '@shared': resolve(root, 'shared'),
      '@engine-source-root': engineRoot,
      'external:emscripten/meshopt/meshopt_decoder.asm.js': resolve(root, 'shared/meshopt-decoder-asm.ts'),
      'external:emscripten/meshopt/meshopt_decoder.wasm.js': resolve(root, 'shared/meshopt-decoder-wasm.ts'),
      'external:emscripten/meshopt/meshopt_decoder.wasm.wasm': resolve(root, 'shared/meshopt-decoder-wasm-url.ts'),
      'internal:constants': resolve(root, 'shared/cocos-internal-constants.ts'),
      'internal:native': resolve(root, 'shared/cocos-internal-native.ts'),
      'pal/env': resolve(root, 'shared/pal-env.ts'),
      'pal/input': resolve(root, 'shared/pal-input.ts'),
      'pal/minigame': resolve(engineRoot, 'pal/minigame/non-minigame.ts'),
      'pal/pacer': resolve(root, 'shared/pal-pacer.ts'),
      'pal/screen-adapter/enum-type': resolve(engineRoot, 'pal/screen-adapter/enum-type/index.ts'),
      'pal/screen-adapter': resolve(root, 'shared/pal-screen-adapter.ts'),
      'pal/system-info/enum-type': resolve(engineRoot, 'pal/system-info/enum-type/index.ts'),
      'pal/system-info': resolve(root, 'shared/pal-system-info.ts'),
      'pal/wasm': resolve(root, 'shared/pal-wasm.ts'),
      'cc/preload': resolve(root, '../packages/cc-module/preload.js'),
      'cc/env': resolve(root, 'shared/cocos-internal-constants.ts'),
      'cc.decorator': resolve(engineRoot, 'cocos/core/data/decorators/index.ts'),
      cc: resolve(root, 'shared/cocos-cc-source-entry.ts'),
    },
  },
  server: {
    fs: {
      allow: [resolve(root, '..'), engineRoot],
    },
  },
  esbuild: {
    target: 'es2022',
    tsconfigRaw: {
      compilerOptions: {
        useDefineForClassFields: false,
      },
    },
  },
});
