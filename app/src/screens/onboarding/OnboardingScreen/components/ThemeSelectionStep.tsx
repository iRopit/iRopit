import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { styles } from '../styles';
import PhoneMockup from './PhoneMockup';

interface ThemeSelectionStepProps {
  selectedTheme: 'light' | 'dark' | 'system';
  actualTheme: 'light' | 'dark';
  isRTL: boolean;
  colors: {
    text: string;
    textSecondary: string;
    background: string;
    surface: string;
    surfaceSecondary: string;
    border: string;
    primary: string;
    phoneBorder: string;
    phoneScreen: string;
  };
  translate: (key: string) => string;
  onSelectTheme: (theme: 'light' | 'dark' | 'system') => void;
  triggerHaptic: (type: string) => void;
}

const ThemeSelectionStep: React.FC<ThemeSelectionStepProps> = ({
  selectedTheme,
  actualTheme,
  isRTL,
  colors,
  translate,
  onSelectTheme,
  triggerHaptic,
}) => {
  const themeIconName =
    selectedTheme === 'system'
      ? actualTheme === 'dark'
        ? 'moon'
        : 'sunny'
      : selectedTheme === 'dark'
      ? 'moon'
      : 'sunny';

  const themeBgColor =
    selectedTheme === 'system'
      ? actualTheme === 'dark'
        ? colors.surface
        : colors.background
      : selectedTheme === 'dark'
      ? colors.surface
      : colors.background;

  return (
    <View style={styles.content}>
      <PhoneMockup
        iconName={themeIconName}
        colors={colors}
        bgColor={themeBgColor}
      />

      <View style={styles.titleSection}>
        <Text style={[styles.title, { color: colors.text }]}>
          {translate('onboarding.theme.title')}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {translate('onboarding.theme.subtitle')}
        </Text>
      </View>

      <View style={styles.themeSelectionContainer}>
        <View style={styles.themeOptionsRow}>
          {/* Dark Theme */}
          <TouchableOpacity
            style={[
              styles.themeOption,
              {
                backgroundColor:
                  actualTheme === 'dark' ? colors.surfaceSecondary : '#2A2A2A',
                borderColor:
                  selectedTheme === 'dark' ? colors.primary : colors.border,
              },
              selectedTheme === 'dark' && styles.themeOptionSelected,
            ]}
            onPress={() => {
              triggerHaptic('selection');
              onSelectTheme('dark');
            }}
            activeOpacity={0.8}
          >
            <View
              style={[
                styles.themePreview,
                {
                  backgroundColor:
                    actualTheme === 'dark' ? colors.surface : '#1A1A1A',
                },
              ]}
            >
              <View
                style={[
                  styles.themePreviewPhone,
                  {
                    borderColor: colors.border,
                    backgroundColor:
                      actualTheme === 'dark'
                        ? colors.surfaceSecondary
                        : '#2A2A2A',
                  },
                ]}
              >
                <Icon name="moon" size={24} color={colors.primary} />
              </View>
            </View>
            <Text
              style={[
                styles.themeName,
                { color: actualTheme === 'dark' ? colors.text : '#FFFFFF' },
              ]}
            >
              {translate('onboarding.theme.dark')}
            </Text>
            {selectedTheme === 'dark' && (
              <View
                style={[styles.checkmark, { backgroundColor: colors.primary }]}
              >
                <Icon name="checkmark" size={16} color="#FFF" />
              </View>
            )}
          </TouchableOpacity>

          {/* Light Theme */}
          <TouchableOpacity
            style={[
              styles.themeOption,
              {
                backgroundColor: colors.background,
                borderColor:
                  selectedTheme === 'light' ? colors.primary : colors.border,
              },
              selectedTheme === 'light' && styles.themeOptionSelected,
            ]}
            onPress={() => {
              triggerHaptic('selection');
              onSelectTheme('light');
            }}
            activeOpacity={0.8}
          >
            <View
              style={[
                styles.themePreview,
                { backgroundColor: colors.surfaceSecondary },
              ]}
            >
              <View
                style={[
                  styles.themePreviewPhone,
                  {
                    borderColor: colors.text,
                    backgroundColor: colors.background,
                  },
                ]}
              >
                <Icon name="sunny" size={24} color={colors.primary} />
              </View>
            </View>
            <Text style={[styles.themeName, { color: colors.text }]}>
              {translate('onboarding.theme.light')}
            </Text>
            {selectedTheme === 'light' && (
              <View
                style={[styles.checkmark, { backgroundColor: colors.primary }]}
              >
                <Icon name="checkmark" size={16} color="#FFF" />
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default ThemeSelectionStep;
