import React from 'react';
import { View, Text } from 'react-native';
import { styles } from '../styles';

interface ProgressBarProps {
  currentStep: number;
  totalSteps: number;
  colors: {
    border: string;
    primary: string;
    textSecondary: string;
  };
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  currentStep,
  totalSteps,
  colors,
}) => {
  const progress = ((currentStep + 1) / totalSteps) * 100;

  return (
    <View style={[styles.progressContainer, { direction: 'ltr' }]}>
      <Text
        style={[
          styles.progressText,
          { color: colors.textSecondary, writingDirection: 'ltr' },
        ]}
      >
        {currentStep + 1} / {totalSteps}
      </Text>
      <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
        <View
          style={[
            styles.progressFill,
            {
              backgroundColor: colors.primary,
              width: `${progress}%`,
            },
          ]}
        />
      </View>
    </View>
  );
};

export default ProgressBar;
