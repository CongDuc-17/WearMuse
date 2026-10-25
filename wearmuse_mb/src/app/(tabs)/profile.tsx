import { Accordion, Alert, Card, ListGroup, Separator, Spinner } from 'heroui-native';
import { useMemo, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from '@/components/SafeAreaView';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { layout } from '@/constants/tokens';
import { useRuntime } from '@/features/runtime/RuntimeProvider';
import { summarizeWardrobe } from '@/features/wardrobe/presentation';
import { useWardrobeCollection } from '@/hooks/useWardrobeCollection';
import { checkAIConnection } from '@/services/api/connection';

export default function ProfileScreen() {
  const { garments, loading, error, reload } = useWardrobeCollection();
  const runtime = useRuntime();
  const counts = useMemo(() => summarizeWardrobe(garments), [garments]);
  const [checking, setChecking] = useState(false);
  const [connection, setConnection] = useState<{ ok: boolean; message: string } | null>(null);
  const native = Platform.OS !== 'web';
  const storageError = native && Boolean(error || runtime.error);
  const storageLoading = native && !storageError && (loading || !runtime.ready);

  async function checkConnection() {
    if (checking) return;
    setChecking(true);
    setConnection(null);
    try {
      await checkAIConnection();
      setConnection({ ok: true, message: 'Máy chủ AI đã phản hồi. Ảnh đang chờ sẽ được gửi khi ứng dụng đang mở.' });
    } catch {
      setConnection({ ok: false, message: 'Kiểm tra Wi-Fi và dịch vụ AI rồi thử lại. Bạn vẫn có thể chụp và lưu ảnh.' });
    } finally { setChecking(false); }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'left', 'right']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ width: '100%', maxWidth: layout.maxWidth, alignSelf: 'center', padding: layout.gutter, gap: 24 }}>
        <View className="gap-2">
          <Text accessibilityRole="header" className="text-3xl font-semibold text-foreground">Cá nhân</Text>
          <Text className="text-base text-muted">Tủ đồ được lưu trên thiết bị này.</Text>
        </View>
        <Card>
          <Card.Header><Card.Title>Tổng quan tủ đồ</Card.Title></Card.Header>
          <Card.Body>
            {storageLoading ? <LoadingSkeleton className="h-20 rounded-lg" /> : <View className="flex-row flex-wrap gap-4">
              {[{ value: counts.all, label: 'Món đồ' }, { value: counts.ready, label: 'Đã tách nền' }, { value: counts.processing, label: 'Đang xử lý' }].map((stat) => (
                <View key={stat.label} className="min-w-20 flex-1 gap-1">
                  <Text className="text-2xl font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>{!native || storageError ? '—' : stat.value}</Text>
                  <Text className="text-sm text-muted">{stat.label}</Text>
                </View>
              ))}
            </View>}
          </Card.Body>
          {storageError && <Card.Footer><Button title="Tải lại tủ đồ" variant="secondary" onPress={() => { runtime.retry(); void reload().catch(() => undefined); }} /></Card.Footer>}
        </Card>
        {counts.attention > 0 && <Alert status="warning"><Alert.Indicator /><Alert.Content><Alert.Title>{counts.attention} món đồ cần thử lại</Alert.Title><Alert.Description>Mở bộ lọc Cần thử lại trong tủ đồ để xem chi tiết.</Alert.Description></Alert.Content></Alert>}

        <View className="gap-3">
          <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">Lưu trữ và kết nối</Text>
          <ListGroup>
            <ListGroup.Item accessibilityRole="text">
              <ListGroup.ItemPrefix><Icon name="smartphone" /></ListGroup.ItemPrefix>
              <ListGroup.ItemContent><ListGroup.ItemTitle>Lưu trên thiết bị</ListGroup.ItemTitle><ListGroup.ItemDescription>Ảnh được lưu ngay cả khi không có mạng.</ListGroup.ItemDescription></ListGroup.ItemContent>
            </ListGroup.Item>
            <Separator />
            <ListGroup.Item accessibilityRole="text">
              <ListGroup.ItemPrefix><Icon name="sun" /></ListGroup.ItemPrefix>
              <ListGroup.ItemContent><ListGroup.ItemTitle>Giao diện theo hệ thống</ListGroup.ItemTitle><ListGroup.ItemDescription>Tự chuyển sáng hoặc tối theo thiết bị.</ListGroup.ItemDescription></ListGroup.ItemContent>
            </ListGroup.Item>
            <Separator />
            <ListGroup.Item onPress={() => { void checkConnection(); }} disabled={checking || !native}
              accessibilityRole="button" accessibilityLabel="Kiểm tra kết nối AI" accessibilityState={{ disabled: checking || !native, busy: checking }}>
              <ListGroup.ItemPrefix>{checking ? <Spinner size="sm" /> : <Icon name="wifi" />}</ListGroup.ItemPrefix>
              <ListGroup.ItemContent><ListGroup.ItemTitle>Kiểm tra kết nối AI</ListGroup.ItemTitle><ListGroup.ItemDescription>{!native ? 'Kiểm tra trong ứng dụng trên điện thoại.' : checking ? 'Đang kiểm tra máy chủ…' : 'Kiểm tra dịch vụ tách nền, không gửi ảnh.'}</ListGroup.ItemDescription></ListGroup.ItemContent>
              <ListGroup.ItemSuffix />
            </ListGroup.Item>
          </ListGroup>
          {connection && <Alert status={connection.ok ? 'success' : 'warning'} accessibilityLiveRegion="polite">
            <Alert.Indicator /><Alert.Content><Alert.Title>{connection.ok ? 'Đã kết nối AI' : 'Chưa kết nối được AI'}</Alert.Title><Alert.Description>{connection.message}</Alert.Description></Alert.Content>
          </Alert>}
        </View>

        <View className="gap-3">
          <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">Hướng dẫn sử dụng</Text>
          <Accordion variant="surface">
            <Accordion.Item value="photo-tips">
              <Accordion.Trigger accessibilityLabel="Cách chụp ảnh rõ hơn">
                <Text className="flex-1 text-base text-foreground">Cách chụp ảnh rõ hơn</Text><Accordion.Indicator />
              </Accordion.Trigger>
              <Accordion.Content><View className="gap-3 px-4 pb-4">
                <Text className="text-base text-muted">1. Chọn nơi đủ sáng và nền đơn giản.</Text>
                <Text className="text-base text-muted">2. Đặt trọn một món đồ trong khung hình.</Text>
                <Text className="text-base text-muted">3. Chụp tiếp sau khi hiện thông báo đã lưu.</Text>
              </View></Accordion.Content>
            </Accordion.Item>
            <Accordion.Item value="local-data">
              <Accordion.Trigger accessibilityLabel="Ảnh được lưu ở đâu?">
                <Text className="flex-1 text-base text-foreground">Ảnh được lưu ở đâu?</Text><Accordion.Indicator />
              </Accordion.Trigger>
              <Accordion.Content><Text className="px-4 pb-4 text-base leading-6 text-muted">Ảnh gốc và ảnh tách nền được lưu trong ứng dụng trên thiết bị này. Khi có kết nối, ảnh được gửi tới dịch vụ AI để xử lý. Hiện chưa có sao lưu đám mây; gỡ ứng dụng sẽ xóa tủ đồ trên thiết bị.</Text></Accordion.Content>
            </Accordion.Item>
          </Accordion>
        </View>
        <Text className="text-center text-sm text-muted">WearMuseMeow</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
