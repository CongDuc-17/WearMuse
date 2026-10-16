import { Image } from 'expo-image';
import { memo, useLayoutEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@/constants/tokens';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { Garment } from '@/types/garment';

type Props = {
  garment: Garment;
  thumbnail?: boolean;
  style?: StyleProp<ViewStyle>;
  onPreviewError?: () => void;
};

export const GarmentPreview = memo(function GarmentPreview({ garment, thumbnail, style, onPreviewError }: Props) {
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const [failedUris, setFailedUris] = useState<readonly string[]>([]);
  const cutout = garment.status === 'ready' ? garment.cutoutLocalUri : null;
  const preferred = thumbnail && garment.thumbnailLocalUri && !failedUris.includes(garment.thumbnailLocalUri)
    ? garment.thumbnailLocalUri : cutout;
  // A cutout is eligible only after the storage service has verified a durable local file.
  const candidate = cutout && preferred && !failedUris.includes(preferred) ? preferred : null;
  const currentCandidate = useRef(candidate);
  currentCandidate.current = candidate;

  useLayoutEffect(() => {
    opacity.stopAnimation();
    opacity.setValue(0);
    return () => opacity.stopAnimation();
    // A later thumbnail may replace an already displayed cutout without returning
    // to the original photograph. A new processing result starts a fresh fade.
  }, [cutout, opacity]);

  const reveal = () => {
    if (currentCandidate.current !== candidate) return;
    Animated.timing(opacity, { toValue: 1, duration: reducedMotion ? 0 : 250, useNativeDriver: true }).start();
  };

  return (
    <View style={[styles.container, style]} accessible={false}>
      <Image
        source={{ uri: garment.originalLocalUri }}
        style={StyleSheet.absoluteFill}
        recyclingKey={`${garment.localId}:original`}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={0}
        accessible={false}
      />
      {candidate && (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.cutout, { opacity }]}>
          <Image
            source={{ uri: candidate }}
            style={StyleSheet.absoluteFill}
            recyclingKey={`${garment.localId}:cutout`}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
            onLoad={reveal}
            onError={() => {
              if (currentCandidate.current !== candidate) return;
              if (candidate === cutout) {
                opacity.stopAnimation();
                opacity.setValue(0);
              }
              setFailedUris((uris) => [...uris, candidate]);
              if (candidate === cutout) onPreviewError?.();
            }}
            accessible={false}
          />
        </Animated.View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surface, overflow: 'hidden' },
  cutout: { backgroundColor: colors.surface },
});
