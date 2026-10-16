import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/constants/tokens';
import { useGarment } from '@/hooks/useGarment';
import { GarmentPreview } from './GarmentPreview';
import { ProcessingIndicator, statusLabels } from './ProcessingIndicator';

export const GarmentCard = memo(function GarmentCard({ id, width }: { id: string; width: number }) {
  const garment = useGarment(id);
  if (!garment) return <View style={{ width }} />;
  const displayStatus = garment.status === 'ready' && !garment.cutoutLocalUri ? 'processing' : garment.status;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/garment/[id]', params: { id } })}
      accessibilityRole="button"
      accessibilityLabel={`Món đồ, ${statusLabels[displayStatus]}`}
      accessibilityHint="Mở ảnh và các tùy chọn của món đồ"
      style={({ pressed }) => [styles.card, { width }, pressed && styles.pressed]}>
      <View style={styles.imageFrame}>
        <GarmentPreview garment={garment} thumbnail style={StyleSheet.absoluteFill} />
        {displayStatus !== 'ready' && <View style={styles.status}><ProcessingIndicator status={displayStatus} compact /></View>}
      </View>
      <View style={styles.caption}>
        <Text style={styles.label}>Món đồ của bạn</Text>
        <Text style={styles.number}>{new Date(garment.createdAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { marginBottom: 24 },
  imageFrame: { aspectRatio: 3 / 4, overflow: 'hidden', borderRadius: 10, backgroundColor: colors.surface },
  status: { position: 'absolute', left: 8, right: 8, bottom: 9 },
  caption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5, paddingTop: 10 },
  label: { color: colors.ink, fontSize: 12, flexShrink: 1 },
  number: { color: colors.muted, fontSize: 10, letterSpacing: 0.3 },
  pressed: { opacity: 0.78 },
});
