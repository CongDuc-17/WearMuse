import { API_BASE_URL, configurationError } from '../../config/env';
import { ApiClient } from './client';

/** A small read-only probe; success confirms API transport, not GPU worker health. */
export function createConnectionCheck(
  baseUrl: string,
  configError: string | null,
  client: Pick<ApiClient, 'request'>,
) {
  return async (): Promise<{ baseUrl: string }> => {
    if (configError) throw new Error(configError);
    try {
      const result = await client.request('/health');
      if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
        throw new Error('Máy chủ trả lời nhưng không xác nhận dịch vụ AI sẵn sàng.');
      }
      return { baseUrl };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể kiểm tra kết nối dịch vụ AI.';
      throw new Error(`${message}\nĐịa chỉ: ${baseUrl}`);
    }
  };
}

export const checkAIConnection = createConnectionCheck(
  API_BASE_URL, configurationError, new ApiClient(API_BASE_URL, fetch, 8_000),
);
