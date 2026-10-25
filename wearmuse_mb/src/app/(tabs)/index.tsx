import { router } from 'expo-router';
import { Alert, Card, Chip, Tabs } from 'heroui-native';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Platform, Text, View, useWindowDimensions, type ListRenderItemInfo } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { GarmentCard } from '@/components/GarmentCard';
import { Icon } from '@/components/Icon';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { SafeAreaView } from '@/components/SafeAreaView';
import { layout } from '@/constants/tokens';
import { useRuntime } from '@/features/runtime/RuntimeProvider';
import { filterWardrobe, summarizeWardrobe, wardrobeFilters, type WardrobeFilter } from '@/features/wardrobe/presentation';
import { useWardrobeCollection } from '@/hooks/useWardrobeCollection';

export default function ClosetScreen() {
  const { garments, loading, error, reload } = useWardrobeCollection();
  const runtime = useRuntime();
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<WardrobeFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const unavailable = Platform.OS === 'web';
  const availableWidth = Math.min(width - insets.left - insets.right, layout.maxWidth);
  const columns = availableWidth < 360 || fontScale > 1.5 ? 1 : availableWidth >= 700 ? 3 : 2;
  const cardWidth = (availableWidth - layout.gutter * 2 - layout.gap * (columns - 1)) / columns;
  const counts = useMemo(() => summarizeWardrobe(garments), [garments]);
  const filtered = useMemo(() => filterWardrobe(garments, filter), [garments, filter]);
  const renderItem = useCallback(({ item }: ListRenderItemInfo<typeof garments[number]>) => <GarmentCard id={item.localId} width={cardWidth} />, [cardWidth]);
  const openCamera = useCallback(() => router.push('/scan'), []);
  const failedToOpen = !unavailable && Boolean(error || runtime.error);
  const isLoading = !unavailable && !failedToOpen && (loading || !runtime.ready);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  }, [reload]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'left', 'right']}>
      <View className="w-full flex-1 self-center" style={{ maxWidth: layout.maxWidth }}>
        <FlatList key={columns} data={filtered} keyExtractor={keyExtractor} renderItem={renderItem}
          numColumns={columns} columnWrapperStyle={columns > 1 ? { gap: layout.gap } : undefined}
          contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false} initialNumToRender={8} maxToRenderPerBatch={6} windowSize={5}
          refreshing={refreshing} onRefresh={unavailable ? undefined : () => { void refresh().catch(() => undefined); }}
          ListHeaderComponent={
            <View className="gap-5 pb-4 pt-5">
              <View className="gap-2">
                <Text accessibilityRole="header" className="text-3xl font-semibold text-foreground">Tủ đồ</Text>
                <Text className="text-base text-muted">Chụp và lưu những món đồ của bạn.</Text>
              </View>
              {counts.all > 0 && !unavailable && <Button title="Thêm món đồ" icon="plus" onPress={openCamera} disabled={!runtime.ready} />}
              {failedToOpen && <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content className="gap-3">
                  <Alert.Title>Chưa thể mở tủ đồ</Alert.Title>
                  <Alert.Description>Thử tải lại để xem các món đồ đã lưu trên thiết bị.</Alert.Description>
                  <Button title="Thử lại" variant="secondary" onPress={() => { runtime.retry(); void reload().catch(() => undefined); }} />
                </Alert.Content>
              </Alert>}
              {runtime.configurationError && !unavailable && !failedToOpen && <Alert status="warning">
                <Alert.Indicator /><Alert.Content><Alert.Title>Chưa kết nối AI</Alert.Title><Alert.Description>Bạn vẫn có thể chụp và lưu ảnh. Kiểm tra kết nối trong mục Cá nhân.</Alert.Description></Alert.Content>
              </Alert>}
              <View className="flex-row flex-wrap items-center justify-between gap-2">
                <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">Bộ sưu tập</Text>
                <Chip size="sm" color="default" variant="soft">{counts.all} món đồ</Chip>
              </View>
              {counts.all > 0 && <Tabs value={filter} onValueChange={(value) => setFilter(value as WardrobeFilter)}>
                <Tabs.List>
                  <Tabs.ScrollView>
                    <Tabs.Indicator />
                    {wardrobeFilters.map((item) => <Tabs.Trigger key={item.id} value={item.id} className="min-h-12"
                      accessibilityLabel={item.label + ', ' + counts[item.id] + ' món đồ'}>
                      <Tabs.Label>{item.label} ({counts[item.id]})</Tabs.Label>
                    </Tabs.Trigger>)}
                  </Tabs.ScrollView>
                </Tabs.List>
              </Tabs>}
              {counts.all > 0 && <Text className="text-sm text-muted" accessibilityLiveRegion="polite">{filtered.length} món đồ · Mới nhất trước</Text>}
            </View>
          }
          ListEmptyComponent={
            isLoading ? <View className="flex-row flex-wrap" style={{ gap: layout.gap }} accessibilityLabel="Đang mở tủ đồ">
              {Array.from({ length: columns }, (_, key) => <LoadingSkeleton key={key} className="rounded-lg" style={{ width: cardWidth, height: 240 }} />)}
            </View> : failedToOpen ? <View /> : <Card>
              <Card.Header><Icon name={unavailable ? 'smartphone' : filter === 'all' ? 'shopping-bag' : 'check-circle'} size={32} /></Card.Header>
              <Card.Body>
                <Card.Title>{unavailable ? 'Mở app trên điện thoại' : filter === 'all' ? 'Thêm món đồ đầu tiên' : filter === 'attention' ? 'Không có món đồ cần thử lại' : 'Chưa có món đồ trong mục này'}</Card.Title>
                <Card.Description>{unavailable
                  ? 'Dùng WearMuseMeow trên iPhone hoặc Android để chụp, lưu ảnh và tạo tủ đồ cá nhân.'
                  : filter === 'all' ? 'Chụp ảnh hoặc chọn từ thư viện. Ảnh được lưu ngay; AI sẽ tự động tách nền khi có kết nối.'
                  : 'Chọn Tất cả để xem bộ sưu tập. Trạng thái sẽ tự cập nhật khi ảnh được xử lý.'}</Card.Description>
              </Card.Body>
              {!unavailable && <Card.Footer>
                {filter === 'all' ? <Button title="Thêm món đồ" icon="plus" onPress={openCamera} disabled={!runtime.ready} />
                  : <Button title="Xem tất cả" variant="secondary" onPress={() => setFilter('all')} />}
              </Card.Footer>}
            </Card>
          }
        />
      </View>
    </SafeAreaView>
  );
}
const keyExtractor = (garment: { localId: string }) => garment.localId;
