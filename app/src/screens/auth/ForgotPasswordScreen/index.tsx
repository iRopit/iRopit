import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuthStore } from '../../../store/authStore';
import { useTheme } from '../../../contexts/ThemeContext';
import { Button, Input } from '../../../components';
import { useLoading } from '../../../hooks';
import { AuthStackParamList } from '../../../types';
import Icon from 'react-native-vector-icons/Ionicons';
import { StyleSheet } from 'react-native';

type ForgotPasswordScreenProps = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'ForgotPassword'>;
};

const ForgotPasswordScreen: React.FC<ForgotPasswordScreenProps> = ({
  navigation,
}) => {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const { isLoading, startLoading, stopLoading } = useLoading();
  const { colors, t, isDarkMode } = useTheme();
  const { resetPassword } = useAuthStore();

  const handleReset = useCallback(async () => {
    setEmailError('');
    setGeneralError('');

    if (!email.trim()) {
      setEmailError(t('emailRequired'));
      return;
    }

    startLoading();
    try {
      await resetPassword(email.trim());
      setEmailSent(true);
    } catch (e: any) {
      setGeneralError(e.message || t('resetFailed'));
    }
    stopLoading();
  }, [email, resetPassword, startLoading, stopLoading, t]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Back Button */}
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Icon name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>

          {/* Icon */}
          <View style={[styles.iconContainer, { backgroundColor: colors.primary + '20' }]}>
            <Icon name="lock-open-outline" size={48} color={colors.primary} />
          </View>

          {/* Title */}
          <Text style={[styles.title, { color: colors.text }]}>
            {t('forgotPasswordTitle')}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {t('forgotPasswordSubtitle')}
          </Text>

          {emailSent ? (
            /* Success State */
            <View style={[styles.successContainer, { backgroundColor: colors.primary + '15', borderColor: colors.primary }]}>
              <Icon name="checkmark-circle-outline" size={28} color={colors.primary} />
              <Text style={[styles.successTitle, { color: colors.text }]}>
                {t('resetLinkSent')}
              </Text>
              <Text style={[styles.successDesc, { color: colors.textSecondary }]}>
                {t('resetEmailSentDesc')}
              </Text>
            </View>
          ) : (
            /* Form */
            <View style={styles.formContainer}>
              {generalError ? (
                <View
                  style={[
                    styles.errorContainer,
                    { backgroundColor: colors.error + '15', borderColor: colors.error },
                  ]}
                >
                  <Text style={[styles.errorText, { color: colors.error }]}>
                    {generalError}
                  </Text>
                </View>
              ) : null}

              <Input
                placeholder={t('emailPlaceholder')}
                value={email}
                onChangeText={text => {
                  setEmail(text);
                  if (emailError) setEmailError('');
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                leftIcon="mail-outline"
                isDark={isDarkMode}
                error={emailError}
              />

              <Button
                title={t('sendResetLink')}
                onPress={handleReset}
                loading={isLoading}
                disabled={isLoading}
                fullWidth
                isDark={isDarkMode}
              />
            </View>
          )}

          {/* Back to Login */}
          <TouchableOpacity
            style={styles.backToLoginContainer}
            onPress={() => navigation.navigate('Login')}
          >
            <Icon name="arrow-back-outline" size={16} color={colors.primaryText} />
            <Text style={[styles.backToLoginText, { color: colors.primaryText }]}>
              {t('backToLogin')}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 24,
    alignItems: 'center',
  },
  backButton: {
    alignSelf: 'flex-start',
    padding: 8,
    marginBottom: 16,
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    marginTop: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  formContainer: {
    width: '100%',
    gap: 16,
  },
  errorContainer: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  errorText: {
    fontSize: 14,
  },
  successContainer: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  successDesc: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  backToLoginContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 32,
  },
  backToLoginText: {
    fontSize: 15,
    fontWeight: '600',
  },
});

export default ForgotPasswordScreen;
