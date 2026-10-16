import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Platform, StyleSheet, Text, View, useWindowDimensions, type ListRenderItemInfo } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { GarmentCard } from '@/components/GarmentCard';
import { Icon } from '@/components/Icon';
import { colors, fonts, layout } from '@/constants/tokens';
import { useRuntime } from '@/features/runtime/RuntimeProvider';
import { useWardrobe } from '@/hooks/useWardrobe';

export default function ClosetScreen() {
  const { ids, loading, error, reload } = useWardrobe();
  const runtime = useRuntime();
  const { width } = useWindowDimensions();
  const cardWidth = (Math.min(width, layout.maxWidth) - layout.gutter * 2 - layout.gap) / 2;
  const renderItem = useCallback(({ item }: ListRenderItemInfo<string>) => <GarmentCard id={item} width={cardWidth} />, [cardWidth]);
  const unavailable = Platform.OS === 'web';

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        <View style={styles.masthead}>
          <View style={styles.brandMark}><Text style={styles.brandLetter}>w.</Text></View>
          <Text style={styles.brand}>WearMuseMeow</Text>
          <Text style={styles.edition}>TỦ ĐỒ CÁ NHÂN</Text>
        </View>
        <FlatList
          data={ids}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          numColumns={2}
          columnWrapperStyle={styles.columns}
          contentContainerStyle={[styles.list, ids.length === 0 && styles.emptyList]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          maxToRenderPerBatch={6}
          windowSize={5}
          ListHeaderComponent={
            <View style={styles.header}>
              <Text style={styles.eyebrow}>KHÔNG GIAN CỦA RIÊNG BẠN</Text>
              <Text style={styles.heading}>Tủ đồ của bạn.</Text>
              <Text style={styles.subtitle}>Lưu giữ những món đồ. Khơi gợi phong cách.</Text>
              <View style={styles.collectionRow}>
                <Text style={styles.collection}>Bộ sưu tập</Text>
                <Text style={styles.count}>{ids.length.toString().padStart(2, '0')} MÓN ĐỒ</Text>
              </View>
              {(error || runtime.error) && !unavailable && (
                <View style={styles.notice} accessibilityRole="alert">
                  <Icon name="alert-circle" size={18} color={colors.warning} />
                  <View style={styles.noticeCopy}>
                    <Text style={styles.noticeText}>Chưa thể mở tủ đồ. Dữ liệu của bạn vẫn được giữ trên thiết bị.</Text>
                    <Button title="Thử lại" onPress={() => { runtime.retry(); void reload().catch(() => undefined); }} variant="secondary" style={styles.retry} />
                  </View>
                </View>
              )}
              {runtime.configurationError && !unavailable && !runtime.error && (
                <View style={styles.connectionNote}>
                  <Icon name="wifi-off" size={16} color={colors.muted} />
                  <Text style={styles.connectionText}>Ảnh vẫn được lưu. Kết nối dịch vụ để AI tự động tách nền.</Text>
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            !unavailable && (loading || !runtime.ready && !runtime.error) ? (
              <View style={styles.loading}><ActivityIndicator color={colors.accent} /><Text style={styles.loadingText}>Đang mở tủ đồ…</Text></View>
            ) : (
              <View style={styles.empty}>
                <View style={styles.emptyArtwork} accessible={false}>
                  <View style={styles.backFrame} />
                  <View style={styles.frontFrame}>
                    <View style={styles.artworkIcon}><Icon name={unavailable ? 'smartphone' : 'camera'} size={32} color={colors.accent} /></View>
                    <View style={styles.artworkLine} />
                    <Text style={styles.artworkLabel}>MÓN ĐỒ ĐẦU TIÊN</Text>
                  </View>
                  <View style={styles.plus}><Icon name="plus" size={20} color={colors.white} /></View>
                </View>
                <Text style={styles.emptyTitle}>{unavailable ? 'Tủ đồ, luôn bên bạn.' : 'Bắt đầu từ một\nmón đồ bạn yêu.'}</Text>
                <Text style={styles.emptyDescription}>{unavailable
                  ? 'Mở ứng dụng trên Android hoặc iPhone để chụp và lưu tủ đồ của bạn.'
                  : 'Chụp một ảnh, món đồ được lưu ngay.\nAI tự động tách nền sau.'}</Text>
              </View>
            )
          }
          ListFooterComponent={ids.length > 0 ? <Text style={styles.endnote}>Từng món đồ. Một phong cách riêng.</Text> : null}
        />
        <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
          <Button
            title={ids.length ? 'Thêm món đồ' : 'Chụp món đồ đầu tiên'}
            icon="camera"
            onPress={() => router.push('/scan')}
            disabled={unavailable || !runtime.ready || Boolean(runtime.error)}
            accessibilityHint="Mở camera. Ảnh được lưu tự động sau mỗi lần chụp."
          />
          <View style={styles.localNote}><Icon name="check-circle" size={12} color={colors.muted} /><Text style={styles.localNoteText}>Lưu ngay trên thiết bị · Chụp liên tục</Text></View>
        </SafeAreaView>
      </View>
    </SafeAreaView>
  );
}

const keyExtractor = (id: string) => id;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, width: '100%', maxWidth: layout.maxWidth, alignSelf: 'center' },
  masthead: { paddingHorizontal: layout.gutter, paddingVertical: 18, flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandMark: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  brandLetter: { fontFamily: fonts.editorial, color: colors.background, fontSize: 21, lineHeight: 26, fontStyle: 'italic' },
  brand: { fontSize: 14, fontWeight: '600', letterSpacing: -0.4 },
  edition: { fontSize: 8, letterSpacing: 1.2, color: colors.muted, marginLeft: 'auto', flexShrink: 1, textAlign: 'right' },
  list: { paddingHorizontal: layout.gutter, paddingBottom: 8 },
  emptyList: { flexGrow: 1 },
  columns: { gap: layout.gap },
  header: { paddingTop: 24 },
  eyebrow: { fontSize: 9, fontWeight: '600', letterSpacing: 2.1, color: colors.accent, marginBottom: 12 },
  heading: { fontFamily: fonts.editorial, fontSize: 39, letterSpacing: -1.4, color: colors.ink },
  subtitle: { fontSize: 12, color: colors.muted, lineHeight: 20, marginTop: 9 },
  collectionRow: { borderBottomWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 31, paddingBottom: 16, marginBottom: 20 },
  collection: { fontSize: 14, fontWeight: '600', color: colors.ink },
  count: { fontSize: 9, letterSpacing: 1.3, color: colors.muted },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 24, paddingBottom: 32 },
  emptyArtwork: { width: 148, height: 174, marginBottom: 30 },
  backFrame: { position: 'absolute', width: 114, height: 148, top: 4, left: 4, borderWidth: 1, borderColor: colors.line, borderRadius: 6, transform: [{ rotate: '-11deg' }] },
  frontFrame: { width: 118, height: 153, top: 9, left: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: '#E3DED3', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  artworkIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#E3E4DA', alignItems: 'center', justifyContent: 'center' },
  artworkLine: { marginTop: 21, width: 30, height: 1, backgroundColor: '#CCCBBF' },
  artworkLabel: { marginTop: 9, fontSize: 6, letterSpacing: 1.2, color: colors.muted },
  plus: { position: 'absolute', bottom: 1, right: 0, width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: colors.background },
  emptyTitle: { fontFamily: fonts.editorial, fontSize: 27, lineHeight: 36, textAlign: 'center', letterSpacing: -0.5, color: colors.ink },
  emptyDescription: { fontSize: 12, color: colors.muted, textAlign: 'center', lineHeight: 21, marginTop: 13, maxWidth: 280 },
  bottomBar: { paddingHorizontal: layout.gutter, paddingTop: 12, backgroundColor: colors.background },
  localNote: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingTop: 12, paddingBottom: 13 },
  localNoteText: { color: colors.muted, fontSize: 10, letterSpacing: 0.1 },
  loading: { alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 190, gap: 13 },
  loadingText: { fontSize: 12, color: colors.muted },
  notice: { flexDirection: 'row', gap: 10, backgroundColor: colors.warningLight, borderRadius: 12, padding: 14, marginBottom: 18 },
  noticeCopy: { flex: 1, gap: 10 },
  noticeText: { color: colors.warning, fontSize: 12, lineHeight: 20 },
  retry: { minHeight: 48, alignSelf: 'flex-start', paddingVertical: 10 },
  connectionNote: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 18 },
  connectionText: { flex: 1, fontSize: 11, color: colors.muted, lineHeight: 18 },
  endnote: { textAlign: 'center', color: colors.muted, fontSize: 10, paddingVertical: 15 },
});
