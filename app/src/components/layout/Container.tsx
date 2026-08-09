/**
 * Container Component
 * Screen wrapper with consistent padding and safe area
 */

import React from 'react';
import {
  View,
  StyleSheet,
  StatusBar,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ViewStyle,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LIGHT_COLORS, DARK_COLORS } from '../../theme/colors';
import { COMPONENT_SPACING } from '../../theme/spacing';

export interface ContainerProps {
  /** Content */
  children: React.ReactNode;
  /** Enable scroll */
  scroll?: boolean;
  /** Enable keyboard avoiding */
  keyboardAvoiding?: boolean;
  /** Safe area edges */
  safeArea?: boolean;
  /** Safe area edges to apply */
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  /** Custom padding */
  padding?: number;
  /** No horizontal padding */
  noPaddingHorizontal?: boolean;
  /** Dark mode */
  isDark?: boolean;
  /** Custom background color */
  backgroundColor?: string;
  /** Pull to refresh */
  refreshing?: boolean;
  /** On refresh callback */
  onRefresh?: () => void;
  /** Custom style */
  style?: ViewStyle;
  /** Content container style (for scroll) */
  contentContainerStyle?: ViewStyle;
}

const Container: React.FC<ContainerProps> = ({
  children,
  scroll = false,
  keyboardAvoiding = false,
  safeArea = true,
  edges = ['top', 'bottom'],
  padding,
  noPaddingHorizontal = false,
  isDark = false,
  backgroundColor,
  refreshing,
  onRefresh,
  style,
  contentContainerStyle,
}) => {
  const colors = isDark ? DARK_COLORS : LIGHT_COLORS;
  const bgColor = backgroundColor || colors.background;

  const containerPadding =
    padding ?? COMPONENT_SPACING.screen.paddingHorizontal;

  const contentStyle: ViewStyle = {
    flex: 1,
    paddingHorizontal: noPaddingHorizontal ? 0 : containerPadding,
  };

  // Render content
  const renderContent = () => {
    if (scroll) {
      return (
        <ScrollView
          style={[styles.scroll, contentStyle]}
          contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing || false}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      );
    }

    return (
      <View style={[styles.content, contentStyle, style]}>{children}</View>
    );
  };

  // Wrap with keyboard avoiding if needed
  const renderWithKeyboard = () => {
    if (keyboardAvoiding) {
      return (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          {renderContent()}
        </KeyboardAvoidingView>
      );
    }
    return renderContent();
  };

  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      {safeArea ? (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: bgColor }]}>
          {renderWithKeyboard()}
        </SafeAreaView>
      ) : (
        <View style={[styles.container, { backgroundColor: bgColor }]}>
          {renderWithKeyboard()}
        </View>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: COMPONENT_SPACING.screen.paddingBottom,
  },
});

export default Container;
