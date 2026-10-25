import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/** iOS hides the bar before the keyboard animation; Android exposes did-events. */
export function useKeyboardVisible() {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const shown = Keyboard.addListener(showEvent, () => setVisible(true));
    const hidden = Keyboard.addListener(hideEvent, () => setVisible(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return visible;
}
