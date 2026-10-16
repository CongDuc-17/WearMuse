import { createContext, useCallback, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { Platform } from 'react-native';

import { configurationError } from '@/config/env';
import { initializeWardrobe } from '@/hooks/useWardrobe';
import { startSynchronization } from '@/services/queue/synchronization';

interface RuntimeState {
  ready: boolean;
  error: string | null;
  configurationError: string | null;
  retry: () => void;
}

const RuntimeContext = createContext<RuntimeState>({ ready: false, error: null, configurationError, retry: () => {} });

export function RuntimeProvider({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(Platform.OS === 'web'
    ? 'Hãy mở ứng dụng trên Android hoặc iOS để sử dụng tủ đồ và máy ảnh.' : null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    if (Platform.OS === 'web') return;
    setError(null);
    setReady(false);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    if (Platform.OS === 'web') return;
    void initializeWardrobe().then(() => {
      if (cancelled) return;
      setReady(true);
      if (!configurationError) stop = startSynchronization();
    }).catch(() => {
      if (!cancelled) setError('Chưa thể mở tủ đồ trên thiết bị. Vui lòng thử lại.');
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [attempt]);

  return <RuntimeContext value={{ ready, error, configurationError, retry }}>{children}</RuntimeContext>;
}

export function useRuntime() {
  return useContext(RuntimeContext);
}
