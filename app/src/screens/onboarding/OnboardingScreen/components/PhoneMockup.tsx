import React from 'react';
import { View } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { styles } from '../styles';

interface PhoneMockupProps {
  iconName: string;
  colors: {
    phoneBorder: string;
    phoneScreen: string;
    primary: string;
  };
  bgColor?: string;
}

const PhoneMockup: React.FC<PhoneMockupProps> = ({
  iconName,
  colors,
  bgColor,
}) => {
  return (
    <View style={styles.phoneContainer}>
      <View
        style={[
          styles.phoneMockup,
          {
            borderColor: colors.phoneBorder,
            backgroundColor: bgColor || colors.phoneScreen,
          },
        ]}
      >
        <View style={styles.phoneScreen}>
          <Icon name={iconName} size={36} color={colors.primary} />
        </View>
      </View>
    </View>
  );
};

export default PhoneMockup;
