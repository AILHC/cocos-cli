export interface RuntimePreviewStrictAcceptanceEvidence {
  readyTimedOut: boolean;
  consoleMessages: Array<{ type: string }>;
  unhandledRejections: unknown[];
  pageErrors: unknown[];
  failedRequests: unknown[];
  badResponses: unknown[];
}

export function classifyRuntimePreviewStrictAcceptanceFailures(
  evidence: RuntimePreviewStrictAcceptanceEvidence,
): string[] {
  const failures: string[] = [];
  const consoleErrors = evidence.consoleMessages.filter((message) => message.type === 'error');

  if (evidence.readyTimedOut) {
    failures.push('ready timed out');
  }
  if (evidence.pageErrors.length > 0) {
    failures.push(`pageErrors=${evidence.pageErrors.length}`);
  }
  if (evidence.unhandledRejections.length > 0) {
    failures.push(`unhandledRejections=${evidence.unhandledRejections.length}`);
  }
  if (evidence.failedRequests.length > 0) {
    failures.push(`failedRequests=${evidence.failedRequests.length}`);
  }
  if (evidence.badResponses.length > 0) {
    failures.push(`badResponses=${evidence.badResponses.length}`);
  }
  if (consoleErrors.length > 0) {
    failures.push(`consoleErrors=${consoleErrors.length}`);
  }

  return failures;
}
