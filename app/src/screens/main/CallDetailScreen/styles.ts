import { StyleSheet } from 'react-native';
import { ColorTheme } from '../../../theme/colors';

export const createStyles = (colors: ColorTheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerGradient: {
      backgroundColor: colors.surfaceSecondary,
      paddingTop: 50,
      paddingBottom: 20,
      alignItems: 'center',
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
    },
    backButton: {
      position: 'absolute',
      left: 16,
      top: 50,
      flexDirection: 'row',
      alignItems: 'center',
    },
    backIcon: {
      color: colors.primaryText,
      fontSize: 28,
      fontWeight: '300',
      marginRight: 4,
    },
    backText: {
      color: colors.primaryText,
      fontSize: 17,
    },
    avatarContainer: {
      marginTop: 20,
      marginBottom: 16,
    },
    avatar: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: colors.surfaceSecondary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarText: {
      color: colors.textInverse,
      fontSize: 40,
      fontWeight: '500',
    },
    contactName: {
      color: colors.text,
      fontSize: 28,
      fontWeight: '600',
      marginTop: 40,
      marginBottom: 24,
    },
    actionsRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 24,
    },
    actionButton: {
      alignItems: 'center',
      width: 70,
    },
    actionIconContainer: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: colors.surfaceSecondary,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 6,
    },
    actionIcon: {
      fontSize: 24,
    },
    actionLabel: {
      color: colors.primaryText,
      fontSize: 12,
    },
    tabContainer: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      marginHorizontal: 16,
      marginTop: 16,
      borderRadius: 10,
      padding: 4,
    },
    tab: {
      flex: 1,
      paddingVertical: 10,
      alignItems: 'center',
      borderRadius: 8,
    },
    activeTab: {
      backgroundColor: colors.surfaceSecondary,
    },
    tabText: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '500',
    },
    activeTabText: {
      color: colors.text,
    },
    content: {
      flex: 1,
      marginTop: 16,
    },
    section: {
      backgroundColor: colors.surface,
      marginHorizontal: 16,
      marginBottom: 16,
      borderRadius: 12,
      padding: 16,
    },
    callInfoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    callTypeContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    callTypeIcon: {
      fontSize: 24,
      marginRight: 12,
    },
    callTypeTextContainer: {
      flex: 1,
    },
    callTypeLabel: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '500',
      marginBottom: 2,
    },
    callDateTime: {
      color: colors.textSecondary,
      fontSize: 14,
    },
    callDuration: {
      color: colors.textSecondary,
      fontSize: 14,
      alignSelf: 'center',
    },
    menuRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      marginHorizontal: 16,
      marginBottom: 16,
      borderRadius: 12,
      padding: 16,
    },
    menuIcon: {
      fontSize: 24,
      marginRight: 12,
    },
    menuText: {
      flex: 1,
      color: colors.text,
      fontSize: 16,
    },
    menuChevron: {
      color: colors.textSecondary,
      fontSize: 20,
    },
    sectionLabel: {
      color: colors.textSecondary,
      fontSize: 12,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    phoneRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    phoneNumber: {
      color: colors.primaryText,
      fontSize: 16,
    },
    phoneLabel: {
      color: colors.textSecondary,
      fontSize: 14,
    },
    blockRow: {
      backgroundColor: colors.surface,
      marginHorizontal: 16,
      marginBottom: 32,
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
    },
    blockText: {
      color: colors.error,
      fontSize: 16,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 8,
      gap: 8,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '600',
    },
    historyItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 12,
    },
    historyInfo: {
      flex: 1,
    },
    historyType: {
      fontSize: 15,
      fontWeight: '500',
    },
    historyTime: {
      fontSize: 13,
      marginTop: 2,
    },
    historyDuration: {
      fontSize: 13,
      alignSelf: 'center',
    },
  });

// Default export for backward compatibility
export const styles = createStyles(
  require('../../../theme/colors').LIGHT_COLORS,
);
