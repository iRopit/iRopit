import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { styles } from '../styles';

interface SecurityStepProps {
  colors: {
    text: string;
    textSecondary: string;
    primary: string;
    card: string;
    success: string;
    white: string;
  };
  translate?: (key: string) => string;
  isRTL?: boolean;
}

const SecurityStep: React.FC<SecurityStepProps> = ({
  colors,
  translate: _translate,
  isRTL = false,
}) => {
  // Animation values
  const shieldScale = useRef(new Animated.Value(0)).current;
  const shieldRotate = useRef(new Animated.Value(0)).current;
  const lockOpacity = useRef(new Animated.Value(0)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;
  const feature1Opacity = useRef(new Animated.Value(0)).current;
  const feature2Opacity = useRef(new Animated.Value(0)).current;
  const feature3Opacity = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Shield entrance animation
    Animated.sequence([
      Animated.spring(shieldScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.timing(lockOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(shieldRotate, {
          toValue: 1,
          duration: 600,
          easing: Easing.elastic(1),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(checkOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    // Features stagger animation
    Animated.stagger(200, [
      Animated.timing(feature1Opacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(feature2Opacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(feature3Opacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();

    // Continuous pulse animation for shield
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rotateInterpolate = shieldRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['-10deg', '0deg'],
  });

  const securityFeatures = [
    {
      icon: 'lock-closed',
      title: isRTL ? 'تشفير من طرف لطرف' : 'End-to-End Encryption',
      description: isRTL
        ? 'جميع بياناتك مشفرة بخوارزمية AES-256'
        : 'All your data is encrypted with AES-256',
      opacity: feature1Opacity,
    },
    {
      icon: 'shield-checkmark',
      title: isRTL ? 'خصوصية كاملة' : 'Complete Privacy',
      description: isRTL
        ? 'بياناتك لا يمكن قراءتها إلا بواسطتك'
        : 'Only you can read your data',
      opacity: feature2Opacity,
    },
    {
      icon: 'key',
      title: isRTL ? 'مفتاح فريد لك' : 'Your Unique Key',
      description: isRTL
        ? 'مفتاح التشفير مرتبط بحسابك فقط'
        : 'Encryption key is tied to your account only',
      opacity: feature3Opacity,
    },
  ];

  return (
    <View style={styles.overviewContainer}>
      {/* Animated Shield Icon — fixed header */}
      <Animated.View
        style={[
          styles.securityShieldContainer,
          {
            backgroundColor: `${colors.primary}15`,
            alignSelf: 'center',
            transform: [
              { scale: Animated.multiply(shieldScale, pulseAnim) },
              { rotate: rotateInterpolate },
            ],
          },
        ]}
      >
        <View style={styles.securityIconsWrapper}>
          <Icon name="shield" size={100} color={colors.primary} />
          <Animated.View
            style={[styles.securityLockIcon, { opacity: lockOpacity }]}
          >
            <Icon name="lock-closed" size={40} color={colors.white} />
          </Animated.View>
          <Animated.View
            style={[styles.securityCheckIcon, { opacity: checkOpacity }]}
          >
            <View
              style={[
                styles.securityCheckBadge,
                { backgroundColor: colors.success },
              ]}
            >
              <Icon name="checkmark" size={16} color={colors.white} />
            </View>
          </Animated.View>
        </View>
      </Animated.View>

      {/* Title Section — fixed header */}
      <View style={styles.titleSection}>
        <Text style={[styles.title, { color: colors.text }]}>
          {isRTL ? 'بياناتك محمية' : 'Your Data is Protected'}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {isRTL
            ? 'نستخدم أعلى معايير التشفير لحماية خصوصيتك'
            : 'We use the highest encryption standards to protect your privacy'}
        </Text>
      </View>

      {/* Security Features List — scrollable */}
      <ScrollView
        style={styles.overviewContent}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 20 }}
      >
        <View style={styles.securityFeaturesList}>
          {securityFeatures.map((feature, index) => (
            <Animated.View
              key={index}
              style={[
                styles.securityFeatureItem,
                {
                  backgroundColor: colors.card,
                  opacity: feature.opacity,
                  transform: [
                    {
                      translateY: feature.opacity.interpolate({
                        inputRange: [0, 1],
                        outputRange: [20, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View
                style={[
                  styles.securityFeatureIcon,
                  { backgroundColor: `${colors.primary}20` },
                ]}
              >
                <Icon name={feature.icon} size={24} color={colors.primary} />
              </View>
              <View style={styles.securityFeatureText}>
                <Text style={[styles.securityFeatureTitle, { color: colors.text }]}>
                  {feature.title}
                </Text>
                <Text style={[styles.securityFeatureDesc, { color: colors.textSecondary }]}>
                  {feature.description}
                </Text>
              </View>
            </Animated.View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};

export default SecurityStep;
