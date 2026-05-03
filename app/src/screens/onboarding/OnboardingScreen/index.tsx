import React, { useEffect } from 'react';
import { View, StatusBar, Text, BackHandler } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { styles } from './styles';
import { useOnboarding } from './useOnboarding';
import { t } from '../../../i18n';
import { Button } from '../../../components/common';
import {
  WelcomeStep,
  ThemeSelectionStep,
  LanguageSelectionStep,
  PrivacyPolicyStep,
  PermissionsStep,
  OverviewStep,
  SecurityStep,
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
    selectedTheme,
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
    skip,
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
        return (
          <LanguageSelectionStep
            selectedLanguage={selectedLanguage}
            isRTL={isRTL}
            colors={colors}
            translate={translate}
            onSelectLanguage={setSelectedLanguage}
          />
        );
      case 1:
        return <WelcomeStep colors={colors} translate={translate} />;
      case 2:
        return (
          <PrivacyPolicyStep
            isRTL={isRTL}
            colors={colors}
            accepted={privacyAccepted}
            onAccept={setPrivacyAccepted}
          />
        );
      case 3:
        return (
          <ThemeSelectionStep
            selectedTheme={selectedTheme}
            actualTheme={actualTheme}
            isRTL={isRTL}
            colors={colors}
            translate={translate}
            onSelectTheme={setSelectedTheme}
            triggerHaptic={triggerHaptic}
          />
        );
      case 4:
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
      case 5:
        return <OverviewStep colors={colors} translate={translate} />;
      case 6:
        return (
          <SecurityStep colors={colors} translate={translate} isRTL={isRTL} />
        );
      default:
        return null;
    }
  };

  // Get button text based on current step
  const getButtonText = () => {
    const isLastStep = currentStep === totalSteps - 1;
    if (currentStep === 0) return translate('onboarding.language.confirmLanguage');
    if (currentStep === 1) return translate('onboarding.getStarted');
    if (currentStep === 2) return isRTL ? 'أوافق وأستمر' : 'Agree & Continue';
    if (currentStep === 3) return translate('onboarding.theme.setAppearance');
    if (currentStep === 4) return translate('onboarding.permissions.continue');
    if (currentStep === 5) return translate('common.next');
    if (isLastStep) return translate('onboarding.overview.letsGo');
    return translate('common.next');
  };

  // Check if the Next button should be disabled
  const isNextDisabled = currentStep === 2 && !privacyAccepted;

  const isLastStep = currentStep === totalSteps - 1;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, direction: isRTL ? 'rtl' : 'ltr' }]}>
      <StatusBar
        barStyle={actualTheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />

      <SafeAreaView style={[styles.safeArea, { direction: isRTL ? 'rtl' : 'ltr' }]}>
        {/* Header */}
        {/* <OnboardingHeader
          isRTL={isRTL}
          selectedLanguage={selectedLanguage}
          colors={colors}
          onToggleLanguage={() => {
            triggerHaptic('selection');
            setSelectedLanguage(selectedLanguage === 'ar' ? 'en' : 'ar');
          }}
        /> */}

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
            currentStep !== 2 && (
              <View
                style={{
                  flexDirection: 'row',
                  gap: 12,
                  marginTop: 12,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Button
                    title={translate('common.previous')}
                    variant="outline"
                    size="md"
                    fullWidth
                    isDark={actualTheme === 'dark'}
                    onPress={goBack}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title={translate('onboarding.skip')}
                    variant="ghost"
                    size="md"
                    fullWidth
                    isDark={actualTheme === 'dark'}
                    onPress={skip}
                  />
                </View>
              </View>
            )}

          {/* Privacy Policy step - back only, no skip */}
          {currentStep === 2 && (
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
        <Text style={{ color: colors.textSecondary, fontSize: 12, textAlign: 'center', paddingBottom: 8, opacity: 0.6 }}>v1.0.4</Text>
      </SafeAreaView>
    </View>
  );
};

export default OnboardingScreen;
