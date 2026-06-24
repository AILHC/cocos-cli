import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCliIntegrationFixturePaths } from '@shared/fixture-paths';
import {
  canListen,
  startRuntimePreviewCliProcess,
} from '@shared/runtime-preview-cli-process';

async function findAvailablePort(startPort: number, attempts: number): Promise<number> {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = startPort + offset;
    if (await canListen(port)) {
      return port;
    }
  }

  throw new Error(`No available runtime preview test port in range ${startPort}-${startPort + attempts - 1}.`);
}

describe('runtime preview debug settings semantics', () => {
  it('serves uncompressed debug bundle config from real CLI preview settings', async () => {
    const paths = getCliIntegrationFixturePaths();
    const repoRoot = join(process.cwd(), '..');
    const port = await findAvailablePort(19701, 50);

    const cli = await startRuntimePreviewCliProcess({
      repoRoot,
      projectRoot: paths.projectRoot,
      engineRoot: paths.engineRoot,
      editorLibraryRef: paths.editorLibraryRef,
      editorProgrammingRef: paths.editorProgrammingRef,
      host: '127.0.0.1',
      port,
      startupTimeoutMs: 120_000,
    });

    let closeResult: Awaited<ReturnType<typeof cli.close>> | null = null;
    try {
      const internalConfigResponse = await fetch(`${cli.url}/assets/internal/config.json`);
      expect(internalConfigResponse.status).toBe(200);
      const internalConfig = await internalConfigResponse.json() as {
        name: string;
        debug?: boolean;
        types?: unknown[];
        paths?: Record<string, unknown[]>;
      };

      expect(internalConfig.name).toBe('internal');
      expect(internalConfig.debug).toBe(true);
      expect(internalConfig.types).toBeUndefined();
      const firstInternalPath = Object.values(internalConfig.paths ?? {})[0];
      expect(Array.isArray(firstInternalPath)).toBe(true);
      expect(typeof firstInternalPath?.[1]).toBe('string');
    } finally {
      closeResult = await cli.close();
    }

    expect(closeResult.portReleased).toBe(true);
  }, 180_000);
});
