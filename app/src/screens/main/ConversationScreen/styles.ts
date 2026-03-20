import { StyleSheet } from 'react-native';
import { ColorTheme } from '../../../theme/colors';

export const createStyles = (colors: ColorTheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      paddingTop: 50,
      paddingBottom: 20,
      paddingHorizontal: 16,
      backgroundColor: colors.background,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    backButton: {
      position: 'absolute',
      left: 16,
      top: 50,
      flexDirection: 'row',
      alignItems: 'center',
      zIndex: 10,
    },
    backIcon: {
      color: colors.primaryText,
      fontSize: 28,
      fontWeight: '300',
    },
    headerCenter: {
      alignItems: 'center',
      marginTop: 40,
    },
    headerAvatar: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.surfaceSecondary,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 8,
    },
    headerAvatarText: {
      color: colors.textInverse,
      fontSize: 24,
      fontWeight: '500',
    },
    nameContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 2,
    },
    headerName: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '600',
    },
    headerChevron: {
      color: colors.textSecondary,
      fontSize: 18,
      marginLeft: 2,
    },
    headerSubtitle: {
      color: colors.textSecondary,
      fontSize: 13,
    },
    listContent: {
      padding: 16,
    },
    bubbleContainer: {
      marginBottom: 16,
    },
    deleteBackground: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: 100,
      backgroundColor: colors.error,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 18,
    },
    deleteIcon: {
      fontSize: 24,
    },
    bubbleWrapper: {},
    timeLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
      gap: 6,
    },
    timeLabelRowRight: {
      justifyContent: 'flex-end',
    },
    timeLabel: {
      fontSize: 12,
    },
    simBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 8,
    },
    simBadge0: {
      backgroundColor: '#007AFF',
    },
    simBadge1: {
      backgroundColor: '#FF9500',
    },
    simBadgeText: {
      color: '#FFFFFF',
      fontSize: 10,
      fontWeight: '600',
    },
    bubble: {
      borderRadius: 18,
      paddingHorizontal: 16,
      paddingVertical: 12,
      maxWidth: '85%',
      alignSelf: 'flex-start',
    },
    bubbleSent: {
      alignSelf: 'flex-end',
    },
    timeRight: {
      textAlign: 'right',
    },
    bubbleText: {
      color: colors.text,
      fontSize: 16,
      lineHeight: 22,
    },
    linkText: {
      color: colors.primaryText,
      textDecorationLine: 'underline',
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: 12,
      paddingVertical: 10,
      paddingBottom: 34,
      backgroundColor: colors.background,
      borderTopWidth: 0.5,
      borderTopColor: colors.border,
    },
    inputWrapper: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 20,
      borderWidth: 0.5,
      borderColor: colors.border,
      paddingHorizontal: 16,
      paddingVertical: 10,
      minHeight: 40,
      maxHeight: 100,
      marginRight: 10,
    },
    input: {
      color: colors.text,
      fontSize: 16,
      padding: 0,
    },
    sendButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sendButtonDisabled: {
      backgroundColor: colors.surfaceSecondary,
    },
    sendIcon: {
      color: colors.textInverse,
      fontSize: 18,
      fontWeight: '600',
    },
  });

// Default export for backward compatibility
export const styles = createStyles(
  require('../../../theme/colors').LIGHT_COLORS,
);
