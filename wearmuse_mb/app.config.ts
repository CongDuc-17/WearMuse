import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const localHttp = process.env.EXPO_PUBLIC_ALLOW_LOCAL_HTTP === 'true';
  if (process.env.EAS_BUILD_PROFILE === 'production' && (localHttp || process.env.EXPO_PUBLIC_API_BASE_URL?.startsWith('http:'))) {
    throw new Error('Disable EXPO_PUBLIC_ALLOW_LOCAL_HTTP for production builds.');
  }
  return {
    ...config,
    name: 'WearMuseMeow',
    slug: 'wearmusemeow',
    scheme: 'wearmusemeow',
    userInterfaceStyle: 'automatic',
    ios: {
      ...config.ios,
      bundleIdentifier: 'com.wearmusemeow.mobile',
      infoPlist: {
        ...config.ios?.infoPlist,
        NSLocalNetworkUsageDescription: 'Kết nối dịch vụ AI trên máy tính trong mạng nội bộ để xử lý ảnh trang phục.',
        NSAppTransportSecurity: localHttp
          ? { NSAllowsArbitraryLoads: true, NSAllowsLocalNetworking: true }
          : { NSAllowsArbitraryLoads: false },
      },
    },
    android: {
      ...config.android,
      package: 'com.wearmusemeow.mobile',
      blockedPermissions: ['android.permission.RECORD_AUDIO'],
    },
    plugins: [
      'expo-router',
      ['expo-splash-screen', { image: './assets/images/splash-icon.png', imageWidth: 76 }],
      ['expo-camera', {
        cameraPermission: 'Cho phép WearMuseMeow dùng máy ảnh để lưu trang phục vào tủ đồ của bạn.',
        recordAudioAndroid: false,
        microphonePermission: false,
      }],
      ['expo-image-picker', {
        photosPermission: 'Chọn ảnh trang phục để thêm vào tủ đồ của bạn.',
        cameraPermission: false,
        microphonePermission: false,
      }],
      'expo-sqlite',
      ['expo-build-properties', { android: { usesCleartextTraffic: localHttp } }],
    ],
  };
};
