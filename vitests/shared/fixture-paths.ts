import { existsSync } from 'node:fs';

export interface RuntimePreviewFixturePaths {
  projectRoot: string;
  engineRoot: string;
  editorLibraryRef: string;
  editorProgrammingRef: string;
}

function requirePath(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  if (!existsSync(value)) {
    throw new Error(`Path from ${name} does not exist: ${value}`);
  }
  return value;
}

export function getFixturePaths(): RuntimePreviewFixturePaths {
  return {
    projectRoot: requirePath('COCOS_CLI_TEST_PROJECT_ROOT'),
    engineRoot: requirePath('COCOS_CLI_TEST_ENGINE_ROOT'),
    editorLibraryRef: requirePath('COCOS_CLI_TEST_EDITOR_LIBRARY_REF'),
    editorProgrammingRef: requirePath('COCOS_CLI_TEST_EDITOR_PROGRAMMING_REF'),
  };
}
