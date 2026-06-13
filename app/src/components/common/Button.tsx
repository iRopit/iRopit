/**
 * Button Component
 * Reusable button with multiple variants and sizes
 */

import React, { useCallback } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  ViewStyle,
  TextStyle,
  TouchableOpacityProps,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { LIGHT_COLORS, DARK_COLORS } from '../../theme/colors';
import { TYPOGRAPHY } from '../../theme/typography';
import { SPACING, RADIUS } from '../../theme/spacing';
import { SHADOWS } from '../../theme/shadows';
import { ICON_SIZES } from '../../constants/icons';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<TouchableOpacityProps, 'style'> {
  /** Button text */
  title: string;
  /** Button variant */
  variant?: ButtonVariant;
  /** Button size */
  size?: ButtonSize;
  /** Left icon name (Ionicons) */
  leftIcon?: string;
  /** Right icon name (Ionicons) */
  rightIcon?: string;
  /** Loading state */
  loading?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Full width button */
  fullWidth?: boolean;
  /** Dark mode */
  isDark?: boolean;
  /** Custom style */
  style?: ViewStyle;
  /** Custom text style */
  textStyle?: TextStyle;
}

const Button: React.FC<ButtonProps> = ({
  title,
  variant = 'primary',
  size = 'md',
  leftIcon,
  rightIcon,
  loading = false,
  disabled = false,
  fullWidth = false,
  isDark = false,
  style,
  textStyle,
  onPress,
  ...props
}) => {
  const colors = isDark ? DARK_COLORS : LIGHT_COLORS;

  const getVariantStyles = useCallback((): {
    container: ViewStyle;
    text: TextStyle;
  } => {
    const isDisabled = disabled || loading;

    switch (variant) {
      case 'primary':
        return {
          container: {
            backgroundColor: isDisabled ? colors.border : colors.primary,
            ...SHADOWS.sm,
          },
          text: {
            color: isDisabled
              ? (isDark ? 'rgba(0, 0, 0, 0.55)' : colors.textTertiary)
              : (isDark ? colors.black : colors.white),
          },
        };
      case 'secondary':
        return {
          container: {
            backgroundColor: isDisabled ? colors.border : colors.secondary,
            ...SHADOWS.sm,
          },
          text: {
            color: isDisabled ? colors.textTertiary : colors.white,
          },
        };
      case 'outline':
        return {
          container: {
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderColor: isDisabled ? colors.border : colors.primary,
          },
          text: {
            color: isDisabled ? colors.textTertiary : colors.primary,
          },
        };
      case 'ghost':
        return {
          container: {
            backgroundColor: 'transparent',
          },
          text: {
            color: isDisabled ? colors.textTertiary : colors.primary,
          },
        };
      case 'danger':
        return {
          container: {
            backgroundColor: isDisabled ? colors.border : colors.error,
            ...SHADOWS.sm,
          },
          text: {
            color: isDisabled ? colors.textTertiary : colors.white,
          },
        };
      default:
        return {
          container: {},
          text: {},
        };
    }
  }, [variant, colors, disabled, loading]);

  const getSizeStyles = useCallback((): {
    container: ViewStyle;
    text: TextStyle;
    iconSize: number;
  } => {
    switch (size) {
      case 'sm':
        return {
          container: {
            paddingVertical: SPACING.sm,
            paddingHorizontal: SPACING.md,
            borderRadius: RADIUS.md,
          },
          text: TYPOGRAPHY.buttonSmall,
          iconSize: ICON_SIZES.sm,
        };
      case 'lg':
        return {
          container: {
            paddingVertical: SPACING.lg,
            paddingHorizontal: SPACING['2xl'],
            borderRadius: RADIUS.xl,
          },
          text: TYPOGRAPHY.buttonLarge,
          iconSize: ICON_SIZES.lg,
        };
      case 'md':
      default:
        return {
          container: {
            paddingVertical: SPACING.md,
            paddingHorizontal: SPACING.xl,
            borderRadius: RADIUS.lg,
          },
          text: TYPOGRAPHY.button,
          iconSize: ICON_SIZES.md,
        };
    }
  }, [size]);

  const variantStyles = getVariantStyles();
  const sizeStyles = getSizeStyles();

  return (
    <TouchableOpacity
      style={[
        styles.container,
        sizeStyles.container,
        variantStyles.container,
        fullWidth && styles.fullWidth,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variantStyles.text.color} />
      ) : (
        <View style={styles.content}>
          {leftIcon && (
            <Icon
              name={leftIcon}
              size={sizeStyles.iconSize}
              color={variantStyles.text.color as string}
              style={styles.leftIcon}
            />
          )}
          <Text style={[sizeStyles.text, variantStyles.text, textStyle]}>
            {title}
          </Text>
          {rightIcon && (
            <Icon
              name={rightIcon}
              size={sizeStyles.iconSize}
              color={variantStyles.text.color as string}
              style={styles.rightIcon}
            />
          )}
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  leftIcon: {
    marginRight: SPACING.sm,
  },
  rightIcon: {
    marginLeft: SPACING.sm,
  },
});

export default Button;
