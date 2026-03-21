import React from 'react';
import { View, Text } from 'react-native';
import { styles } from '../styles';

interface ProgressBarProps {
  currentStep: number;
  totalSteps: number;
  isRTL?: boolean;
  colors: {
    border: string;
    primary: string;
    textSecondary: string;
  };
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  currentStep,
  totalSteps,
  isRTL = false,
  colors,
}) => {
  const progress = ((currentStep + 1) / totalSteps) * 100;

  const counter = (
    <Text
      style={[
        styles.progressText,
        { color: colors.textSecondary, writingDirection: 'ltr' },
      ]}
    >
      {isRTL
        ? `${totalSteps} / ${currentStep + 1}`
        : `${currentStep + 1} / ${totalSteps}`}
    </Text>
  );

  const bar = (
    <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
      <View
        style={[
          styles.progressFill,
          {
            backgroundColor: colors.primary,
            width: `${progress}%`,
            alignSelf: isRTL ? 'flex-end' : 'flex-start',
          },
        ]}
      />
    </View>
  );

  return (
    <View style={[styles.progressContainer, { direction: 'ltr' }]}>
      {isRTL ? counter : null}
      {bar}
      {isRTL ? null : counter}
    </View>
  );
};

export default ProgressBar;
