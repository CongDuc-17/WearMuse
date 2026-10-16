import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, IconButton } from '@/components/Button';
import { GarmentPreview } from '@/components/GarmentPreview';
import { Icon } from '@/components/Icon';
import { ProcessingIndicator } from '@/components/ProcessingIndicator';
import { colors, fonts, layout } from '@/constants/tokens';
import { deleteGarment } from '@/features/wardrobe/actions';
import { useGarment } from '@/hooks/useGarment';
import { useWardrobe } from '@/hooks/useWardrobe';
import { checkAIConnection } from '@/services/api/connection';
import { retryGarment } from '@/services/queue/synchronization';
import type { GarmentStatus } from '@/types/garment';

const descriptions: Record<GarmentStatus, string> = {
  local_saved: 'Ảnh gốc đã được lưu an toàn trên thiết bị. AI sẽ tự động tách nền khi có kết nối.',
  upload_queued: 'Ảnh gốc đã được lưu. Món đồ sẽ tự động được xử lý khi có kết nối.',
  uploading: 'Đang gửi ảnh để tách nền. Bạn có thể tiếp tục chụp thêm món đồ.',
  queued: 'Ảnh đã được nhận và đang chờ tách nền. Bạn không cần đợi ở màn hình này.',
  processing: 'AI đang tách nền. Ảnh sẽ tự động cập nhật khi hoàn tất.',
  ready: 'Ảnh tách nền đã sẵn sàng và được lưu trên thiết bị của bạn.',
  needs_review: 'Kết quả tách nền chưa đạt chất lượng. Ảnh gốc vẫn được giữ lại; bạn có thể thử xử lý lại.',
  failed: 'Chưa thể xử lý ảnh này. Ảnh gốc vẫn an toàn trên thiết bị. Hãy thử lại khi có kết nối.',
};

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function GarmentDetailScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const garment = useGarment(id ?? '');
  const { loading } = useWardrobe();
  const [busy, setBusy] = useState<'retry' | 'delete' | 'connection' | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const onPreviewError = useCallback(() => setPreviewError(true), []);

  async function checkConnection() {
    if (busy) return;
    setBusy('connection');
    try {
      const { baseUrl } = await checkAIConnection();
      Alert.alert('Đã kết nối dịch vụ AI', `Máy chủ AI đã phản hồi đúng tại:\n${baseUrl}\n\nBạn có thể thử lại món đồ này.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Chưa thể kiểm tra kết nối. Hãy thử lại.';
      Alert.alert('Chưa kết nối được AI', message);
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    if (!garment || busy) return;
    setBusy('retry');
    try {
      await retryGarment(garment.localId);
      setPreviewError(false);
    } catch {
      Alert.alert('Chưa thể thử lại', 'Ảnh gốc vẫn được giữ an toàn. Vui lòng thử lại sau.');
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete() {
    if (!garment || busy) return;
    Alert.alert('Xóa món đồ này?', 'Ảnh và dữ liệu của món đồ sẽ được xóa khỏi thiết bị này.', [
      { text: 'Giữ lại', style: 'cancel' },
      { text: 'Xóa món đồ', style: 'destructive', onPress: () => { void remove(); } },
    ]);
  }

  async function remove() {
    if (!garment) return;
    setBusy('delete');
    try {
      await deleteGarment(garment.localId);
      goBack();
    } catch {
      Alert.alert('Chưa thể xóa hoàn tất', 'Vui lòng trở về tủ đồ và thử lại.');
    } finally {
      setBusy(null);
    }
  }

  const awaitingCutout = garment?.status === 'ready' && !garment.cutoutLocalUri;
  const displayStatus = awaitingCutout ? 'processing' : garment?.status;
  const canRetry = garment && (garment.status === 'failed' || garment.status === 'needs_review' || garment.status === 'ready' && (!garment.cutoutLocalUri && Boolean(garment.lastError) || previewError));
  const hasUploadFailure = garment && !garment.remoteId && (garment.status === 'failed' || garment.status === 'upload_queued' && garment.uploadAttempts > 0);
  const canCheckConnection = garment && (garment.status === 'failed' || garment.status !== 'needs_review' && Boolean(garment.lastError) || previewError);
  const retryTitle = garment?.status === 'ready' ? 'Tải lại ảnh tách nền' : garment?.remoteId ? 'Thử xử lý lại' : 'Thử gửi lại ảnh';
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        <View style={styles.header}>
          <IconButton name="arrow-left" label="Quay lại tủ đồ" onPress={goBack} disabled={busy === 'delete'} />
          <Text style={styles.headerTitle}>MÓN ĐỒ CỦA BẠN</Text>
          <View style={styles.headerSpacer} />
        </View>
        {!garment ? (
          <View style={styles.missing}>
            {loading ? <ActivityIndicator color={colors.accent} /> : <>
              <Icon name="image" size={34} color={colors.muted} />
              <Text style={styles.missingTitle}>Món đồ không còn trong tủ</Text>
              <Text style={styles.missingText}>Quay lại để xem những món đồ khác của bạn.</Text>
              <Button title="Về tủ đồ" onPress={goBack} style={styles.missingButton} />
            </>}
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <GarmentPreview key={garment.localId} garment={garment} style={styles.preview} onPreviewError={onPreviewError} />
            <View style={styles.info}>
              <View style={styles.meta}>
                <Text style={styles.eyebrow}>BỘ SƯU TẬP CÁ NHÂN</Text>
                <Text style={styles.date}>{new Date(garment.createdAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}</Text>
              </View>
              <Text style={styles.title}>Món đồ của bạn.</Text>
              <ProcessingIndicator status={displayStatus ?? garment.status} />
              <Text style={styles.description}>{hasUploadFailure
                ? garment.status === 'upload_queued'
                  ? 'Ảnh đã được lưu trên thiết bị nhưng chưa gửi được tới máy chủ. Ứng dụng sẽ tự động thử lại; bạn vẫn có thể chụp thêm món đồ.'
                  : 'Ảnh đã được lưu trên thiết bị nhưng chưa gửi được tới máy chủ. Hãy kiểm tra kết nối hoặc thử gửi lại ảnh.'
                : garment.status === 'failed' && garment.remoteId
                  ? 'Máy chủ đã nhận ảnh. Chưa thể hoàn tất xử lý hoặc đồng bộ kết quả; ảnh gốc vẫn được giữ trên thiết bị.'
                : garment.status === 'ready' && (previewError || awaitingCutout && garment.lastError)
                ? 'Ảnh gốc vẫn được giữ. Ảnh tách nền chưa khả dụng trên thiết bị; bạn có thể thử tải lại.'
                : awaitingCutout ? 'AI đã tách nền. Đang lưu ảnh hoàn tất về thiết bị; ảnh sẽ tự động cập nhật.' : descriptions[garment.status]}</Text>
              {garment.lastError && <View style={styles.failure} accessibilityRole="alert">
                <Icon name="alert-circle" size={18} color={colors.warning} />
                <View style={styles.failureCopy}>
                  <Text style={styles.failureTitle}>{!garment.remoteId ? 'Chưa gửi được ảnh' : garment.status === 'needs_review' ? 'Kết quả cần kiểm tra' : 'Lý do chưa hoàn tất'}</Text>
                  <Text style={styles.failureMessage}>{garment.lastError}</Text>
                </View>
              </View>}
              <View style={styles.rule} />
              {canRetry && <Button title={retryTitle} icon="refresh-cw" onPress={() => { void retry(); }} loading={busy === 'retry'} disabled={busy !== null} style={styles.action} />}
              {canCheckConnection && <Button title="Kiểm tra kết nối AI" icon="wifi" variant="secondary" onPress={() => { void checkConnection(); }} loading={busy === 'connection'} disabled={busy !== null} style={styles.action} accessibilityHint="Kiểm tra máy chủ AI đang dùng, không gửi ảnh hoặc thay đổi món đồ" />}
              <Button title="Xóa món đồ" icon="trash-2" variant="danger" onPress={confirmDelete} loading={busy === 'delete'} disabled={busy !== null} />
              <View style={styles.savedNote}><Icon name="check-circle" size={13} color={colors.muted} /><Text style={styles.savedText}>Ảnh gốc được lưu trên thiết bị của bạn</Text></View>
            </View>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, maxWidth: layout.maxWidth, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12 },
  headerTitle: { fontSize: 9, fontWeight: '600', letterSpacing: 1.7, color: colors.muted, flexShrink: 1, textAlign: 'center' },
  headerSpacer: { width: 48 },
  scroll: { paddingHorizontal: layout.gutter, paddingTop: 10, paddingBottom: 28 },
  preview: { width: '100%', aspectRatio: 3 / 4, borderRadius: 14 },
  info: { paddingTop: 25 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  eyebrow: { color: colors.muted, fontSize: 8, letterSpacing: 1.5 },
  date: { color: colors.muted, fontSize: 10 },
  title: { fontFamily: fonts.editorial, fontSize: 31, color: colors.ink, letterSpacing: -0.9, marginTop: 12, marginBottom: 18 },
  description: { color: colors.muted, fontSize: 13, lineHeight: 22, marginTop: 14 },
  failure: { flexDirection: 'row', gap: 10, backgroundColor: colors.warningLight, borderRadius: 12, padding: 14, marginTop: 16 },
  failureCopy: { flex: 1, gap: 5 },
  failureTitle: { color: colors.warning, fontSize: 12, fontWeight: '600', lineHeight: 19 },
  failureMessage: { color: colors.warning, fontSize: 12, lineHeight: 20 },
  rule: { height: 1, backgroundColor: colors.line, marginVertical: 24 },
  action: { marginBottom: 12 },
  savedNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 18 },
  savedText: { color: colors.muted, fontSize: 10 },
  missing: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 15 },
  missingTitle: { color: colors.ink, fontFamily: fonts.editorial, fontSize: 24, textAlign: 'center' },
  missingText: { color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 21 },
  missingButton: { marginTop: 15 },
});
