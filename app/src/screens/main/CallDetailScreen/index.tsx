import React, { useMemo, useState, useRef, useEffect } from 'react';
import Icon from 'react-native-vector-icons/Ionicons';
import {
  View,
  Text,
  TouchableOpacity,
  Linking,
  Alert,
  ScrollView,
  Platform,
  NativeModules,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../../types';
import { useTheme } from '../../../contexts/ThemeContext';
import { useCallStore } from '../../../store/callStore';
import { Container } from '../../../components';
import { normalizePhoneForWhatsApp } from '../../../utils/phoneUtils';
import Clipboard from '@react-native-clipboard/clipboard';

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

  // Load native SIM slot data for enrichment
  const [simSlotMap, setSimSlotMap] = useState<Record<string, number>>({});
  const simSlotLoaded = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'android' || simSlotLoaded.current) return;
    simSlotLoaded.current = true;

    const { CallLogModule } = NativeModules;
    if (!CallLogModule) return;

    CallLogModule.getCallLog(500).then((nativeCalls: any[]) => {
      if (!nativeCalls) return;
      const map: Record<string, number> = {};
      for (const c of nativeCalls) {
        if (c.simSlot != null && c.simSlot >= 0) {
          const digits = (c.phoneNumber || '').replace(/[^0-9]/g, '');
          const suffix = digits.length > 9 ? digits.slice(-9) : digits;
          const tsSeconds = Math.floor(Number(c.timestamp) / 1000);
          map[`${tsSeconds}_${suffix}`] = c.simSlot;
        }
      }
      setSimSlotMap(map);
    }).catch(() => {});
  }, []);

  // Get all calls for this phone number, enriched with SIM data
  const callHistory = useMemo(() => {
    const resolveSimSlot = (c: any): number | undefined => {
      if (c.simSlot != null && c.simSlot >= 0) return c.simSlot;
      const digits = (c.phoneNumber || '').replace(/[^0-9]/g, '');
      const suffix = digits.length > 9 ? digits.slice(-9) : digits;
      const tsSeconds = Math.floor(Number(c.timestamp) / 1000);
      // Try exact second, then ±1s window
      for (let offset = 0; offset <= 1; offset++) {
        const val = simSlotMap[`${tsSeconds + offset}_${suffix}`] ?? simSlotMap[`${tsSeconds - offset}_${suffix}`];
        if (val != null) return val;
      }
      return undefined;
    };

    // Normalize phone for matching: use last 9 digits
    const normalizePhone = (p: string) => {
      const digits = (p || '').replace(/[^0-9]/g, '');
      return digits.length > 9 ? digits.slice(-9) : digits;
    };
    const targetSuffix = normalizePhone(call.phoneNumber);

    const filtered = calls
      .filter(c => normalizePhone(c.phoneNumber) === targetSuffix)
      .sort((a, b) => b.timestamp - a.timestamp);

    // Deduplicate calls with same type within 2 seconds of each other
    const deduped: typeof filtered = [];
    for (const c of filtered) {
      const isDupe = deduped.some(
        d => d.type === c.type && Math.abs(d.timestamp - c.timestamp) < 2000,
      );
      if (!isDupe) deduped.push(c);
    }

    return deduped.map(c => ({ ...c, simSlot: resolveSimSlot(c) }));
  }, [calls, call.phoneNumber, simSlotMap]);

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

  const handleVideo = async () => {
    const phoneNumber = call.phoneNumber;
    const supported = await Linking.canOpenURL('facetime://');
    if (supported) {
      Linking.openURL(`facetime:${phoneNumber}`);
    } else {
      const duoSupported = await Linking.canOpenURL('https://duo.google.com');
      if (duoSupported) {
        Linking.openURL(`https://duo.google.com/call/${phoneNumber}`);
      } else {
        const waPhone = await normalizePhoneForWhatsApp(phoneNumber);
        const whatsappUrl = `whatsapp://send?phone=${waPhone}`;
        const waSupported = await Linking.canOpenURL(whatsappUrl);
        if (waSupported) {
          Linking.openURL(whatsappUrl);
        } else {
          Alert.alert(
            'Video Call',
            'No video calling app available. Please install WhatsApp, Duo, or FaceTime.',
          );
        }
      }
    }
  };

  const handleWhatsApp = async () => {
    const phoneNumber = await normalizePhoneForWhatsApp(call.phoneNumber);
    const whatsappUrl = `whatsapp://send?phone=${phoneNumber}`;
    Linking.openURL(whatsappUrl).catch(() => {
      Alert.alert('Error', 'WhatsApp is not installed');
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
        </TouchableOpacity>

        {/* Contact Name */}
        <Text style={[styles.contactName, { color: textColor, marginTop: 40, marginBottom: 2 }]} numberOfLines={1} ellipsizeMode="tail">
          {displayName}
        </Text>
        {call.contactName ? (
          <TouchableOpacity
            onLongPress={() => {
              Clipboard.setString(call.phoneNumber);
            }}
            activeOpacity={0.7}
          >
            <Text style={{ color: secondaryTextColor, fontSize: 13, textAlign: 'center', marginBottom: 16, writingDirection: 'ltr' }}>
              {call.phoneNumber}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={{ marginBottom: 16 }} />
        )}

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
            <Text style={[styles.actionLabel, { color: textColor }]} numberOfLines={1}>
              {isRTL ? 'رسالة' : 'Message'}
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
            <Text style={[styles.actionLabel, { color: textColor }]} numberOfLines={1}>{isRTL ? 'اتصال' : 'Call'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={handleWhatsApp}>
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
              <Icon name="logo-whatsapp" size={24} color={colors.primary} />
            </View>
            <Text style={[styles.actionLabel, { color: textColor }]} numberOfLines={1}>{isRTL ? 'واتساب' : 'WhatsApp'}</Text>
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
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[styles.historyType, { color: textColor }]}>
                    {getCallTypeLabel(historyCall.type)}
                  </Text>
                  {historyCall.simSlot != null && historyCall.simSlot >= 0 && (
                    <View style={{
                      backgroundColor: historyCall.simSlot === 0 ? '#007AFF' : '#FF9500',
                      borderRadius: 6,
                      minWidth: 16,
                      height: 16,
                      justifyContent: 'center',
                      alignItems: 'center',
                      marginLeft: 6,
                    }}>
                      <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '700' }}>
                        {historyCall.simSlot + 1}
                      </Text>
                    </View>
                  )}
                </View>
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


      </ScrollView>
    </Container>
  );
};

export default CallDetailScreen;
