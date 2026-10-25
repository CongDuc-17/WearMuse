import { SafeAreaView as NativeSafeAreaView } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

// Third-party native views need this adapter for className to reach their style.
export const SafeAreaView = withUniwind(NativeSafeAreaView);
