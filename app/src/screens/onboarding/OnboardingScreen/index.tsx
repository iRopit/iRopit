import React, { useEffect } from 'react';
import { View, StatusBar, Text, BackHandler } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { styles } from './styles';
import { useOnboarding } from './useOnboarding';
import { t } from '../../../i18n';
import { APP_VERSION } from '../../../constants';
import { Button } from '../../../components/common';
import {
  WelcomeStep,
  PrivacyPolicyStep,
  PermissionsStep,
  ProgressBar,
  OnboardingHeader,
} from './components';

interface OnboardingScreenProps {
  onComplete: () => void;
}

const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ onComplete }) => {
  const {
    currentStep,
    totalSteps,
    actualTheme,
    selectedLanguage,
    permissions,
    isRTL,
    privacyAccepted,
    getColors,
    setSelectedTheme,
    setSelectedLanguage,
    setPrivacyAccepted,
    goNext,
    goBack,
    requestPermission,
    requestAllPermissions,
    completeOnboarding,
    triggerHaptic,
  } = useOnboarding();

  const colors = getColors();

  // Helper function for translations based on selected language
  const translate = (key: string) => t(key, undefined, selectedLanguage);

  // Handle Android system back button: go to previous step instead of exiting
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (currentStep > 0) {
        goBack();
        return true; // prevent default (exit)
      }
      return false; // allow default on step 1
    });
    return () => subscription.remove();
  }, [currentStep, goBack]);

  const handleComplete = async () => {
    const success = await completeOnboarding();
    if (success) {
      onComplete();
    }
  };

  // Render current step content
  const renderContent = () => {
    switch (currentStep) {
      case 0:
        return <WelcomeStep colors={colors} translate={translate} />;
      case 1:
        return (
          <PrivacyPolicyStep
            isRTL={isRTL}
            colors={colors}
            accepted={privacyAccepted}
            onAccept={setPrivacyAccepted}
          />
        );
      case 2:
        return (
          <PermissionsStep
            permissions={permissions}
            isRTL={isRTL}
            actualTheme={actualTheme}
            colors={colors}
            translate={translate}
            onRequestPermission={requestPermission}
            onRequestAllPermissions={requestAllPermissions}
          />
        );
      default:
        return null;
    }
  };

  // Get button text based on current step
  const getButtonText = () => {
    const isLastStep = currentStep === totalSteps - 1;
    if (currentStep === 0) return translate('onboarding.getStarted');
    if (currentStep === 1) return isRTL ? 'أوافق وأستمر' : 'Agree & Continue';
    if (isLastStep) return translate('onboarding.overview.letsGo');
    return translate('common.next');
  };

  // Check if the Next button should be disabled
  // - Step 3 (Privacy): must accept terms
  // - Step 4 (Permissions): must grant all required permissions
  const allRequiredPermissionsGranted = permissions
    .filter(p => p.required)
    .every(p => p.granted);
  const isNextDisabled =
    (currentStep === 1 && !privacyAccepted) ||
    (currentStep === 2 && !allRequiredPermissionsGranted);

  const isLastStep = currentStep === totalSteps - 1;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, direction: isRTL ? 'rtl' : 'ltr' }]}>
      <StatusBar
        barStyle={actualTheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />

      <SafeAreaView style={[styles.safeArea, { direction: isRTL ? 'rtl' : 'ltr' }]}>
        {/* Header */}
        <OnboardingHeader
          isRTL={isRTL}
          selectedLanguage={selectedLanguage}
          actualTheme={actualTheme}
          colors={colors}
          onToggleLanguage={() => {
            triggerHaptic('selection');
            setSelectedLanguage(selectedLanguage === 'ar' ? 'en' : 'ar');
          }}
          onToggleTheme={() => {
            triggerHaptic('selection');
            setSelectedTheme(actualTheme === 'dark' ? 'light' : 'dark');
          }}
        />

        {/* Content */}
        {renderContent()}

        {/* Bottom Section */}
        <View style={styles.bottomSection}>
          <ProgressBar
            currentStep={currentStep}
            totalSteps={totalSteps}
            isRTL={isRTL}
            colors={colors}
          />

          <Button
            title={getButtonText()}
            variant="primary"
            size="lg"
            fullWidth
            isDark={actualTheme === 'dark'}
            disabled={isNextDisabled}
            onPress={isLastStep ? handleComplete : goNext}
          />

          {currentStep > 0 &&
            currentStep < totalSteps - 1 &&
            currentStep !== 1 && (
              <View style={{ marginTop: 12 }}>
                <Button
                  title={translate('common.previous')}
                  variant="outline"
                  size="md"
                  fullWidth
                  isDark={actualTheme === 'dark'}
                  onPress={goBack}
                />
              </View>
            )}

          {/* Privacy Policy step - back only, no skip */}
          {currentStep === 1 && (
            <View style={{ marginTop: 12 }}>
              <Button
                title={translate('common.previous')}
                variant="outline"
                size="md"
                fullWidth
                isDark={actualTheme === 'dark'}
                onPress={goBack}
              />
            </View>
          )}

          {currentStep === totalSteps - 1 && (
            <View style={{ marginTop: 12 }}>
              <Button
                title={translate('common.previous')}
                variant="outline"
                size="md"
                fullWidth
                isDark={actualTheme === 'dark'}
                onPress={goBack}
              />
            </View>
          )}
        </View>

        {/* Version number */}
        <Text style={{ color: colors.textSecondary, fontSize: 12, textAlign: 'center', paddingBottom: 8, opacity: 0.6 }}>{`v${APP_VERSION}`}</Text>
      </SafeAreaView>
    </View>
  );
};

export default OnboardingScreen;
