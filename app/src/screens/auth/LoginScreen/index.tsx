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
import { Button, Input, Divider } from '../../../components';
import { useLoading, useToggle } from '../../../hooks';
import Icon from 'react-native-vector-icons/Ionicons';
import { styles } from './styles';

type LoginScreenProps = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Login'>;
};

const LoginScreen: React.FC<LoginScreenProps> = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [showPassword, toggleShowPassword] = useToggle(false);
  const { isLoading, startLoading, stopLoading } = useLoading();
  const { colors, t, isDarkMode } = useTheme();

  const { signInWithEmail, signInWithGoogle } = useAuthStore();

  const clearErrors = useCallback(() => {
    setEmailError('');
    setPasswordError('');
    setGeneralError('');
  }, []);

  const handleEmailLogin = useCallback(async () => {
    clearErrors();
    let hasError = false;

    if (!email.trim()) {
      setEmailError(t('emailRequired'));
      hasError = true;
    }

    if (!password) {
      setPasswordError(t('passwordRequired'));
      hasError = true;
    }

    if (hasError) return;

    startLoading();
    try {
      await signInWithEmail(email.trim(), password);
    } catch (e: any) {
      setGeneralError(e.message || t('loginFailed'));
    }
    stopLoading();
  }, [
    email,
    password,
    signInWithEmail,
    startLoading,
    stopLoading,
    t,
    clearErrors,
  ]);

  const handleGoogleLogin = useCallback(async () => {
    console.log('[LOGIN] handleGoogleLogin button pressed');
    clearErrors();
    startLoading();
    try {
      await signInWithGoogle();
      console.log('[LOGIN] signInWithGoogle completed successfully');
    } catch (e: any) {
      console.log('[LOGIN] signInWithGoogle error:', e?.message || e);
      setGeneralError(e.message || t('googleSignInFailed'));
    }
    stopLoading();
  }, [signInWithGoogle, startLoading, stopLoading, t, clearErrors]);

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

            {/* Email Input */}
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

            {/* Password Input */}
            <Input
              placeholder={t('passwordPlaceholder')}
              value={password}
              onChangeText={text => {
                setPassword(text);
                if (passwordError) setPasswordError('');
              }}
              secureTextEntry={!showPassword}
              leftIcon="lock-closed-outline"
              rightIcon={showPassword ? 'eye-off-outline' : 'eye-outline'}
              onRightIconPress={toggleShowPassword}
              isDark={isDarkMode}
              error={passwordError}
            />

            {/* Forgot Password */}
            <TouchableOpacity style={styles.forgotPasswordContainer}>
              <Text
                style={[
                  styles.forgotPasswordText,
                  { color: colors.primaryText },
                ]}
              >
                {t('forgotPassword')}
              </Text>
            </TouchableOpacity>

            {/* Login Button */}
            <Button
              title={t('loginButton')}
              onPress={handleEmailLogin}
              loading={isLoading}
              disabled={isLoading}
              fullWidth
              isDark={isDarkMode}
            />
          </View>

          {/* Divider */}
          <Divider label={t('orDivider')} isDark={isDarkMode} />

          {/* Google Login */}
          <Button
            title={t('googleSignIn')}
            variant="outline"
            leftIcon="logo-google"
            onPress={handleGoogleLogin}
            disabled={isLoading}
            fullWidth
            isDark={isDarkMode}
          />

          {/* Sign Up Link */}
          <View style={styles.signUpContainer}>
            <Text style={[styles.signUpText, { color: colors.textSecondary }]}>
              {t('noAccount')}
            </Text>
            <TouchableOpacity onPress={() => navigation.navigate('SignUp')}>
              <Text style={[styles.signUpLink, { color: colors.primaryText }]}>
                {t('signUp')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Version */}
          <Text
            style={{
              textAlign: 'center',
              color: colors.textSecondary,
              fontSize: 11,
              marginTop: 16,
              opacity: 0.6,
            }}
          >
            {`v${APP_VERSION}`}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default LoginScreen;
