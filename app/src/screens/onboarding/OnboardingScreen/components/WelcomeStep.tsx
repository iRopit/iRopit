import React from 'react';
import { View, Text, Image, ScrollView, useWindowDimensions } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { styles } from '../styles';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const logoImage = require('../../../../assets/logo.png');

interface WelcomeStepProps {
  colors: {
    primary: string;
    textSecondary: string;
    text: string;
    surface: string;
    border: string;
  };
  translate: (key: string) => string;
}

const WelcomeStep: React.FC<WelcomeStepProps> = ({ colors, translate }) => {
  const { height } = useWindowDimensions();
  const isCompactHeight = height < 760;

  const features = [
    { icon: 'chatbubbles-outline', title: 'Device-to-Device Chat' },
    { icon: 'chatbox-ellipses-outline', title: 'SMS Synchronization' },
    { icon: 'call-outline', title: 'Call History Sync' },
    { icon: 'notifications-outline', title: 'Notifications Sync' },
    { icon: 'bar-chart-outline', title: 'Insights' },
    { icon: 'phone-portrait-outline', title: 'Multi-Device Management' },
    { icon: 'shield-checkmark-outline', title: 'Security & Encryption' },
    { icon: 'language-outline', title: 'Multi-Language' },
  ];

  return (
    <View style={[styles.content, styles.welcomeTopContent]}>
      <View
        style={[
          styles.welcomeIconContainer,
          { backgroundColor: `${colors.primary}15` },
        ]}
      >
        <Image
          source={logoImage}
          style={styles.welcomeLogoImage}
          resizeMode="contain"
        />
      </View>

      <View style={[styles.titleSection, styles.welcomeTitleSection]}>
        <Text style={[styles.appName, { color: colors.text }]}>
          iRopit
        </Text>
        <Text style={[styles.tagline, { color: colors.textSecondary }]}>
          {translate('onboarding.welcomeSubtitle')}
        </Text>
      </View>

      {isCompactHeight ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.welcomeFeaturesCarousel}
        >
          {features.map((feature) => (
            <View
              key={feature.title}
              style={[
                styles.welcomeFeatureCard,
                styles.welcomeFeatureCardCompact,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Icon name={feature.icon} size={14} color={colors.primary} />
              <Text style={[styles.welcomeFeatureTitle, { color: colors.text }]}>
                {feature.title}
              </Text>
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.welcomeFeaturesGrid}>
          {features.map((feature) => (
            <View
              key={feature.title}
              style={[
                styles.welcomeFeatureCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Icon name={feature.icon} size={14} color={colors.primary} />
              <Text style={[styles.welcomeFeatureTitle, { color: colors.text }]}>
                {feature.title}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

export default WelcomeStep;
