import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Alert as Notice, Card, Chip, Spinner, Surface } from 'heroui-native';
import { ScopedTheme } from 'uniwind';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from '@/components/SafeAreaView';
import { Button, IconButton } from '@/components/Button';
import { CaptureButton } from '@/components/CaptureButton';
import { Icon } from '@/components/Icon';
import { useRuntime } from '@/features/runtime/RuntimeProvider';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { savePhoto } from '@/services/camera/capture';

type PendingPhoto = { uri: string; mimeType?: string; fileName?: string };
type RecentPhoto = { id: string; uri: string };

function exitScan() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function QuickScanScreen() {
  return <ScopedTheme theme="dark">{Platform.OS === 'web' ? <MobileOnlyScan /> : <NativeQuickScan />}</ScopedTheme>;
}

function MobileOnlyScan() {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <StatusBar style="light" />
      <View className="px-5 py-3"><IconButton name="x" label="Đóng camera" onPress={exitScan} /></View>
      <ScrollView contentContainerStyle={permissionLayout}>
        <Card className="w-full max-w-lg">
          <Card.Header><Icon name="smartphone" size={32} /></Card.Header>
          <Card.Body><Card.Title>Chụp ảnh trên điện thoại</Card.Title><Card.Description>Mở WearMuseMeow trên iPhone hoặc Android để chụp và lưu món đồ.</Card.Description></Card.Body>
          <Card.Footer><Button title="Về tủ đồ" onPress={exitScan} /></Card.Footer>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function NativeQuickScan() {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const { ready: storageReady, error: storageError } = useRuntime();
  const focused = useIsFocused();
  const reducedMotion = useReducedMotion();
  const camera = useRef<CameraView>(null);
  const busyRef = useRef(false);
  const pendingRef = useRef<PendingPhoto | null>(null);
  const permissionRequested = useRef(false);
  const recoveredUri = useRef<string | null>(null);
  const mounted = useRef(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [permissionError, setPermissionError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<PendingPhoto | null>(null);
  const [recent, setRecent] = useState<readonly RecentPhoto[]>([]);
  const [capturedCount, setCapturedCount] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [cameraSession, setCameraSession] = useState(0);
  const active = focused && foreground && !pickerOpen;

  useFocusEffect(useCallback(() => () => { setCameraReady(false); }, []));

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      setCameraReady(false);
      if (state === 'active') void getPermission().catch(() => undefined);
    });
    return () => { mounted.current = false; subscription.remove(); };
  }, [getPermission]);

  const askPermission = useCallback(async () => {
    setPermissionError(false);
    try { await requestPermission(); }
    catch { if (mounted.current) setPermissionError(true); }
  }, [requestPermission]);

  // This screen is mounted only after the user opens Quick Scan.
  useEffect(() => {
    if (!active || !permission || permission.status !== 'undetermined' || permissionRequested.current) return;
    permissionRequested.current = true;
    void askPermission();
  }, [active, permission, askPermission]);

  const rememberPending = useCallback((photo: PendingPhoto | null) => {
    pendingRef.current = photo;
    if (mounted.current) setPending(photo);
  }, []);

  const persist = useCallback(async (photo: PendingPhoto) => {
    rememberPending(photo);
    try {
      const garment = await savePhoto(photo.uri, photo.mimeType, photo.fileName);
      rememberPending(null);
      if (mounted.current) {
        setRecent((photos) => [{ id: garment.localId, uri: garment.originalLocalUri }, ...photos].slice(0, 8));
        setCapturedCount((count) => count + 1);
        setFeedback('Đã lưu ảnh. Bạn có thể chụp tiếp.');
      }
      return true;
    } catch {
      // Keep the temporary source and block new captures until retry or explicit discard.
      if (mounted.current) setFeedback(null);
      return false;
    }
  }, [rememberPending]);

  const close = useCallback(() => {
    if (busyRef.current) return;
    if (pendingRef.current) {
      Alert.alert('Ảnh này chưa được lưu', 'Ở lại để thử lưu lại ảnh. Nếu đóng, ảnh chưa lưu sẽ bị bỏ.', [
        { text: 'Ở lại', style: 'cancel' },
        { text: 'Bỏ ảnh và đóng', style: 'destructive', onPress: () => { rememberPending(null); exitScan(); } },
      ]);
      return;
    }
    exitScan();
  }, [rememberPending]);

  useEffect(() => {
    if (!focused) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => subscription.remove();
  }, [focused, close]);

  useEffect(() => {
    if (!feedback) return;
    const timeout = setTimeout(() => setFeedback(null), 2600);
    return () => clearTimeout(timeout);
  }, [feedback]);

  // Android can recreate the activity while the system photo picker is open.
  useEffect(() => {
    if (!storageReady || Platform.OS !== 'android') return;
    let cancelled = false;
    void ImagePicker.getPendingResultAsync().then(async (result) => {
      if (cancelled || busyRef.current || !result || 'code' in result || result.canceled) return;
      const asset = result.assets[0];
      if (!asset || recoveredUri.current === asset.uri) return;
      recoveredUri.current = asset.uri;
      busyRef.current = true;
      setBusy(true);
      try { await persist({ uri: asset.uri, mimeType: asset.mimeType ?? undefined, fileName: asset.fileName ?? undefined }); }
      finally { busyRef.current = false; if (mounted.current) setBusy(false); }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [storageReady, persist]);

  async function capture() {
    if (busyRef.current || pendingRef.current || !cameraReady || !camera.current || !active || !storageReady) return;
    busyRef.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.9 });
      if (!photo?.uri) throw new Error('Không nhận được ảnh từ camera.');
      await persist({ uri: photo.uri, mimeType: 'image/jpeg', fileName: 'mon-do.jpg' });
    } catch {
      Alert.alert('Chưa thể chụp ảnh', 'Vui lòng thử chụp lại hoặc chọn một ảnh từ thư viện.');
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function pickImage() {
    if (busyRef.current || pendingRef.current || !storageReady) return;
    busyRef.current = true;
    setBusy(true);
    setPickerOpen(true);
    setCameraReady(false);
    setFeedback(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, allowsMultipleSelection: false, quality: 1 });
      if (!result.canceled) {
        const asset = result.assets[0];
        if (asset) {
          recoveredUri.current = asset.uri;
          await persist({ uri: asset.uri, mimeType: asset.mimeType ?? undefined, fileName: asset.fileName ?? undefined });
        }
      }
    } catch {
      Alert.alert('Chưa thể mở thư viện', 'Vui lòng thử lại hoặc chụp ảnh bằng camera.');
    } finally {
      busyRef.current = false;
      if (mounted.current) { setBusy(false); setPickerOpen(false); }
    }
  }

  async function retrySave() {
    const photo = pendingRef.current;
    if (!photo || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { await persist(photo); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }

  function discardPhoto() {
    if (busyRef.current) return;
    Alert.alert('Bỏ ảnh chưa lưu?', 'Ảnh này chưa có trong tủ đồ. Bạn có thể giữ lại và thử lưu lần nữa.', [
      { text: 'Giữ lại ảnh', style: 'cancel' },
      { text: 'Bỏ ảnh', style: 'destructive', onPress: () => rememberPending(null) },
    ]);
  }

  async function openSettings() {
    try { await Linking.openSettings(); }
    catch { Alert.alert('Chưa mở được cài đặt', 'Mở Cài đặt trên thiết bị và cho phép WearMuseMeow dùng camera.'); }
  }

  const showCamera = permission?.granted && !cameraError && storageReady;
  return (
    <View className="flex-1 bg-background">
      <StatusBar style="light" />
      {showCamera && active && <CameraView key={cameraSession} ref={camera} style={StyleSheet.absoluteFill}
        facing="back" mode="picture" animateShutter={!reducedMotion}
        onCameraReady={() => setCameraReady(true)} onMountError={() => { setCameraError(true); setCameraReady(false); }} />}
      <SafeAreaView className="flex-1 py-2">
        <Surface className="mx-3 shrink-0 flex-row items-center gap-3 px-3 py-2">
          <IconButton name="x" label="Đóng camera và trở lại màn hình trước" onPress={close} disabled={busy} size="md" />
          <Text className="flex-1 text-base font-semibold text-foreground">Chụp món đồ</Text>
          {capturedCount > 0 && <Chip color="success" variant="soft" accessibilityLabel={`${capturedCount} món đồ đã lưu trong lần chụp này`}>{capturedCount} đã lưu</Chip>}
        </Surface>
        {showCamera ? <View className="min-h-0 flex-1 gap-3 px-5 py-3" pointerEvents="none" accessible={false}>
          <View className="min-h-0 flex-1 overflow-hidden">
            <View className="border-foreground" style={[styles.corner, styles.topLeft]} /><View className="border-foreground" style={[styles.corner, styles.topRight]} />
            <View className="border-foreground" style={[styles.corner, styles.bottomLeft]} /><View className="border-foreground" style={[styles.corner, styles.bottomRight]} />
          </View>
          <Surface className="self-center px-3 py-1.5"><Text className="text-center text-sm text-foreground">Đặt trọn món đồ trong khung</Text></Surface>
        </View> : <ScrollView style={{ flex: 1 }} contentContainerStyle={permissionLayout}>
          {!permission && !permissionError ? <Spinner /> : <Card className="w-full max-w-lg">
            <Card.Header><Icon name={cameraError ? 'camera-off' : 'camera'} size={32} /></Card.Header>
            <Card.Body>
              <Card.Title>{storageError ? 'Chưa thể mở tủ đồ' : cameraError ? 'Camera chưa sẵn sàng' : 'Cho phép dùng camera'}</Card.Title>
              <Card.Description>{storageError ? 'Quay về tủ đồ và thử tải lại trước khi chụp ảnh.' : cameraError ? 'Bạn có thể chọn ảnh có sẵn hoặc thử mở lại camera.' : 'Chụp ảnh từng món đồ để lưu vào tủ. Bạn cũng có thể chọn ảnh từ thư viện.'}</Card.Description>
            </Card.Body>
            <Card.Footer className="flex-col items-stretch gap-3">
              {storageError ? <Button title="Trở lại tủ đồ" onPress={close} />
                : cameraError ? <Button title="Thử mở lại camera" icon="refresh-cw" onPress={() => { setCameraError(false); setCameraReady(false); setCameraSession((session) => session + 1); }} />
                : <Button title={permission?.canAskAgain === false ? 'Mở cài đặt camera' : 'Cho phép dùng camera'} onPress={() => { if (permission?.canAskAgain === false) void openSettings(); else void askPermission(); }} />}
              {!storageError && <Button title="Chọn ảnh từ thư viện" icon="image" variant="secondary" onPress={() => { void pickImage(); }} disabled={busy || !storageReady || Boolean(pending)} />}
            </Card.Footer>
          </Card>}
        </ScrollView>}
        {(showCamera || pending || feedback || busy || recent.length > 0) && <Surface className="mx-3 shrink-0 gap-2 px-3 py-3">
          {pending && !busy && <Notice status="danger" accessibilityRole="alert">
            <Notice.Indicator /><Notice.Content className="gap-3">
              <Notice.Title>Ảnh chưa được lưu</Notice.Title>
              <Notice.Description>Giữ màn hình này và thử lại. Kiểm tra dung lượng trống trên thiết bị.</Notice.Description>
              <Image source={{ uri: pending.uri }} style={{ width: 54, height: 72 }} contentFit="cover" />
              <Button title="Thử lưu lại" onPress={() => { void retrySave(); }} />
              <Button title="Bỏ ảnh" variant="danger" onPress={discardPhoto} />
            </Notice.Content>
          </Notice>}
          {(feedback || busy) && <View className="items-center justify-center" accessibilityLiveRegion="polite">
            {feedback && <Chip color="success" variant="soft" className="h-auto"><Chip.Label>{feedback}</Chip.Label></Chip>}
            {busy && <View className="flex-row items-center gap-2"><Spinner size="sm" /><Text className="shrink text-sm text-muted">Đang lưu ảnh trên thiết bị…</Text></View>}
          </View>}
          {recent.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, maxHeight: 48 }} contentContainerStyle={{ gap: 8 }}>
            {recent.map((photo) => <View key={photo.id} className="overflow-hidden rounded-lg"><Image source={{ uri: photo.uri }} style={{ width: 36, height: 48 }} contentFit="cover" recyclingKey={photo.id} accessible={false} /></View>)}
          </ScrollView>}
          {showCamera && <View className="flex-row items-center gap-4">
            <View className="flex-1 items-center"><IconButton name="image" label="Chọn ảnh từ thư viện" onPress={() => { void pickImage(); }} disabled={busy || Boolean(pending) || !storageReady} size="md" /></View>
            <CaptureButton onPress={() => { void capture(); }} busy={busy} disabled={!showCamera || !cameraReady || Boolean(pending) || !active} />
            <View className="flex-1 items-center"><IconButton name="check" label="Xong, trở lại màn hình trước" onPress={close} disabled={busy} size="md" /></View>
          </View>}
        </Surface>}
      </SafeAreaView>
    </View>
  );
}

const permissionLayout = { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 } as const;
const styles = StyleSheet.create({
  corner: { width: 28, height: 28, position: 'absolute' },
  topLeft: { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2 },
  topRight: { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2 },
});
