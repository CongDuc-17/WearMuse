import { router } from 'expo-router';
import { Card, PressableFeedback } from 'heroui-native';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useGarment } from '@/hooks/useGarment';
import { GarmentPreview } from './GarmentPreview';
import { ProcessingIndicator, statusLabels } from './ProcessingIndicator';

export const GarmentCard = memo(function GarmentCard({ id, width }: { id: string; width: number }) {
  const garment = useGarment(id);
  if (!garment) return <View style={{ width }} />;
  const displayStatus = garment.status === 'ready' && !garment.cutoutLocalUri ? 'processing' : garment.status;
  const date = new Date(garment.createdAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  return (
    <PressableFeedback onPress={() => router.push({ pathname: '/garment/[id]', params: { id } })}
      accessibilityRole="button" accessibilityLabel={'Món đồ ngày ' + date + ', ' + statusLabels[displayStatus]}
      accessibilityHint="Mở ảnh và các tùy chọn của món đồ" style={{ width, marginBottom: 12 }}>
      <Card>
        <View className="overflow-hidden rounded-lg" style={{ aspectRatio: 3 / 4 }}>
          <GarmentPreview garment={garment} thumbnail style={StyleSheet.absoluteFill} />
        </View>
        <Card.Body>
          <Card.Title>Món đồ</Card.Title>
          <Card.Description>Đã thêm {date}</Card.Description>
        </Card.Body>
        <Card.Footer><ProcessingIndicator status={displayStatus} compact /></Card.Footer>
      </Card>
    </PressableFeedback>
  );
});
