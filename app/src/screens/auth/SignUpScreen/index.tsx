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
import { useAuthStore } from '../../../store/authStore';
import { useTheme } from '../../../contexts/ThemeContext';
import { Button, IconButton } from '../../../components';
import { useLoading } from '../../../hooks';
import { styles } from './styles';
import { SignUpScreenProps } from './types';

const SignUpScreen: React.FC<SignUpScreenProps> = ({ navigation }) => {
  const [generalError, setGeneralError] = useState('');
  const { isLoading, startLoading, stopLoading } = useLoading();
  const { colors, t, isDarkMode, isRTL } = useTheme();

  const { signInWithGoogle } = useAuthStore();

  const handleGoogleSignUp = useCallback(async () => {
    setGeneralError('');
    startLoading();
    try {
      await signInWithGoogle();
    } catch (e: any) {
      setGeneralError(e.message || t('googleSignUpFailed'));
    }
    stopLoading();
  }, [signInWithGoogle, startLoading, stopLoading, t]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Back Button */}
          <IconButton
            icon={isRTL ? 'chevron-forward' : 'chevron-back'}
            onPress={() => navigation.goBack()}
            variant="ghost"
            isDark={isDarkMode}
            style={styles.backButton}
          />

          {/* Header */}
          <View style={styles.headerContainer}>
            <Text style={[styles.title, { color: colors.text }]}>
              {t('createAccount')}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {t('signUpSubtitle')}
            </Text>
          </View>

          {/* Form */}
          <View style={styles.formContainer}>
            {/* General Error */}
            {generalError ? (
              <View
                style={[
                  styles.errorContainer,
                  {
                    backgroundColor: colors.error + '15',
                    borderColor: colors.error,
                  },
                ]}
              >
                <Text style={[styles.errorText, { color: colors.error }]}>
                  {generalError}
                </Text>
              </View>
            ) : null}

            {/* Google Sign Up */}
            <Button
              title={t('googleSignUp')}
              variant="outline"
              leftIcon="logo-google"
              onPress={handleGoogleSignUp}
              loading={isLoading}
              disabled={isLoading}
              fullWidth
              isDark={isDarkMode}
            />

            {/* Sign In Link */}
            <View style={styles.signInContainer}>
              <Text
                style={[styles.signInText, { color: colors.textSecondary }]}
              >
                {t('hasAccount')}{' '}
              </Text>
              <TouchableOpacity onPress={() => navigation.navigate('Login')}>
                <Text
                  style={[styles.signInLink, { color: colors.primaryText }]}
                >
                  {t('signIn')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default SignUpScreen;
