import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import PhoneMockup from './PhoneMockup';

interface LanguageSelectionStepProps {
  selectedLanguage: 'ar' | 'en';
  isRTL: boolean;
  colors: {
    text: string;
    textSecondary: string;
    surface: string;
    border: string;
    primary: string;
    phoneBorder: string;
    phoneScreen: string;
    black: string;
  };
  translate: (key: string) => string;
  onSelectLanguage: (lang: 'ar' | 'en') => void;
}

const LanguageSelectionStep: React.FC<LanguageSelectionStepProps> = ({
  selectedLanguage,
  isRTL,
  colors,
  translate,
  onSelectLanguage,
}) => {
  const languages = [
    {
      code: 'en' as const,
      name: 'English',
      nameSecondary: 'الإنجليزية',
      flag: '🇺🇸',
    },
    {
      code: 'ar' as const,
      name: 'العربية',
      nameSecondary: 'Arabic',
      flag: '🇸🇦',
    },
  ];

  return (
    <View style={localStyles.container}>
      <PhoneMockup iconName="globe-outline" colors={colors} />

      <View style={localStyles.titleSection}>
        <Text style={[localStyles.title, { color: colors.text }]}>
          {translate('onboarding.language.title')}
        </Text>
        <Text style={[localStyles.subtitle, { color: colors.textSecondary }]}>
          {translate('onboarding.language.subtitle')}
        </Text>
      </View>

      <View style={localStyles.languageContainer}>
        {languages.map(lang => {
          const isSelected = selectedLanguage === lang.code;
          return (
            <TouchableOpacity
              key={lang.code}
              style={[
                localStyles.languageCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: isSelected ? colors.primary : colors.border,
                  borderWidth: isSelected ? 2.5 : 1.5,
                  shadowColor: colors.black,
                },
              ]}
              onPress={() => onSelectLanguage(lang.code)}
              activeOpacity={0.7}
            >
              <Text style={localStyles.flag}>{lang.flag}</Text>

              <View style={localStyles.languageInfo}>
                <Text
                  style={[localStyles.languageName, { color: colors.text }]}
                >
                  {lang.name}
                </Text>
              </View>

              <View
                style={[
                  localStyles.radioOuter,
                  {
                    borderColor: isSelected ? colors.primary : colors.border,
                  },
                ]}
              >
                {isSelected && (
                  <View
                    style={[
                      localStyles.radioInner,
                      { backgroundColor: colors.primary },
                    ]}
                  />
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const localStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 24,
    paddingTop: 10,
  },
  titleSection: {
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: 16,
  },
  languageContainer: {
    width: '100%',
    gap: 14,
    // marginBottom: 32,
  },
  languageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    direction: 'ltr',
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 16,
    elevation: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 16,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  languageInfo: {
    flex: 1,
  },
  languageName: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  languageNameSecondary: {
    fontSize: 14,
  },
  flag: {
    fontSize: 32,
    marginRight: 12,
  },
});

export default LanguageSelectionStep;
