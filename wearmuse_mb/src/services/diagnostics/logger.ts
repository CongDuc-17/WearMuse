type DiagnosticValue = string | number | boolean | null | undefined;
export type DiagnosticDetails = Record<string, DiagnosticValue>;

/** Keep useful native error text without exposing images, credentials, or device file locations. */
export function sanitizeDiagnosticMessage(message: string): string {
  return message
    .replace(/(["'])(?:file|content|ph|assets-library|https?):\/\/.*?\1/gi, '[uri]')
    .replace(/\b(?:file|content|ph|assets-library|https?):\/\/[^\s"'<>]+/gi, '[uri]')
    .replace(/\b[A-Za-z]:[\\/][^\r\n"'<>]+/g, '[path]')
    .replace(/\/(?:[^\s/"'<>]+\/)+[^\s"'<>]*/g, '[path]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[credential]')
    .replace(/\b(token|authorization|api[-_]?key|password|secret|cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[A-Za-z0-9+/=_-]{100,}/g, '[data]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 240);
}

function errorRecord(error: unknown): Record<string, unknown> | null {
  return error && typeof error === 'object' ? error as Record<string, unknown> : null;
}

export function diagnosticError(error: unknown): DiagnosticDetails {
  const record = errorRecord(error);
  const cause = errorRecord(record?.cause);
  return {
    errorName: typeof record?.name === 'string' ? record.name : 'UnknownError',
    message: typeof record?.message === 'string' ? sanitizeDiagnosticMessage(record.message) : 'Unknown error',
    kind: typeof record?.kind === 'string' ? record.kind : 'native',
    status: typeof record?.status === 'number' ? record.status : null,
    retryable: typeof record?.retryable === 'boolean' ? record.retryable : undefined,
    code: typeof record?.code === 'string' ? sanitizeDiagnosticMessage(record.code) : undefined,
    causeName: typeof cause?.name === 'string' ? cause.name : undefined,
    causeMessage: typeof cause?.message === 'string' ? sanitizeDiagnosticMessage(cause.message) : undefined,
  };
}

/** Development only: Metro receives one structured line and never a raw Error, URI, or response body. */
export function logDiagnostic(stage: string, details: DiagnosticDetails = {}): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  const safe: DiagnosticDetails = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined) continue;
    safe[key] = typeof value === 'string' ? sanitizeDiagnosticMessage(value) : value;
  }
  console.info(`[WearMuseMeow] ${stage}`, JSON.stringify(safe));
}
