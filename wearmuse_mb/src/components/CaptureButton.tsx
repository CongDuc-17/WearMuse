import { Button, Spinner, useThemeColor } from 'heroui-native';
import { Icon } from './Icon';

export function CaptureButton({ onPress, disabled, busy }: { onPress: () => void; disabled?: boolean; busy?: boolean }) {
  const foreground = useThemeColor('accent-foreground');
  return (
    <Button isIconOnly size="lg" className="min-h-16 min-w-16"
      accessibilityLabel={busy ? 'Đang lưu ảnh' : 'Chụp món đồ'}
      accessibilityHint="Ảnh được lưu tự động, sau đó bạn có thể chụp tiếp"
      accessibilityState={{ disabled: Boolean(disabled || busy), busy: Boolean(busy) }}
      isDisabled={Boolean(disabled || busy)} onPress={onPress}>
      {busy ? <Spinner color={foreground} /> : <Icon name="camera" size={28} color={foreground} />}
    </Button>
  );
}
