import { diagnosticError, logDiagnostic } from '../diagnostics/logger';

export type ApiFailureKind = 'network' | 'timeout' | 'server' | 'invalid_image' | 'multipart' | 'permanent' | 'protocol' | 'configuration';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ApiFailureKind,
    readonly retryable: boolean,
    readonly status: number | null = null,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function abortError(): Error {
  const error = new Error('Đã tạm dừng đồng bộ.');
  error.name = 'AbortError';
  return error;
}

/** Link cancellation without relying on AbortSignal.any, which is not universal on mobile. */
export function linkedController(signal?: AbortSignal): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  return { controller, dispose: () => signal?.removeEventListener('abort', abort) };
}

export class ApiClient {
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 30_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  resolveUrl(path: string): string {
    try {
      const url = new URL(path, `${this.baseUrl}/`);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      return url.toString();
    } catch {
      throw new ApiError('Địa chỉ máy chủ hoặc ảnh không hợp lệ.', 'configuration', false);
    }
  }

  async request(
    path: string,
    options: RequestInit = {},
    signal?: AbortSignal,
    diagnosticContext: { localId?: string; operation?: string } = {},
  ): Promise<unknown> {
    if (!this.baseUrl) throw new ApiError('Chưa cấu hình địa chỉ máy chủ AI.', 'configuration', false);
    if (signal?.aborted) throw abortError();
    const { controller, dispose } = linkedController(signal);
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    try {
      logDiagnostic('request_started', { ...diagnosticContext, method: options.method ?? 'GET' });
      const response = await this.fetcher(this.resolveUrl(path), {
        ...options,
        headers: { Accept: 'application/json', ...options.headers },
        signal: controller.signal,
      });
      logDiagnostic('request_response', { ...diagnosticContext, status: response.status });
      if (!response.ok) {
        const status = response.status;
        const invalid = [400, 413, 415, 422].includes(status);
        const retryable = status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
        throw new ApiError(
          invalid ? 'Ảnh không hợp lệ hoặc quá lớn. Hãy thử ảnh khác.'
            : status === 404 ? 'Không tìm thấy món đồ trên máy chủ.'
              : retryable ? 'Máy chủ AI tạm thời chưa sẵn sàng. Ứng dụng sẽ thử lại.'
                : `Máy chủ từ chối yêu cầu (${status}).`,
          invalid ? 'invalid_image' : status >= 500 ? 'server' : 'permanent', retryable, status,
        );
      }
      try { return await response.json(); }
      catch (error) { throw new ApiError('Phản hồi từ máy chủ AI không hợp lệ.', 'protocol', true, null, error); }
    } catch (error) {
      logDiagnostic(signal?.aborted ? 'request_cancelled' : 'request_error', {
        ...diagnosticContext, ...diagnosticError(error), timedOut,
      });
      if (signal?.aborted) throw abortError();
      if (timedOut) throw new ApiError('Máy chủ AI phản hồi quá lâu. Ứng dụng sẽ thử lại.', 'timeout', true, null, error);
      if (error instanceof ApiError) throw error;
      if (isAbortError(error)) throw error;
      if (error instanceof Error && /^Unsupported FormData(?:Part)? implementation$/.test(error.message)) {
        throw new ApiError('Ứng dụng chưa thể tạo dữ liệu gửi ảnh. Hãy tải lại ứng dụng rồi thử lại.', 'multipart', false, null, error);
      }
      throw new ApiError('Không thể kết nối máy chủ AI. Ảnh đã được lưu trên thiết bị.', 'network', true, null, error);
    } finally {
      clearTimeout(timeout);
      dispose();
    }
  }
}

