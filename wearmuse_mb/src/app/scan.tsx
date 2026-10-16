import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, BackHandler, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, IconButton } from '@/components/Button';
import { CaptureButton } from '@/components/CaptureButton';
import { Icon } from '@/components/Icon';
import { colors, fonts } from '@/constants/tokens';
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
  return Platform.OS === 'web' ? <MobileOnlyScan /> : <NativeQuickScan />;
}

function MobileOnlyScan() {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.topBar}>
        <IconButton name="x" label="Đóng camera" onPress={exitScan} light />
      </View>
      <View style={styles.permission}>
        <View style={styles.permissionIcon}><Icon name="smartphone" size={32} color={colors.white} /></View>
        <Text style={styles.permissionTitle}>Mang tủ đồ theo bạn.</Text>
        <Text style={styles.permissionText}>Mở WearMuseMeow trên Android hoặc iPhone để chụp và lưu món đồ ngay trên thiết bị.</Text>
        <Button title="Về tủ đồ" onPress={exitScan} variant="light" />
      </View>
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
    <View style={styles.screen}>
      <StatusBar style="light" />
      {showCamera && active && (
        <CameraView
          key={cameraSession}
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          animateShutter={!reducedMotion}
          onCameraReady={() => setCameraReady(true)}
          onMountError={() => { setCameraError(true); setCameraReady(false); }}
        />
      )}
      <SafeAreaView style={styles.overlay}>
        <View style={styles.topBar}>
          <IconButton name="x" label="Đóng camera và về tủ đồ" onPress={close} disabled={busy} light />
          <View style={styles.scanHeading}><Text style={styles.scanEyebrow}>THÊM VÀO TỦ ĐỒ</Text><Text style={styles.scanTitle}>Chụp nhanh</Text></View>
          <View style={styles.counter} accessibilityLabel={`${capturedCount} món đồ đã lưu trong lần chụp này`}>
            <Icon name="check" size={12} color={colors.white} /><Text style={styles.counterText}>{capturedCount.toString().padStart(2, '0')}</Text>
          </View>
        </View>

        {showCamera ? (
          <View style={styles.viewfinder} pointerEvents="none">
            <View style={styles.frame}>
              <View style={[styles.corner, styles.topLeft]} /><View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} /><View style={[styles.corner, styles.bottomRight]} />
            </View>
            <View style={styles.instruction}><Text style={styles.instructionText}>Đặt một món đồ vào khung hình</Text></View>
          </View>
        ) : (
          <View style={styles.permission}>
            {!permission && !permissionError ? <ActivityIndicator color={colors.white} /> : <>
              <View style={styles.permissionIcon}><Icon name={cameraError ? 'camera-off' : 'camera'} size={32} color={colors.white} /></View>
              <Text style={styles.permissionTitle}>{storageError ? 'Chưa thể mở tủ đồ' : cameraError ? 'Camera chưa sẵn sàng' : 'Một góc nhìn mới\ncho tủ đồ của bạn.'}</Text>
              <Text style={styles.permissionText}>{storageError
                ? 'Vui lòng quay về tủ đồ và thử lại trước khi chụp ảnh.'
                : cameraError ? 'Bạn vẫn có thể chọn ảnh có sẵn, hoặc thử mở lại camera.'
                  : 'Cho phép dùng camera để chụp món đồ. Bạn cũng có thể chọn ảnh có sẵn trong thư viện.'}</Text>
              {storageError ? <Button title="Về tủ đồ" variant="light" onPress={close} />
                : cameraError ? <Button title="Thử mở lại camera" variant="light" icon="refresh-cw" onPress={() => { setCameraError(false); setCameraReady(false); setCameraSession((session) => session + 1); }} />
                  : <Button title={permission?.canAskAgain === false ? 'Mở cài đặt camera' : 'Cho phép dùng camera'} variant="light" onPress={() => { if (permission?.canAskAgain === false) void openSettings(); else void askPermission(); }} />}
              {!storageError && <Pressable accessibilityRole="button" onPress={() => { void pickImage(); }} disabled={busy || !storageReady} style={({ pressed }) => [styles.galleryFallback, pressed && styles.pressed]}><Icon name="image" size={18} color={colors.white} /><Text style={styles.galleryFallbackText}>Chọn ảnh từ thư viện</Text></Pressable>}
            </>}
          </View>
        )}

        <View style={styles.bottomPanel}>
          {pending && !busy && (
            <View style={styles.recovery} accessibilityRole="alert">
              <Image source={{ uri: pending.uri }} style={styles.pendingThumb} contentFit="cover" />
              <View style={styles.recoveryCopy}>
                <Text style={styles.recoveryTitle}>Ảnh chưa được lưu</Text>
                <Text style={styles.recoveryText}>Giữ màn hình này và thử lại. Kiểm tra dung lượng trống trên thiết bị.</Text>
                <View style={styles.recoveryActions}>
                  <Pressable accessibilityRole="button" onPress={() => { void retrySave(); }} style={styles.recoveryAction}><Text style={styles.retryText}>Thử lưu lại</Text></Pressable>
                  <Pressable accessibilityRole="button" onPress={discardPhoto} style={styles.recoveryAction}><Text style={styles.discardText}>Bỏ ảnh</Text></Pressable>
                </View>
              </View>
            </View>
          )}
          <View style={styles.feedbackSlot} accessibilityLiveRegion="polite">
            {feedback && <View style={styles.feedback}><Icon name="check-circle" size={15} color="#D7E5C7" /><Text style={styles.feedbackText}>{feedback}</Text></View>}
            {busy && <Text style={styles.feedbackText}>Đang lưu ảnh trên thiết bị…</Text>}
          </View>
          {recent.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.recentStrip} contentContainerStyle={styles.recentContent}>
            {recent.map((photo) => <View key={photo.id} style={styles.recentFrame}><Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={photo.id} accessible={false} /><View style={styles.savedTick}><Icon name="check" size={8} color={colors.white} /></View></View>)}
          </ScrollView>}
          {showCamera && <><View style={styles.captureControls}>
            <View style={styles.sideControl}>
              <IconButton name="image" label="Chọn ảnh từ thư viện" light onPress={() => { void pickImage(); }} disabled={busy || Boolean(pending) || !storageReady} />
              <Text style={styles.controlLabel}>Thư viện</Text>
            </View>
            <CaptureButton onPress={() => { void capture(); }} busy={busy} disabled={!showCamera || !cameraReady || Boolean(pending) || !active} />
            <View style={styles.sideControl}>
              <IconButton name="check" label="Xong, trở về tủ đồ" light onPress={close} disabled={busy} />
              <Text style={styles.controlLabel}>Xong</Text>
            </View>
          </View>
          <Text style={styles.autoSave}>Tự động lưu sau mỗi lần chụp</Text></>}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.camera },
  overlay: { flex: 1, justifyContent: 'space-between' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 12, paddingBottom: 18, backgroundColor: '#15161280' },
  scanHeading: { alignItems: 'center', flex: 1, paddingHorizontal: 10, gap: 5 },
  scanEyebrow: { color: '#FFFFFFBD', fontSize: 8, letterSpacing: 2 },
  scanTitle: { color: colors.white, fontSize: 17, fontWeight: '500', letterSpacing: -0.3 },
  counter: { minWidth: 48, height: 32, borderRadius: 16, backgroundColor: '#FFFFFF1E', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 9 },
  counterText: { color: colors.white, fontSize: 12, fontWeight: '500' },
  viewfinder: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 48, paddingVertical: 18 },
  frame: { width: '100%', maxWidth: 310, aspectRatio: 3 / 4, maxHeight: '83%' },
  corner: { width: 22, height: 22, borderColor: '#FFFFFF70', position: 'absolute' },
  topLeft: { top: 0, left: 0, borderTopWidth: 1, borderLeftWidth: 1, borderTopLeftRadius: 7 },
  topRight: { top: 0, right: 0, borderTopWidth: 1, borderRightWidth: 1, borderTopRightRadius: 7 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 1, borderLeftWidth: 1, borderBottomLeftRadius: 7 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 1, borderRightWidth: 1, borderBottomRightRadius: 7 },
  instruction: { marginTop: 18, paddingHorizontal: 13, paddingVertical: 10, backgroundColor: '#15161290', borderRadius: 20 },
  instructionText: { color: colors.white, fontSize: 12, textAlign: 'center' },
  bottomPanel: { backgroundColor: '#151612BD', paddingTop: 2, paddingBottom: 17 },
  captureControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', paddingHorizontal: 14, paddingTop: 12 },
  sideControl: { alignItems: 'center', gap: 7, minWidth: 64 },
  controlLabel: { color: '#FFFFFFC4', fontSize: 9 },
  autoSave: { textAlign: 'center', color: '#FFFFFFB0', fontSize: 10, marginTop: 17, letterSpacing: 0.1 },
  feedbackSlot: { minHeight: 30, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  feedbackText: { color: '#E9F0E0', fontSize: 11, lineHeight: 17, textAlign: 'center' },
  recentStrip: { flexGrow: 0, maxHeight: 59, marginTop: 5, marginBottom: 6 },
  recentContent: { paddingHorizontal: 24, gap: 9 },
  recentFrame: { width: 42, height: 56, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: '#FFFFFF55' },
  savedTick: { position: 'absolute', bottom: 2, right: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  permission: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, paddingVertical: 18 },
  permissionIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#FFFFFF0C', borderWidth: 1, borderColor: '#FFFFFF26', alignItems: 'center', justifyContent: 'center', marginBottom: 25 },
  permissionTitle: { color: colors.white, fontFamily: fonts.editorial, fontSize: 29, lineHeight: 38, textAlign: 'center', marginBottom: 14, letterSpacing: -0.5 },
  permissionText: { color: '#FFFFFFB8', fontSize: 12, lineHeight: 21, textAlign: 'center', maxWidth: 295, marginBottom: 25 },
  galleryFallback: { minHeight: 48, flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center', marginTop: 10, paddingHorizontal: 12, paddingVertical: 12 },
  galleryFallbackText: { color: colors.white, fontSize: 12 },
  recovery: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginHorizontal: 18, padding: 14, borderRadius: 14, backgroundColor: '#FFF8EC', marginBottom: 8 },
  pendingThumb: { width: 45, height: 60, borderRadius: 4 },
  recoveryCopy: { flex: 1 },
  recoveryTitle: { color: colors.ink, fontWeight: '600', fontSize: 13, marginBottom: 4 },
  recoveryText: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  recoveryActions: { flexDirection: 'row', gap: 18 },
  recoveryAction: { minHeight: 48, minWidth: 48, justifyContent: 'center', paddingRight: 8 },
  retryText: { color: colors.accent, fontWeight: '700', fontSize: 12 },
  discardText: { color: colors.danger, fontSize: 12 },
  pressed: { opacity: 0.7 },
});
