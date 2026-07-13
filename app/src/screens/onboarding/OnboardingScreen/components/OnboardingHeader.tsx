import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { styles } from '../styles';

interface OnboardingHeaderProps {
  isRTL: boolean;
  selectedLanguage: 'ar' | 'en';
  actualTheme: 'light' | 'dark';
  colors: {
    border: string;
    surface: string;
    text: string;
  };
  onToggleLanguage: () => void;
  onToggleTheme: () => void;
}

const OnboardingHeader: React.FC<OnboardingHeaderProps> = ({
  isRTL,
  selectedLanguage,
  actualTheme,
  colors,
  onToggleLanguage,
  onToggleTheme,
}) => {
  return (
    <View
      style={[
        styles.header,
        { justifyContent: isRTL ? 'flex-start' : 'flex-end' },
      ]}
    >
      <View style={styles.headerControls}>
        <TouchableOpacity
          style={[
            styles.headerControlBtn,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
          onPress={onToggleLanguage}
          accessibilityLabel="Toggle language"
        >
          <Text style={[styles.headerControlText, { color: colors.text }]}> 
            {selectedLanguage === 'ar' ? 'AR' : 'EN'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.headerControlBtn,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
          onPress={onToggleTheme}
          accessibilityLabel="Toggle theme"
        >
          <Icon
            name={actualTheme === 'dark' ? 'moon' : 'sunny'}
            size={18}
            color={colors.text}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default OnboardingHeader;

