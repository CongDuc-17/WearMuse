const configuredUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim() ?? '';
const allowLocalHttp = process.env.EXPO_PUBLIC_ALLOW_LOCAL_HTTP === 'true';

export function validateApiConfiguration(value: string, allowHttp: boolean): string | null {
  if (!value) return 'Chưa kết nối dịch vụ AI. Ảnh vẫn được lưu trên thiết bị.';
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol)) {
      return 'Địa chỉ dịch vụ AI không hợp lệ.';
    }
    if (url.protocol === 'http:') {
      const host = url.hostname;
      const octets = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host.split('.').map(Number) : null;
      const privateIpv4 = octets?.length === 4 && octets.every((part) => part >= 0 && part <= 255) &&
        (octets[0] === 127 || octets[0] === 10 || octets[0] === 192 && octets[1] === 168 ||
          octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
      const privateHost = host === 'localhost' || host === '[::1]' || host.endsWith('.local') || privateIpv4;
      if (!allowHttp || !privateHost) return 'Chỉ dùng HTTP trong mạng phát triển nội bộ đã được cho phép.';
    }
    return null;
  } catch {
    return 'Địa chỉ dịch vụ AI không hợp lệ.';
  }
}

export const API_BASE_URL = configuredUrl.replace(/\/+$/, '');
export const configurationError = validateApiConfiguration(API_BASE_URL, allowLocalHttp);
