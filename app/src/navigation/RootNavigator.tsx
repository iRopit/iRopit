import React, { useState, useEffect, useCallback } from 'react';
import { BackHandler } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
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

const isFileShare = (data: SharedData) =>
  !!(data.uri || (data.uris && data.uris.length > 0));

const RootNavigator = () => {
  const { isAuthenticated, isLoading } = useAuthStore();
  const { colors } = useTheme();
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<
    boolean | null
  >(null);
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);
  const [shareData, setShareData] = useState<SharedData | null>(null);

  // Subscribe to pendingShare so the effect below re-runs when it changes.
  // Without this subscription, the effect only ran when auth/onboarding state
  // changed — missing the case where those were already stable when the cold-
  // start share data arrived (pollNative resolved after app was fully loaded).
  const pendingShare = useShareStore(state => state.pendingShare);

  const handleShare = useCallback((data: SharedData) => {
    if (isFileShare(data)) {
      // File/image share — check if auth is ready to show popup immediately
      const { user } = useAuthStore.getState();
      if (user?.uid) {
        setShareData(data);
      } else {
        // Cold launch — store for later, will show after auth
        useShareStore.getState().setPendingShare(data);
      }
    } else {
      // Text share — navigate to chat and paste into input
      useShareStore.getState().setPendingShare(data);
      navigateToChat();
    }
  }, []);

  useShareReceive(handleShare);

  // After auth + onboarding finish, handle any pending share (cold launch).
  // pendingShare is in the dep array so this effect re-runs when the store
  // value changes — critical for cold-start when all other conditions are
  // already stable before pollNative() delivers the data.
  useEffect(() => {
    if (isLoading || checkingOnboarding || !isAuthenticated || !hasCompletedOnboarding) return;
    if (!pendingShare) return;

    if (isFileShare(pendingShare)) {
      // File/image share — show standalone popup (no navigation needed)
      useShareStore.getState().clearPendingShare();
      setShareData(pendingShare);
    } else {
      // Text share — navigate to chat
      const timer = setTimeout(() => navigateToChat(), 300);
      return () => clearTimeout(timer);
    }
  }, [isLoading, checkingOnboarding, isAuthenticated, hasCompletedOnboarding, pendingShare]);

  // Check onboarding status on mount
  useEffect(() => {
    const checkOnboarding = async () => {
      const completed = await checkOnboardingComplete();
      setHasCompletedOnboarding(completed);
      setCheckingOnboarding(false);
    };
    checkOnboarding();
  }, []);

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

  if (isLoading || checkingOnboarding) {
    return <LoadingScreen />;
  }

  // Show onboarding if not completed
  if (!hasCompletedOnboarding) {
    return <OnboardingScreen onComplete={handleOnboardingComplete} />;
  }

  return (
    <>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
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
    </>
  );
};

export default RootNavigator;
