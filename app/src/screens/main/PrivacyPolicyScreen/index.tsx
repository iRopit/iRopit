import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../../contexts/ThemeContext';
import Icon from 'react-native-vector-icons/Ionicons';

import { PrivacyPolicyScreenProps } from './types';
import { styles } from './styles';

const PrivacyPolicyScreen = ({ navigation }: PrivacyPolicyScreenProps) => {
  const { colors, t, isDarkMode, isRTL } = useTheme();

  // Dynamic colors
  const bgColor = colors.background;
  const textColor = colors.text;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: bgColor }]}
      edges={['top', 'left', 'right']}
    >
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

      {/* Header with back button */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Icon
            name={isRTL ? 'chevron-forward' : 'chevron-back'}
            size={28}
            color={colors.primary}
          />
        </TouchableOpacity>
      </View>

      {/* Title */}
      <View style={styles.titleContainer}>
        <Text style={[styles.title, { color: textColor }]}>{t('privacy')}</Text>
      </View>

      <ScrollView style={styles.content}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Privacy Policy
        </Text>

        <Text style={[styles.text, { color: colors.textSecondary }]}>
          Last Updated: January 1, 2025
        </Text>

        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          1. Information We Collect
        </Text>
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          We collect information you provide directly to us, such as when you
          create an account, send messages, or use our services. This includes
          your name, email address, phone number, and device information.
        </Text>

        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          2. How We Use Your Information
        </Text>
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          We use the information we collect to:
          {'\n'}• Provide and improve our services
          {'\n'}• Send you service-related announcements
          {'\n'}• Respond to your inquiries
          {'\n'}• Detect and prevent fraud or abuse
        </Text>

        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          3. Information Sharing
        </Text>
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          We do not sell, trade, or rent your personal information to third
          parties. We may share information when required by law or to protect
          our rights.
        </Text>

        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          4. Data Security
        </Text>
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          We implement appropriate technical and organizational measures to
          protect your personal information against unauthorized access,
          alteration, disclosure, or destruction.
        </Text>

        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          5. Your Rights
        </Text>
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          You have the right to access, correct, or delete your personal
          information. Contact us at privacy@iropit.com to exercise these
          rights.
        </Text>

        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          6. Contact Us
        </Text>
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          If you have any questions about this Privacy Policy, please contact us
          at:
          {'\n'}Email: privacy@iropit.com
          {'\n'}Website: www.iropit.com
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

export default PrivacyPolicyScreen;
