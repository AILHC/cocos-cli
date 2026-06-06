import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';

export async function ensureWasmModuleReady(): Promise<void> {}

function engineRoot(): string {
  const value = process.env.COCOS_CLI_TEST_ENGINE_ROOT;
  if (!value) {
    throw new Error('Missing required environment variable: COCOS_CLI_TEST_ENGINE_ROOT');
  }
  return value;
}

function resolveExternalUrl(url: string): string {
  if (url.startsWith('external:')) {
    const relativePath = url.slice('external:'.length).replace(/\//g, '\\');
    const absolutePath = normalize(join(engineRoot(), 'native', 'external', relativePath));
    const externalRoot = normalize(join(engineRoot(), 'native', 'external'));
    if (!absolutePath.startsWith(externalRoot)) {
      throw new Error(`External WASM path escaped engine external root: ${url}`);
    }
    return absolutePath;
  }

  return url;
}

export async function instantiateWasm(
  wasmUrl: string,
  importObject: WebAssembly.Imports,
): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
  const arrayBuffer = await fetchBuffer(wasmUrl);
  return WebAssembly.instantiate(arrayBuffer, importObject);
}

export async function fetchBuffer(binaryUrl: string): Promise<ArrayBuffer> {
  const buffer = await readFile(resolveExternalUrl(binaryUrl));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export async function fetchUrl(binaryUrl: string): Promise<string> {
  return resolveExternalUrl(binaryUrl);
}
