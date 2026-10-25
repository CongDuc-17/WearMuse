import { router, useLocalSearchParams } from 'expo-router';
import { Alert as Notice, Card, Separator, Spinner, Tabs } from 'heroui-native';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from '@/components/SafeAreaView';
import { Button, IconButton } from '@/components/Button';
import { GarmentPreview } from '@/components/GarmentPreview';
import { ProcessingIndicator } from '@/components/ProcessingIndicator';
import { layout } from '@/constants/tokens';
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
  const [showOriginal, setShowOriginal] = useState(false);
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
  const originalPreview = showOriginal || garment?.status !== 'ready' || !garment.cutoutLocalUri || previewError;
  const statusDescription = hasUploadFailure
    ? garment.status === 'upload_queued'
      ? 'Ảnh đã lưu trên thiết bị nhưng chưa gửi được tới máy chủ. Ứng dụng sẽ tự thử lại; bạn vẫn có thể chụp thêm.'
      : 'Ảnh đã lưu trên thiết bị nhưng chưa gửi được tới máy chủ. Kiểm tra kết nối hoặc thử gửi lại ảnh.'
    : garment?.status === 'failed' && garment.remoteId
      ? 'Máy chủ đã nhận ảnh nhưng chưa hoàn tất xử lý. Ảnh gốc vẫn được giữ trên thiết bị.'
      : garment?.status === 'ready' && (previewError || awaitingCutout && garment.lastError)
        ? 'Ảnh tách nền chưa khả dụng trên thiết bị. Bạn có thể tải lại; ảnh gốc vẫn được giữ.'
        : awaitingCutout ? 'AI đã tách nền. Đang lưu kết quả về thiết bị.' : garment ? descriptions[garment.status] : '';

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="w-full flex-1 self-center" style={{ maxWidth: layout.maxWidth }}>
        <View className="flex-row items-center gap-3 px-5 py-3">
          <IconButton name="arrow-left" label="Quay lại tủ đồ" onPress={goBack} disabled={busy === 'delete'} />
          <Text accessibilityRole="header" className="flex-1 text-xl font-semibold text-foreground">Chi tiết món đồ</Text>
        </View>
        {!garment ? (
          <View className="flex-1 justify-center gap-4 px-5">
            {loading ? <Spinner /> : <Card>
              <Card.Body><Card.Title>Món đồ không còn trong tủ</Card.Title><Card.Description>Quay lại để xem những món đồ khác của bạn.</Card.Description></Card.Body>
              <Card.Footer><Button title="Về tủ đồ" onPress={goBack} /></Card.Footer>
            </Card>}
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: layout.gutter, gap: 20 }}>
            <Tabs value={originalPreview ? 'original' : 'cutout'} onValueChange={(value) => setShowOriginal(value === 'original')}>
              <Tabs.List>
                <Tabs.Indicator />
                <Tabs.Trigger value="original" className="min-h-12"><Tabs.Label>Ảnh gốc</Tabs.Label></Tabs.Trigger>
                <Tabs.Trigger value="cutout" className="min-h-12" isDisabled={!garment.cutoutLocalUri || garment.status !== 'ready' || previewError}><Tabs.Label>Ảnh tách nền</Tabs.Label></Tabs.Trigger>
              </Tabs.List>
            </Tabs>
            <Card>
              <GarmentPreview key={garment.localId} garment={garment} showOriginal={originalPreview}
                style={{ width: '100%', aspectRatio: 3 / 4, maxHeight: 520 }} onPreviewError={onPreviewError} />
            </Card>
            <Card>
              <Card.Header><ProcessingIndicator status={displayStatus ?? garment.status} /></Card.Header>
              <Card.Body>
                <Card.Title>Trạng thái xử lý</Card.Title>
                <Card.Description>{statusDescription}</Card.Description>
                <Text className="text-sm text-muted">Đã thêm {new Date(garment.createdAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}</Text>
              </Card.Body>
            </Card>
            {garment.lastError && <Notice status="warning" accessibilityRole="alert">
              <Notice.Indicator /><Notice.Content>
                <Notice.Title>{!garment.remoteId ? 'Chưa gửi được ảnh' : garment.status === 'needs_review' ? 'Kết quả cần kiểm tra' : 'Chưa hoàn tất xử lý'}</Notice.Title>
                <Notice.Description>{garment.lastError}</Notice.Description>
              </Notice.Content>
            </Notice>}
            <View className="gap-3">
              {canRetry && <Button title={retryTitle} icon="refresh-cw" onPress={() => { void retry(); }} loading={busy === 'retry'} disabled={busy !== null} />}
              {canCheckConnection && <Button title="Kiểm tra kết nối AI" icon="wifi" variant="secondary" onPress={() => { void checkConnection(); }} loading={busy === 'connection'} disabled={busy !== null} accessibilityHint="Kiểm tra máy chủ AI, không gửi ảnh hoặc thay đổi món đồ" />}
            </View>
            <Separator />
            <Button title="Xóa món đồ" icon="trash-2" variant="danger" onPress={confirmDelete} loading={busy === 'delete'} disabled={busy !== null} />
            <Text className="pb-3 text-center text-sm text-muted">Ảnh gốc được lưu trên thiết bị của bạn.</Text>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}
