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

import { TermsOfServiceScreenProps } from './types';
import { styles } from './styles';

const TermsOfServiceScreen = ({ navigation }: TermsOfServiceScreenProps) => {
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
        <Text style={[styles.title, { color: textColor }]}>{t('terms')}</Text>
      </View>

      <ScrollView style={styles.content}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Terms of Service
        </Text>

        <Text style={[styles.text, { color: colors.textSecondary }]}>
          Last Updated: January 1, 2025
        </Text>

        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          1. Acceptance of Terms
        </Text>
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          By accessing and using iRopit, you accept and agree to be bound by the
          terms and provision of this agreement. If you do not agree to abide by
          the above, please do not use this service.
        </Text>

        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          2. Use License
        </Text>
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          Permission is granted to temporarily download one copy of the
          materials on iRopit for personal, non-commercial transitory viewing
          only. This is the grant of a license, not a transfer of title, and
          under this license you may not:
          {'\n'}• Modify or copy the materials
          {'\n'}• Use the materials for any commercial purpose
          {'\n'}• Attempt to decompile or reverse engineer any software
          {'\n'}• Remove any copyright or proprietary notations
          {'\n'}• Transfer the materials to another person or entity
        </Text>

        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          3. Disclaimer
        </Text>
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          The materials on iRopit are provided on an 'as is' basis. iRopit makes
          no warranties, expressed or implied, and hereby disclaims and negates
          all other warranties including, without limitation, implied warranties
          or conditions of merchantability, fitness for a particular purpose, or
          non-infringement of intellectual property or other violation of
          rights.
        </Text>

        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          4. Limitations
        </Text>
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          In no event shall iRopit or its suppliers be liable for any damages
          (including, without limitation, damages for loss of data or profit, or
          due to business interruption) arising out of the use or inability to
          use the materials on iRopit.
        </Text>

        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          5. Accuracy of Materials
        </Text>
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          The materials appearing on iRopit could include technical,
          typographical, or photographic errors. iRopit does not warrant that
          any of the materials on iRopit are accurate, complete, or current.
        </Text>

        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          6. Modifications
        </Text>
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          iRopit may revise these terms of service for its website at any time
          without notice. By using this website, you are agreeing to be bound by
          the then current version of these terms of service.
        </Text>

        <Text style={[styles.sectionSubtitle, { color: colors.text }]}>
          7. Governing Law
        </Text>
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          These terms and conditions are governed by and construed in accordance
          with the laws of the jurisdiction in which the service is provided,
          and you irrevocably submit to the exclusive jurisdiction of the courts
          in that location.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

export default TermsOfServiceScreen;
