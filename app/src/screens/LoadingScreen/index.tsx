import React from 'react';
import { View, ActivityIndicator, Text, Image } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { styles } from './styles';

const LoadingScreen = () => {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.logoContainer}>
        <Image
          source={require('../../assets/logo.png')}
          style={styles.logoImage}
          resizeMode="contain"
        />
        <Text style={[styles.appName, { color: colors.text }]}>iRopit</Text>
      </View>
      <ActivityIndicator
        size="large"
        color={colors.primary}
        style={styles.loader}
      />
      <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
        Loading...
      </Text>
    </View>
  );
};

export default LoadingScreen;
