import React from 'react';
import { View, Text, Image } from 'react-native';
import { styles } from '../styles';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const logoImage = require('../../../../assets/logo.png');

interface WelcomeStepProps {
  colors: {
    primary: string;
    textSecondary: string;
  };
  translate: (key: string) => string;
}

const WelcomeStep: React.FC<WelcomeStepProps> = ({ colors, translate }) => {
  return (
    <View style={styles.content}>
      <View
        style={[
          styles.welcomeIconContainer,
          { backgroundColor: `${colors.primary}15` },
        ]}
      >
        <Image
          source={logoImage}
          style={{ width: 120, height: 120 }}
          resizeMode="contain"
        />
      </View>

      <View style={styles.titleSection}>
        <Text style={[styles.appName, { color: colors.text }]}>
          iRopit
        </Text>
        <Text style={[styles.tagline, { color: colors.textSecondary }]}>
          {translate('onboarding.welcomeSubtitle')}
        </Text>
      </View>
    </View>
  );
};

export default WelcomeStep;
