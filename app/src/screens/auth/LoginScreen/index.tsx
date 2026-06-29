import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuthStore } from '../../../store/authStore';
import { AuthStackParamList } from '../../../types';
import { useTheme } from '../../../contexts/ThemeContext';
import { APP_VERSION } from '../../../constants';
import { Button, ConfirmDialog } from '../../../components';
import { useLoading } from '../../../hooks';
import { styles } from './styles';

type LoginScreenProps = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Login'>;
};

const LoginScreen: React.FC<LoginScreenProps> = ({ navigation }) => {
  const [generalError, setGeneralError] = useState('');
  const { isLoading, startLoading, stopLoading } = useLoading();
  const { colors, t, isDarkMode, isRTL } = useTheme();

  const { signInWithGoogle, accountDeletedNotice, clearAccountDeletedNotice } =
    useAuthStore();

  const handleGoogleLogin = useCallback(async () => {
    setGeneralError('');
    startLoading();
    try {
      await signInWithGoogle();
    } catch (e: any) {
      setGeneralError(e.message || t('googleSignInFailed'));
    }
    stopLoading();
  }, [signInWithGoogle, startLoading, stopLoading, t]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ConfirmDialog
        visible={accountDeletedNotice}
        onClose={clearAccountDeletedNotice}
        onConfirm={clearAccountDeletedNotice}
        title={isRTL ? 'تم' : 'Done'}
        message={
          isRTL
            ? 'تم حذف الحساب بنجاح.'
            : 'Your account has been deleted successfully.'
        }
        type="success"
        confirmText="OK"
        hideCancelButton
        isDark={isDarkMode}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Logo */}
          <View style={styles.logoContainer}>
            <View style={[styles.logoBox, { backgroundColor: colors.primary }]}>
              <Image
                source={require('../../../assets/logo.png')}
                style={{ width: 60, height: 60 }}
                resizeMode="contain"
              />
            </View>
            <Text style={[styles.appName, { color: colors.text }]}>iRopit</Text>
            <Text style={[styles.tagline, { color: colors.textSecondary }]}>
              {t('appTagline')}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 4, opacity: 0.6 }}>
              {`v${APP_VERSION}`}
            </Text>
          </View>

          {/* Login Form */}
          <View style={styles.formContainer}>
            <Text style={[styles.title, { color: colors.text }]}>
              {t('welcomeBack')}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {t('signInToContinue')}
            </Text>

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

            {/* Google Login */}
            <Button
              title={t('googleSignIn')}
              variant="outline"
              leftIcon="logo-google"
              onPress={handleGoogleLogin}
              loading={isLoading}
              disabled={isLoading}
              fullWidth
              isDark={isDarkMode}
            />
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default LoginScreen;
