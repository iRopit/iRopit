import { useCallback, useMemo } from 'react';
import { I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import ar from './locales/ar.json';
import en from './locales/en.json';

// Types
export type Language = 'ar' | 'en';
export type TranslationKeys = typeof en;

type NestedKeyOf<T> = T extends object
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends object
          ? `${K}` | `${K}.${NestedKeyOf<T[K]>}`
          : `${K}`
        : never;
    }[keyof T]
  : never;

export type TranslationKey = NestedKeyOf<TranslationKeys>;

// Constants
export const LANGUAGES: {
  code: Language;
  name: string;
  nativeName: string;
  isRTL: boolean;
}[] = [
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', isRTL: true },
  { code: 'en', name: 'English', nativeName: 'English', isRTL: false },
];

export const DEFAULT_LANGUAGE: Language = 'en';
const STORAGE_KEY = '@iropit_language';

// Translations map
const translations: Record<Language, TranslationKeys> = {
  ar,
  en,
};

// Helper to get nested value from object
const getNestedValue = (obj: any, path: string): string => {
  const keys = path.split('.');
  let result = obj;

  for (const key of keys) {
    if (result && typeof result === 'object' && key in result) {
      result = result[key];
    } else {
      return path; // Return the key if translation not found
    }
  }

  return typeof result === 'string' ? result : path;
};

// Interpolate variables in translation string
const interpolate = (
  text: string,
  variables?: Record<string, string | number>,
): string => {
  if (!variables) return text;

  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key]?.toString() ?? match;
  });
};

// Current language state (simple in-memory state for hook)
let currentLanguage: Language = DEFAULT_LANGUAGE;
let languageListeners: Set<() => void> = new Set();

const notifyListeners = () => {
  languageListeners.forEach(listener => listener());
};

// Language management functions
export const getStoredLanguage = async (): Promise<Language> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored && (stored === 'ar' || stored === 'en')) {
      return stored as Language;
    }
  } catch (error) {
    console.error('Error reading language from storage:', error);
  }
  return DEFAULT_LANGUAGE;
};

export const setStoredLanguage = async (language: Language): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, language);
    currentLanguage = language;

    // Handle RTL
    const isRTL = language === 'ar';
    if (I18nManager.isRTL !== isRTL) {
      I18nManager.allowRTL(isRTL);
      I18nManager.forceRTL(isRTL);
    }

    notifyListeners();
  } catch (error) {
    console.error('Error saving language to storage:', error);
  }
};

export const initializeLanguage = async (): Promise<Language> => {
  const language = await getStoredLanguage();
  currentLanguage = language;

  // Set RTL
  const isRTL = language === 'ar';
  if (I18nManager.isRTL !== isRTL) {
    I18nManager.allowRTL(isRTL);
    I18nManager.forceRTL(isRTL);
  }

  return language;
};

// Translation function
export const t = (
  key: string,
  variables?: Record<string, string | number>,
  language?: Language,
): string => {
  const lang = language || currentLanguage;
  const translation = getNestedValue(translations[lang], key);
  return interpolate(translation, variables);
};

// Hook for using translations in components
export const useTranslation = () => {
  const [, forceUpdate] = React.useState({});

  React.useEffect(() => {
    const listener = () => forceUpdate({});
    languageListeners.add(listener);
    return () => {
      languageListeners.delete(listener);
    };
  }, []);

  const translate = useCallback(
    (key: string, variables?: Record<string, string | number>) => {
      return t(key, variables, currentLanguage);
    },
    [],
  );

  const changeLanguage = useCallback(async (language: Language) => {
    await setStoredLanguage(language);
  }, []);

  const isRTL = useMemo(() => currentLanguage === 'ar', []);

  const languageInfo = useMemo(
    () => LANGUAGES.find(l => l.code === currentLanguage) || LANGUAGES[0],
    [],
  );

  return {
    t: translate,
    language: currentLanguage,
    changeLanguage,
    isRTL,
    languageInfo,
    languages: LANGUAGES,
  };
};

// Need to import React for hooks
import React from 'react';

export default {
  t,
  useTranslation,
  getStoredLanguage,
  setStoredLanguage,
  initializeLanguage,
  LANGUAGES,
  DEFAULT_LANGUAGE,
};
