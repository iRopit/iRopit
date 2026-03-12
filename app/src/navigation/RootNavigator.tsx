import React, { useState, useEffect, useCallback } from 'react';
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

const Stack = createNativeStackNavigator<RootStackParamList>();

const RootNavigator = () => {
  const { isAuthenticated, isLoading } = useAuthStore();
  const { colors } = useTheme();
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<
    boolean | null
  >(null);
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);
  const handleShare = useCallback((data: SharedData) => {
    useShareStore.getState().setPendingShare(data);
    navigateToChat();
  }, []);

  useShareReceive(handleShare);

  // Navigate to Chat after auth + onboarding finish if there's a pending share (cold launch)
  useEffect(() => {
    if (isLoading || checkingOnboarding || !isAuthenticated || !hasCompletedOnboarding) return;
    if (useShareStore.getState().pendingShare) {
      // Short delay to ensure MainNavigator has mounted its tabs
      const timer = setTimeout(() => navigateToChat(), 300);
      return () => clearTimeout(timer);
    }
  }, [isLoading, checkingOnboarding, isAuthenticated, hasCompletedOnboarding]);

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

    </>
  );
};

export default RootNavigator;
