import { StyleSheet } from 'react-native';
import { ACTION_WIDTH } from './helper';
import { ColorTheme } from '../../../theme/colors';

export const createStyles = (colors: ColorTheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 50,
      paddingBottom: 8,
      backgroundColor: colors.background,
    },
    editButton: {
      backgroundColor: colors.surface,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
    },
    editButtonText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '500',
    },
    headerSpacer: {
      width: 36,
    },
    titleContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    deleteAllButton: {
      padding: 8,
    },
    deleteSelectedButton: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 8,
    },
    deleteSelectedText: {
      color: colors.error,
      fontSize: 14,
      marginLeft: 4,
      fontWeight: '600',
    },
    headerButtonText: {
      fontSize: 17,
      fontWeight: '400',
    },
    title: {
      color: colors.text,
      fontSize: 34,
      fontWeight: '700',
    },
    searchContainer: {
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      height: 36,
    },
    searchIcon: {
      fontSize: 16,
      marginRight: 8,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      paddingVertical: 0,
      paddingHorizontal: 0,
    },
    clearIcon: {
      color: colors.textSecondary,
      fontSize: 16,
      padding: 4,
    },
    listContent: {
      flexGrow: 1,
    },
    swipeContainer: {
      backgroundColor: colors.background,
      position: 'relative',
      overflow: 'hidden',
      marginBottom: 0,
    },
    actionsContainer: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      flexDirection: 'row',
    },
    actionsLeft: {
      left: 0,
    },
    actionsRight: {
      right: 0,
    },
    actionButton: {
      width: ACTION_WIDTH,
      justifyContent: 'center',
      alignItems: 'center',
    },
    deleteButton: {
      backgroundColor: colors.error,
    },
    actionIcon: {
      fontSize: 24,
    },
    callRow: {
      backgroundColor: colors.background,
      elevation: 5,
    },
    rowContent: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    avatarContainer: {
      marginRight: 12,
    },
    checkboxContainer: {
      marginRight: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: colors.textSecondary,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.transparent,
    },
    checkboxSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.surfaceSecondary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarText: {
      color: colors.textInverse,
      fontSize: 20,
      fontWeight: '500',
    },
    callContent: {
      flex: 1,
    },
    topRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 4,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      marginRight: 8,
    },
    callerName: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '600',
      marginRight: 4,
    },
    missedCallName: {
      color: colors.error,
    },
    callCount: {
      color: colors.textSecondary,
      fontSize: 15,
    },
    timeContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    timeText: {
      color: colors.textSecondary,
      fontSize: 15,
    },
    chevron: {
      color: colors.textSecondary,
      fontSize: 18,
      marginLeft: 4,
      fontWeight: '300',
    },
    subtitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    typeIcon: {
      fontSize: 12,
      marginRight: 6,
    },
    phoneText: {
      color: colors.textSecondary,
      fontSize: 15,
      writingDirection: 'ltr',
      textAlign: 'left',
    },
    separator: {
      height: 0.5,
      backgroundColor: colors.border,
      marginLeft: 84,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 40,
      paddingTop: 100,
    },
    emptyIcon: {
      fontSize: 64,
      marginBottom: 16,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '600',
      marginBottom: 8,
      textAlign: 'center',
    },
    emptySubtitle: {
      color: colors.textSecondary,
      fontSize: 15,
      textAlign: 'center',
      lineHeight: 22,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    loadingText: {
      marginTop: 12,
      fontSize: 16,
    },
  });

// Static styles for layout-only properties (no colors)
export const styles = createStyles(
  require('../../../theme/colors').LIGHT_COLORS,
);
