import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = dirname(fileURLToPath(import.meta.url));
const engineRoot = process.env.COCOS_CLI_TEST_ENGINE_ROOT;

if (!engineRoot) {
  throw new Error('Missing required environment variable: COCOS_CLI_TEST_ENGINE_ROOT');
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
    exclude: [
      'suites/runtime-preview/manifest-extraction.test.ts',
    ],
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
