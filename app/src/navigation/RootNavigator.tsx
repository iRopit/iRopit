import React, { useState, useEffect, useCallback } from 'react';
import {
  Linking,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useAuthStore } from '../store/authStore';
import AuthNavigator from './AuthNavigator';
import MainNavigator from './MainNavigator';
import LoadingScreen from '../screens/LoadingScreen';
import ConversationScreen from '../screens/main/ConversationScreen';
import CallDetailScreen from '../screens/main/CallDetailScreen';
import OnboardingScreen from '../screens/onboarding/OnboardingScreen';
import { checkOnboardingComplete } from '../screens/onboarding/OnboardingScreen/useOnboarding';
import { RootStackParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { useShareReceive, SharedData } from '../hooks/useShareReceive';
import { useShareStore } from '../store/shareStore';
import { navigateToChat } from './navigationRef';
import { ShareModal } from '../components/ShareModal';

const Stack = createNativeStackNavigator<RootStackParamList>();
const CHROME_EXTENSION_PROMPT_KEY = '@iropit_chrome_extension_prompt_shown';
const CHROME_EXTENSION_URL =
  'https://chromewebstore.google.com/detail/iropit/apjplefehkfmcjmkpapnjpainefomkgh?hl=en-US&utm_source=ext_sidebar';

const isFileShare = (data: SharedData) =>
  !!(data.uri || (data.uris && data.uris.length > 0));

const RootNavigator = () => {
  const isAuthenticated = useAuthStore(state => state.isAuthenticated);
  const isLoading = useAuthStore(state => state.isLoading);
  const { isRTL, colors } = useTheme();
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<
    boolean | null
  >(null);
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);
  const [shareData, setShareData] = useState<SharedData | null>(null);
  const [extensionPromptChecked, setExtensionPromptChecked] = useState(false);
  const [showExtensionPromptModal, setShowExtensionPromptModal] =
    useState(false);

  // Subscribe to pendingShare so the effect below re-runs when it changes.
  // Without this subscription, the effect only ran when auth/onboarding state
  // changed — missing the case where those were already stable when the cold-
  // start share data arrived (pollNative resolved after app was fully loaded).
  const pendingShare = useShareStore(state => state.pendingShare);

  const handleShare = useCallback((data: SharedData) => {
    if (isFileShare(data)) {
      // File/image share — show modal as soon as user is authenticated.
      // currentDevice may still be null (registerDevice is async); the modal
      // itself shows a "Preparing devices…" state and enables Send only once
      // currentDevice is set.  Gating modal visibility on currentDevice caused
      // cold-start shares to silently disappear when device registration was
      // slow or failed.
      const { user } = useAuthStore.getState();
      if (user?.uid) {
        setShareData(data);
      } else {
        // Cold launch — store for later, will show after auth
        useShareStore.getState().setPendingShare(data);
      }
    } else {
      // Text share — store and let useChatScreen consume it on the Chat tab.
      // Also attempt immediate navigation in case nav stack is already ready
      // (warm path).  The effect below will retry navigation after auth.
      useShareStore.getState().setPendingShare(data);
      navigateToChat();
    }
  }, []);

  useShareReceive(handleShare);

  // After auth + onboarding finish, handle any pending share from a cold launch.
  // For file shares we DO NOT wait for currentDevice — the modal handles that
  // internally.  For text shares we navigate to the Chat tab; useChatScreen
  // consumes pendingShare and pre-fills the input.
  useEffect(() => {
    if (isLoading || checkingOnboarding || !isAuthenticated || !hasCompletedOnboarding) return;
    if (!pendingShare) return;

    if (isFileShare(pendingShare)) {
      // File/image share — show modal immediately; ShareModal waits for device.
      useShareStore.getState().clearPendingShare();
      setShareData(pendingShare);
    } else {
      // Text share — Chat is the default tab, but make sure we land there.
      // Retry navigation a few times in case the nav stack isn't ready yet.
      const t1 = setTimeout(() => navigateToChat(), 200);
      const t2 = setTimeout(() => navigateToChat(), 800);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [isLoading, checkingOnboarding, isAuthenticated, hasCompletedOnboarding, pendingShare]);

  // Check onboarding status on mount
  useEffect(() => {
    let isMounted = true;

    const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, fallback: T) => {
      return Promise.race<T>([
        promise,
        new Promise<T>(resolve => {
          setTimeout(() => resolve(fallback), timeoutMs);
        }),
      ]);
    };

    const checkOnboarding = async () => {
      try {
        // Prevent a rare startup stall if AsyncStorage read blocks.
        const completed = await withTimeout(checkOnboardingComplete(), 6000, true);
        if (!isMounted) return;
        setHasCompletedOnboarding(completed);
      } catch {
        if (!isMounted) return;
        // Fail open to avoid trapping users behind an infinite loading state.
        setHasCompletedOnboarding(true);
      } finally {
        if (isMounted) {
          setCheckingOnboarding(false);
        }
      }
    };

    checkOnboarding();

    return () => {
      isMounted = false;
    };
  }, []);

  // Fresh install helper: show once to guide user to install Chrome extension.
  useEffect(() => {
    const maybeShowChromeExtensionPrompt = async () => {
      if (
        isLoading ||
        checkingOnboarding ||
        !isAuthenticated ||
        !hasCompletedOnboarding ||
        extensionPromptChecked
      ) {
        return;
      }

      try {
        const alreadyShown = await AsyncStorage.getItem(CHROME_EXTENSION_PROMPT_KEY);
        if (alreadyShown === '1') {
          setExtensionPromptChecked(true);
          return;
        }

        setExtensionPromptChecked(true);
        setShowExtensionPromptModal(true);
      } catch (_) {
        setExtensionPromptChecked(true);
      }
    };

    maybeShowChromeExtensionPrompt();
  }, [
    isLoading,
    checkingOnboarding,
    isAuthenticated,
    hasCompletedOnboarding,
    extensionPromptChecked,
    isRTL,
  ]);

  // Handle onboarding completion
  const handleOnboardingComplete = () => {
    setHasCompletedOnboarding(true);
  };

  const handleShareClose = useCallback(() => {
    setShareData(null);
    // Only exit if the app was launched specifically for this share (no prior back stack).
    // If the user was already in the app and shared a 2nd image, exitApp() would kill
    // the app entirely, making the share sheet open the app again as a cold launch.
    // Instead, do nothing — the user stays in the app.
  }, []);

  const markExtensionPromptSeen = useCallback(() => {
    AsyncStorage.setItem(CHROME_EXTENSION_PROMPT_KEY, '1').catch(() => {});
  }, []);

  const closeExtensionPrompt = useCallback(() => {
    markExtensionPromptSeen();
    setShowExtensionPromptModal(false);
  }, [markExtensionPromptSeen]);

  const handleOpenExtensionLink = useCallback(async () => {
    try {
      await Linking.openURL(CHROME_EXTENSION_URL);
    } catch (_) {
      // Ignore openURL failures and still mark as shown once.
    }
    markExtensionPromptSeen();
    setShowExtensionPromptModal(false);
  }, [markExtensionPromptSeen]);

  if (isLoading || checkingOnboarding) {
    return <LoadingScreen />;
  }

  // Show onboarding if not completed
  if (!hasCompletedOnboarding) {
    return <OnboardingScreen onComplete={handleOnboardingComplete} />;
  }

  return (
    <>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
        {isAuthenticated ? (
          <>
            <Stack.Screen name="Main" component={MainNavigator} />
            <Stack.Screen
              name="Conversation"
              component={ConversationScreen}
              options={{
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="CallDetail"
              component={CallDetailScreen}
              options={{
                headerShown: false,
              }}
            />
          </>
        ) : (
          <Stack.Screen name="Auth" component={AuthNavigator} />
        )}
      </Stack.Navigator>

      {shareData && <ShareModal data={shareData} onClose={handleShareClose} />}

      <Modal
        visible={showExtensionPromptModal}
        transparent
        animationType="fade"
        onRequestClose={closeExtensionPrompt}
      >
        <View style={styles.shareOverlay}>
          <View style={[styles.shareModalCard, { backgroundColor: colors.surface }]}>
            <View style={styles.shareModalHeader}>
              <Text style={[styles.shareModalTitle, { color: colors.text }]}> 
                {isRTL ? 'أكمل إعداد iRopit' : 'Complete iRopit Setup'}
              </Text>
              <TouchableOpacity onPress={closeExtensionPrompt}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.shareModalBody}>
              <Text style={[styles.shareDescription, { color: colors.textSecondary }]}> 
                {isRTL
                  ? 'لإكمال التثبيت والاستفادة من كل الميزات، ثبّت إضافة Chrome على اللابتوب من الرابط التالي:'
                  : 'To complete installation and unlock all features, install the Chrome Extension on your laptop using this URL:'}
              </Text>
              <Text style={[styles.shareHint, { color: colors.text }]}> 
                {CHROME_EXTENSION_URL}
              </Text>
            </View>

            <View style={styles.shareFooter}>
              <TouchableOpacity
                style={[styles.shareFooterBtn, { backgroundColor: colors.surfaceSecondary }]}
                onPress={closeExtensionPrompt}
              >
                <Text style={[styles.shareFooterBtnText, { color: colors.text }]}> 
                  {isRTL ? 'لاحقاً' : 'Later'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.shareFooterBtn, { backgroundColor: '#D9C4A1' }]}
                onPress={handleOpenExtensionLink}
              >
                <Text style={[styles.shareFooterBtnText, { color: '#111111' }]}> 
                  {isRTL ? 'فتح الرابط' : 'Open Link'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  shareOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  shareModalCard: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  shareModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  shareModalTitle: {
    fontSize: 22,
    fontWeight: '800',
    flex: 1,
    marginRight: 12,
  },
  shareModalBody: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  shareDescription: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 12,
  },
  shareHint: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  shareFooter: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  shareFooterBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareFooterBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
});

export default RootNavigator;
