import { StyleSheet, Dimensions, Platform } from 'react-native';
import { ColorTheme } from '../../../theme/colors';

const { width, height } = Dimensions.get('window');

export const createStyles = (colors: ColorTheme) =>
  StyleSheet.create({
    // Main container
    container: {
      flex: 1,
    },
    safeArea: {
      flex: 1,
      paddingTop: Platform.OS === 'android' ? 10 : 0,
    },

    // Header
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 10,
      zIndex: 10,
    },
    skipButton: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 20,
    },
    skipText: {
      fontSize: 20,
      fontWeight: '600',
    },
    backButton: {
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    backIcon: {
      fontSize: 24,
      fontWeight: '300',
    },
    languageButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 25,
      borderWidth: 1.5,
    },
    languageText: {
      fontSize: 14,
      fontWeight: '600',
      marginLeft: 6,
    },
    languageFlag: {
      fontSize: 18,
    },
    headerControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    headerControlBtn: {
      minWidth: 46,
      height: 40,
      borderRadius: 10,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 10,
    },
    headerControlText: {
      fontSize: 15,
      fontWeight: '700',
      letterSpacing: 0.3,
    },

    // Content
    content: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },

    // Phone mockup - Professional design
    phoneContainer: {
      alignItems: 'center',
      marginBottom: 16,
    },
    phoneMockup: {
      width: width * 0.28,
      height: height * 0.18,
      borderRadius: 20,
      borderWidth: 6,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 15 },
      shadowOpacity: 0.2,
      shadowRadius: 25,
      elevation: 15,
    },
    phoneScreen: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    phoneNotch: {
      position: 'absolute',
      top: 8,
      width: 80,
      height: 24,
      borderRadius: 12,
      alignSelf: 'center',
    },
    phoneIcon: {
      fontSize: 56,
    },

    // Title section
    titleSection: {
      alignItems: 'center',
      marginBottom: 32,
    },
    title: {
      fontSize: 28,
      fontWeight: '800',
      textAlign: 'center',
      marginBottom: 10,
      letterSpacing: -0.5,
      width: '100%',
    },
    subtitle: {
      fontSize: 15,
      textAlign: 'center',
      lineHeight: 24,
      paddingHorizontal: 16,
      opacity: 0.85,
    },

    // Primary button - More prominent
    primaryButton: {
      width: '100%',
      paddingVertical: 18,
      borderRadius: 14,
      alignItems: 'center',
      marginBottom: 12,
      shadowColor: colors.primaryDark,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 12,
      elevation: 8,
    },
    primaryButtonText: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.textInverse,
      letterSpacing: 0.5,
    },

    // Secondary button
    secondaryButton: {
      paddingVertical: 14,
      alignItems: 'center',
    },
    secondaryButtonText: {
      fontSize: 15,
      fontWeight: '600',
      opacity: 0.7,
    },

    // Bottom section
    bottomSection: {
      paddingHorizontal: 24,
      paddingBottom: Platform.OS === 'ios' ? 34 : 24,
      paddingTop: 16,
      // marginTop: 8,
    },

    // Dots indicator - More elegant
    dotsContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      // marginBottom: 28,
      // gap: 8,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginHorizontal: 5,
      opacity: 0.4,
    },
    dotActive: {
      width: 28,
      opacity: 1,
      borderRadius: 4,
    },

    // Progress Bar - Alternative to dots
    progressContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 10,
      gap: 12,
    },
    progressBar: {
      flex: 1,
      height: 6,
      borderRadius: 3,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: 3,
    },
    progressText: {
      fontSize: 13,
      fontWeight: '600',
      minWidth: 40,
      textAlign: 'center',
    },

    // System Theme Option
    systemThemeOption: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      borderRadius: 16,
      borderWidth: 2.5,
      marginBottom: 16,
    },
    systemThemeIconContainer: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
    },
    systemThemeIcon: {
      fontSize: 28,
      marginRight: 14,
    },
    systemThemeInfo: {
      flex: 1,
    },
    systemThemeName: {
      fontSize: 16,
      fontWeight: '700',
      marginBottom: 2,
    },
    systemThemeDesc: {
      fontSize: 13,
    },
    checkmarkSmall: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // Theme Selection - Card style
    themeSelectionContainer: {
      width: '100%',
      paddingHorizontal: 20,
      marginBottom: 20,
    },
    themeOptionsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 16,
    },
    themeOption: {
      flex: 1,
      borderRadius: 20,
      padding: 16,
      alignItems: 'center',
      borderWidth: 2.5,
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
      elevation: 4,
    },
    themeOptionSelected: {
      borderWidth: 3,
      shadowOpacity: 0.15,
    },
    themePreview: {
      width: '100%',
      height: 100,
      borderRadius: 16,
      marginBottom: 12,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    themePreviewPhone: {
      width: 48,
      height: 80,
      borderRadius: 12,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    themePreviewIcon: {
      fontSize: 22,
    },
    themeName: {
      fontSize: 17,
      fontWeight: '700',
      marginTop: 4,
    },
    checkmark: {
      position: 'absolute',
      top: 12,
      right: 12,
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // Language Selection - List style
    languageSelectionContainer: {
      width: '100%',
      marginTop: 16,
    },
    languageOption: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 20,
      paddingHorizontal: 22,
      borderRadius: 20,
      marginBottom: 14,
      borderWidth: 2.5,
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 3,
    },
    languageOptionSelected: {
      borderWidth: 3,
      shadowOpacity: 0.1,
    },
    languageInfo: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    languageFlagLarge: {
      fontSize: 36,
      marginRight: 18,
    },
    languageTextContainer: {
      flex: 1,
    },
    languageNamePrimary: {
      fontSize: 20,
      fontWeight: '700',
      marginBottom: 3,
    },
    languageNameSecondary: {
      fontSize: 14,
      opacity: 0.7,
    },
    radioCircle: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 2.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioCircleInner: {
      width: 14,
      height: 14,
      borderRadius: 7,
    },

    // Permissions - Card list
    permissionsContainer: {
      flex: 1,
      width: '100%',
    },
    permissionsList: {
      flex: 1,
      paddingHorizontal: 4,
    },
    permissionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 18,
      paddingHorizontal: 18,
      borderRadius: 20,
      marginBottom: 14,
      borderWidth: 1.5,
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.04,
      shadowRadius: 6,
      elevation: 2,
    },
    permissionIcon: {
      width: 52,
      height: 52,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 16,
    },
    permissionIconText: {
      fontSize: 26,
    },
    permissionInfo: {
      flex: 1,
    },
    permissionName: {
      fontSize: 17,
      fontWeight: '700',
      marginBottom: 5,
    },
    permissionDescription: {
      fontSize: 13,
      lineHeight: 19,
      opacity: 0.75,
    },
    permissionStatus: {
      marginLeft: 14,
    },
    permissionGranted: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    grantButton: {
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderRadius: 22,
    },
    grantButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textInverse,
    },

    // Overview - Feature list
    overviewContainer: {
      flex: 1,
      paddingHorizontal: 24,
    },
    overviewContent: {
      flex: 1,
      paddingTop: 10,
    },
    featureItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: 28,
    },
    featureIcon: {
      width: 52,
      height: 52,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 18,
    },
    featureIconText: {
      fontSize: 24,
    },
    featureInfo: {
      flex: 1,
      paddingTop: 2,
    },
    featureTitle: {
      fontSize: 18,
      fontWeight: '700',
      marginBottom: 6,
    },
    featureDescription: {
      fontSize: 14,
      lineHeight: 22,
      opacity: 0.75,
    },

    // Bottom Sheet
    bottomSheetOverlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    bottomSheet: {
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingTop: 14,
      paddingBottom: Platform.OS === 'ios' ? 44 : 28,
      paddingHorizontal: 24,
    },
    bottomSheetHandle: {
      width: 44,
      height: 5,
      borderRadius: 3,
      alignSelf: 'center',
      marginBottom: 22,
      opacity: 0.3,
    },
    bottomSheetTitle: {
      fontSize: 22,
      fontWeight: '800',
      textAlign: 'center',
      marginBottom: 28,
    },

    // Welcome specific - Hero style
    welcomeTopContent: {
      justifyContent: 'flex-start',
      paddingTop: 80,
    },
    welcomeIconContainer: {
      marginBottom: 36,
      alignItems: 'center',
    },
    welcomeIcon: {
      fontSize: 90,
    },
    appName: {
      fontSize: 42,
      fontWeight: '900',
      marginBottom: 12,
      letterSpacing: -1,
    },
    tagline: {
      fontSize: 17,
      textAlign: 'center',
      lineHeight: 28,
      opacity: 0.8,
    },
    welcomeFeaturesGrid: {
      width: '100%',
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginTop: 6,
      rowGap: 10,
    },
    welcomeFeatureCard: {
      width: '48.5%',
      minHeight: 52,
      borderRadius: 12,
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    welcomeFeatureTitle: {
      flex: 1,
      fontSize: 12,
      fontWeight: '700',
      lineHeight: 16,
    },

    // Decorative elements
    decorativeCircle: {
      position: 'absolute',
      borderRadius: 999,
      opacity: 0.08,
    },

    // Security Step Styles
    securityShieldContainer: {
      width: 160,
      height: 160,
      borderRadius: 80,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 32,
    },
    securityIconsWrapper: {
      position: 'relative',
      alignItems: 'center',
      justifyContent: 'center',
    },
    securityLockIcon: {
      position: 'absolute',
      top: 35,
    },
    securityCheckIcon: {
      position: 'absolute',
      bottom: -5,
      right: -15,
    },
    securityCheckBadge: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 3,
      borderColor: colors.white,
    },
    securityFeaturesList: {
      width: '100%',
      paddingHorizontal: 16,
      marginTop: 16,
    },
    securityFeatureItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      borderRadius: 16,
      marginBottom: 12,
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 8,
      elevation: 2,
    },
    securityFeatureIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
    },
    securityFeatureText: {
      flex: 1,
    },
    securityFeatureTitle: {
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4,
    },
    securityFeatureDesc: {
      fontSize: 13,
      opacity: 0.7,
    },
  });

export const styles = createStyles(
  require('../../../theme/colors').LIGHT_COLORS,
);
