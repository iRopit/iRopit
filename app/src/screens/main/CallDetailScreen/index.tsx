import React, { useMemo } from 'react';
import Icon from 'react-native-vector-icons/Ionicons';
import {
  View,
  Text,
  TouchableOpacity,
  Linking,
  Alert,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../../types';
import { useTheme } from '../../../contexts/ThemeContext';
import { useCallStore } from '../../../store/callStore';
import { Container } from '../../../components';

import { styles } from './styles';
import {
  getInitials,
  formatDateTime,
  formatDuration,
  getCallTypeLabel,
  getCallTypeIcon,
} from './helper';

type CallDetailRouteProp = RouteProp<RootStackParamList, 'CallDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const CallDetailScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<CallDetailRouteProp>();
  const { call } = route.params;
  const { isRTL, t, isDarkMode, colors } = useTheme();
  const { calls } = useCallStore();
  const insets = useSafeAreaInsets();

  // Get all calls for this phone number
  const callHistory = useMemo(() => {
    return calls
      .filter(c => c.phoneNumber === call.phoneNumber)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [calls, call.phoneNumber]);

  // Dynamic colors based on theme
  const bgColor = colors.background;
  const textColor = colors.text;
  const secondaryTextColor = colors.textSecondary;
  const surfaceColor = isDarkMode ? colors.surface : colors.surfaceSecondary;
  const avatarBgColor = isDarkMode
    ? colors.surfaceSecondary
    : colors.surfaceTertiary;
  const borderColor = colors.border;

  const handleCall = () => {
    const phoneNumber = call.phoneNumber;
    Linking.openURL(`tel:${phoneNumber}`).catch(() => {
      Alert.alert('Error', 'Unable to make call');
    });
  };

  const handleMessage = () => {
    const phoneNumber = call.phoneNumber;
    Linking.openURL(`sms:${phoneNumber}`).catch(() => {
      Alert.alert('Error', 'Unable to open messages');
    });
  };

  const handleVideo = () => {
    const phoneNumber = call.phoneNumber;
    Linking.canOpenURL('facetime://')
      .then(supported => {
        if (supported) {
          Linking.openURL(`facetime:${phoneNumber}`);
        } else {
          Linking.canOpenURL('https://duo.google.com').then(duoSupported => {
            if (duoSupported) {
              Linking.openURL(`https://duo.google.com/call/${phoneNumber}`);
            } else {
              const whatsappUrl = `whatsapp://send?phone=${phoneNumber.replace(
                /[^0-9]/g,
                '',
              )}`;
              Linking.canOpenURL(whatsappUrl).then(waSupported => {
                if (waSupported) {
                  Linking.openURL(whatsappUrl);
                } else {
                  Alert.alert(
                    'Video Call',
                    'No video calling app available. Please install WhatsApp, Duo, or FaceTime.',
                  );
                }
              });
            }
          });
        }
      })
      .catch(() => {
        Alert.alert('Error', 'Unable to initiate video call');
      });
  };

  const handleEmail = () => {
    Linking.openURL('mailto:').catch(() => {
      Alert.alert('Error', 'Unable to open email app');
    });
  };

  const displayName = call.contactName || call.phoneNumber;

  return (
    <Container
      isDark={isDarkMode}
      noPaddingHorizontal
      backgroundColor={bgColor}
      edges={['top']}
    >
      {/* Header with gradient background */}
      <View
        style={[
          styles.headerGradient,
          {
            backgroundColor: isDarkMode
              ? colors.surfaceSecondary
              : colors.surfaceTertiary,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={[styles.backIcon, { color: colors.primaryText }]}>
            ‹
          </Text>
          <Text style={[styles.backText, { color: colors.primaryText }]}>
            {isRTL ? 'المكالمات' : 'Calls'}
          </Text>
        </TouchableOpacity>

        {/* Contact Name */}
        <Text style={[styles.contactName, { color: textColor }]}>
          {displayName}
        </Text>

        {/* Action Buttons */}
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.actionButton} onPress={handleMessage}>
            <View
              style={[
                styles.actionIconContainer,
                {
                  backgroundColor: isDarkMode
                    ? colors.surfaceSecondary
                    : colors.surfaceTertiary,
                },
              ]}
            >
              <Icon name="chatbubble" size={24} color={colors.primary} />
            </View>
            <Text style={styles.actionLabel}>
              {isRTL ? 'رسالة' : 'message'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={handleCall}>
            <View
              style={[
                styles.actionIconContainer,
                {
                  backgroundColor: isDarkMode
                    ? colors.surfaceSecondary
                    : colors.surfaceTertiary,
                },
              ]}
            >
              <Icon name="call" size={24} color={colors.primary} />
            </View>
            <Text style={styles.actionLabel}>{isRTL ? 'اتصال' : 'call'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={handleEmail}>
            <View
              style={[
                styles.actionIconContainer,
                {
                  backgroundColor: isDarkMode
                    ? colors.surfaceSecondary
                    : colors.surfaceTertiary,
                },
              ]}
            >
              <Icon name="mail" size={24} color={colors.primary} />
            </View>
            <Text style={styles.actionLabel}>{isRTL ? 'بريد' : 'mail'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
        {/* Call History Section */}
        <View style={[styles.section, { backgroundColor: surfaceColor }]}>
          <View style={styles.sectionHeader}>
            <Icon name="time-outline" size={20} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: textColor }]}>
              {isRTL ? 'سجل المكالمات' : 'Call History'} ({callHistory.length})
            </Text>
          </View>

          {callHistory.map((historyCall, index) => (
            <View
              key={`${historyCall.id}_${historyCall.timestamp}_${index}`}
              style={[
                styles.historyItem,
                index < callHistory.length - 1 && {
                  borderBottomWidth: 0.5,
                  borderBottomColor: borderColor,
                },
              ]}
            >
              <Icon
                name={getCallTypeIcon(historyCall.type)}
                size={18}
                color={
                  historyCall.type === 'missed'
                    ? colors.missed
                    : colors.incoming
                }
              />
              <View style={styles.historyInfo}>
                <Text style={[styles.historyType, { color: textColor }]}>
                  {getCallTypeLabel(historyCall.type)}
                </Text>
                <Text
                  style={[styles.historyTime, { color: secondaryTextColor }]}
                >
                  {formatDateTime(historyCall.timestamp)}
                </Text>
              </View>
              {historyCall.duration > 0 && (
                <Text
                  style={[
                    styles.historyDuration,
                    { color: secondaryTextColor },
                  ]}
                >
                  {formatDuration(historyCall.duration)}
                </Text>
              )}
            </View>
          ))}
        </View>

        {/* Phone Number Section */}
        <View style={[styles.section, { backgroundColor: surfaceColor }]}>
          <Text style={[styles.sectionLabel, { color: secondaryTextColor }]}>
            {isRTL ? 'الهاتف' : 'Phone'}
          </Text>
          <TouchableOpacity style={styles.phoneRow} onPress={handleCall}>
            <Text style={[styles.phoneNumber, { color: colors.primaryText }]}>
              {call.phoneNumber}
            </Text>
            <Text style={[styles.phoneLabel, { color: secondaryTextColor }]}>
              {isRTL ? 'محمول' : 'mobile'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Container>
  );
};

export default CallDetailScreen;
