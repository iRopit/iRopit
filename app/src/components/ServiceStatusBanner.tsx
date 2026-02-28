import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  NativeModules,
  AppState,
  AppStateStatus,
  PermissionsAndroid,
  Platform,
  Linking,
  Modal,
  Dimensions,
  Animated,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

const { NotificationModule } = NativeModules;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface PermissionStatus {
  notificationListener: boolean;
  notificationListenerConnected: boolean;
  contacts: boolean;
  notificationsMuted: boolean;
  mutedChannels: string[];
}

interface ServiceStatusBannerProps {
  onDismiss?: () => void;
}

const ServiceStatusBanner: React.FC<ServiceStatusBannerProps> = ({
  onDismiss,
}) => {
  const [permissions, setPermissions] = useState<PermissionStatus>({
    notificationListener: false,
    notificationListenerConnected: false,
    contacts: false,
    notificationsMuted: false,
    mutedChannels: [],
  });
  const [currentIssueIndex, setCurrentIssueIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const checkCountRef = useRef(0);

  const checkAllPermissions = useCallback(async () => {
    try {
      const newPermissions: PermissionStatus = {
        notificationListener: false,
        notificationListenerConnected: false,
        contacts: false,
        notificationsMuted: false,
        mutedChannels: [],
      };

      // Check Notification Listener
      if (NotificationModule) {
        try {
          newPermissions.notificationListener =
            await NotificationModule.isPermissionGranted();
          newPermissions.notificationListenerConnected =
            await NotificationModule.isServiceConnected();
        } catch (e) {}
      }

      // Check Contacts permission (only permission we need now)
      if (Platform.OS === 'android') {
        const contacts = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
        );
        newPermissions.contacts = contacts;

        // Check if app notifications are enabled
        if (NotificationModule?.areNotificationsEnabled) {
          try {
            const enabled = await NotificationModule.areNotificationsEnabled();
            newPermissions.notificationsMuted = !enabled;
          } catch (e) {}
        }

        // Check if critical channels are blocked
        if (NotificationModule?.getMutedChannels) {
          try {
            const mutedStr: string =
              await NotificationModule.getMutedChannels();
            newPermissions.mutedChannels = mutedStr ? mutedStr.split(',') : [];
          } catch (e) {}
        }
      }

      setPermissions(newPermissions);

      // If all permissions granted, close modal
      const allGranted =
        newPermissions.notificationListener &&
        newPermissions.notificationListenerConnected &&
        newPermissions.contacts &&
        !newPermissions.notificationsMuted &&
        newPermissions.mutedChannels.length === 0;

      if (allGranted) {
        setModalVisible(false);
        setDismissed(true);
      }
    } catch (error) {
      console.error('Error checking permissions:', error);
    }
  }, []);

  useEffect(() => {
    const initialChecks = async () => {
      for (let i = 0; i < 3; i++) {
        await checkAllPermissions();
        checkCountRef.current = i + 1;

        const permState = await (async () => {
          if (NotificationModule) {
            try {
              return await NotificationModule.isServiceConnected();
            } catch {
              return false;
            }
          }
          return false;
        })();

        if (permState) {
          setIsReady(true);
          return;
        }

        if (i < 2) {
          await new Promise<void>(resolve => setTimeout(resolve, 1000));
        }
      }
      setIsReady(true);
    };

    initialChecks();

    const subscription = AppState.addEventListener(
      'change',
      (state: AppStateStatus) => {
        if (state === 'active') {
          checkAllPermissions();
        }
      },
    );

    const interval = setInterval(checkAllPermissions, 10000);

    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [checkAllPermissions]);

  // Get list of issues
  const getIssues = useCallback(() => {
    const issues: Array<{
      id: string;
      icon: string;
      title: string;
      message: string;
      action: () => void;
      actionText: string;
      color: string;
      priority: number;
    }> = [];

    // Priority 1: Notification Listener not enabled (MOST IMPORTANT)
    if (!permissions.notificationListener) {
      issues.push({
        id: 'notification_listener',
        icon: 'notifications-off-outline',
        title: 'إذن الإشعارات غير مُفعّل',
        message: 'مطلوب لاستقبال الرسائل والمكالمات من جميع التطبيقات',
        action: async () => {
          try {
            if (NotificationModule) {
              await NotificationModule.openSettings();
            }
          } catch (e) {
            console.error('Error opening notification settings:', e);
          }
        },
        actionText: 'تفعيل الإذن',
        color: '#E74C3C',
        priority: 1,
      });
    }
    // Priority 2: Notification Listener enabled but not connected
    else if (!permissions.notificationListenerConnected) {
      issues.push({
        id: 'notification_disconnected',
        icon: 'cloud-offline-outline',
        title: 'خدمة الإشعارات غير متصلة',
        message:
          'إذا كان جهازك Xiaomi/Redmi:\n1. افتح إعدادات AutoStart\n2. فعّل iRopit\n3. أعد تشغيل الهاتف',
        action: async () => {
          try {
            if (NotificationModule?.openAutoStartSettings) {
              await NotificationModule.openAutoStartSettings();
            } else if (NotificationModule) {
              await NotificationModule.openSettings();
            }
          } catch (e) {
            console.error('Error opening settings:', e);
          }
        },
        actionText: 'إعدادات AutoStart',
        color: '#F39C12',
        priority: 2,
      });
    }

    // Priority 3: App notifications muted
    if (permissions.notificationsMuted) {
      issues.push({
        id: 'notifications_muted',
        icon: 'volume-mute-outline',
        title: 'إشعارات التطبيق مُعطّلة',
        message:
          'قمت بإيقاف إشعارات التطبيق من إعدادات الجهاز. لن تصلك أي إشعارات حتى يتم تفعيلها',
        action: async () => {
          try {
            if (NotificationModule?.openAppNotificationSettings) {
              await NotificationModule.openAppNotificationSettings();
            } else {
              Linking.openSettings();
            }
            setTimeout(checkAllPermissions, 2000);
          } catch (e) {
            Linking.openSettings();
          }
        },
        actionText: 'تفعيل الإشعارات',
        color: '#E74C3C',
        priority: 3,
      });
    }

    // Priority 4: Specific channels muted
    if (
      permissions.mutedChannels.length > 0 &&
      !permissions.notificationsMuted
    ) {
      const channelNames = permissions.mutedChannels.join(' و ');
      issues.push({
        id: 'channels_muted',
        icon: 'notifications-off-outline',
        title: `إشعارات ${channelNames} مُعطّلة`,
        message: `قمت بكتم إشعارات ${channelNames}. لن تصلك تنبيهات هذه الأنواع`,
        action: async () => {
          try {
            if (NotificationModule?.openAppNotificationSettings) {
              await NotificationModule.openAppNotificationSettings();
            } else {
              Linking.openSettings();
            }
            setTimeout(checkAllPermissions, 2000);
          } catch (e) {
            Linking.openSettings();
          }
        },
        actionText: 'إعدادات الإشعارات',
        color: '#F39C12',
        priority: 4,
      });
    }

    // Priority 5: Contacts permissions (optional but helpful)
    if (!permissions.contacts) {
      issues.push({
        id: 'contacts',
        icon: 'people-outline',
        title: 'إذن جهات الاتصال',
        message: 'مطلوب لعرض أسماء المتصلين بدلاً من الأرقام',
        action: async () => {
          try {
            const granted = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
            );
            if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
              Linking.openSettings();
            }
            checkAllPermissions();
          } catch (e) {
            console.error('Error requesting contacts permission:', e);
          }
        },
        actionText: 'منح الإذن',
        color: '#1ABC9C',
        priority: 5,
      });
    }

    return issues.sort((a, b) => a.priority - b.priority);
  }, [permissions, checkAllPermissions]);

  const issues = getIssues();

  useEffect(() => {
    if (
      issues.some(
        i =>
          i.id === 'notification_listener' ||
          i.id === 'notification_disconnected' ||
          i.id === 'notifications_muted',
      )
    ) {
      setDismissed(false);
    }

    if (isReady && issues.length > 0 && !dismissed) {
      setModalVisible(true);
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }).start();
    }
  }, [isReady, issues, dismissed, scaleAnim]);

  const handleDismiss = () => {
    Animated.timing(scaleAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setModalVisible(false);
      setDismissed(true);
      onDismiss?.();
    });
  };

  const handleNext = () => {
    if (currentIssueIndex < issues.length - 1) {
      setCurrentIssueIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIssueIndex > 0) {
      setCurrentIssueIndex(prev => prev - 1);
    }
  };

  if (!isReady || issues.length === 0 || !modalVisible) {
    return null;
  }

  const currentIssue = issues[Math.min(currentIssueIndex, issues.length - 1)];

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleDismiss}
    >
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.modalContainer,
            {
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          {/* Header with icon */}
          <View
            style={[styles.header, { backgroundColor: currentIssue.color }]}
          >
            <View style={styles.headerIcon}>
              <Icon name={currentIssue.icon} size={40} color="#FFFFFF" />
            </View>
            <Text style={styles.headerTitle}>تنبيه</Text>
            {issues.length > 1 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{issues.length}</Text>
              </View>
            )}
          </View>

          {/* Content */}
          <View style={styles.content}>
            <Text style={styles.title}>{currentIssue.title}</Text>
            <Text style={styles.message}>{currentIssue.message}</Text>

            {/* Progress indicator */}
            {issues.length > 1 && (
              <View style={styles.progressContainer}>
                <Text style={styles.progressText}>
                  {currentIssueIndex + 1} من {issues.length}
                </Text>
                <View style={styles.dotsContainer}>
                  {issues.map((_, index) => (
                    <View
                      key={index}
                      style={[
                        styles.dot,
                        {
                          backgroundColor:
                            index === currentIssueIndex
                              ? currentIssue.color
                              : '#E0E0E0',
                        },
                      ]}
                    />
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* Buttons */}
          <View style={styles.buttonsContainer}>
            {/* Navigation buttons for multiple issues */}
            {issues.length > 1 && (
              <View style={styles.navButtons}>
                <TouchableOpacity
                  style={[
                    styles.navButton,
                    currentIssueIndex === 0 && styles.navButtonDisabled,
                  ]}
                  onPress={handlePrev}
                  disabled={currentIssueIndex === 0}
                >
                  <Icon
                    name="chevron-forward"
                    size={20}
                    color={currentIssueIndex === 0 ? '#CCC' : '#666'}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.navButton,
                    currentIssueIndex === issues.length - 1 &&
                      styles.navButtonDisabled,
                  ]}
                  onPress={handleNext}
                  disabled={currentIssueIndex === issues.length - 1}
                >
                  <Icon
                    name="chevron-back"
                    size={20}
                    color={
                      currentIssueIndex === issues.length - 1 ? '#CCC' : '#666'
                    }
                  />
                </TouchableOpacity>
              </View>
            )}

            {/* Action button */}
            <TouchableOpacity
              style={[
                styles.actionButton,
                { backgroundColor: currentIssue.color },
              ]}
              onPress={currentIssue.action}
              activeOpacity={0.8}
            >
              <Icon
                name="settings-outline"
                size={18}
                color="#FFF"
                style={styles.actionIcon}
              />
              <Text style={styles.actionText}>{currentIssue.actionText}</Text>
            </TouchableOpacity>

            {/* Dismiss button */}
            <TouchableOpacity
              style={styles.dismissButton}
              onPress={handleDismiss}
              activeOpacity={0.7}
            >
              <Text style={styles.dismissText}>لاحقاً</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    width: SCREEN_WIDTH - 40,
    maxWidth: 400,
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
  },
  header: {
    paddingVertical: 24,
    alignItems: 'center',
    position: 'relative',
  },
  headerIcon: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  badge: {
    position: 'absolute',
    top: 16,
    left: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  content: {
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
  },
  progressContainer: {
    marginTop: 16,
    alignItems: 'center',
  },
  progressText: {
    fontSize: 12,
    color: '#999',
    marginBottom: 8,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 4,
  },
  buttonsContainer: {
    padding: 16,
    paddingTop: 0,
  },
  navButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 12,
  },
  navButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 8,
  },
  navButtonDisabled: {
    opacity: 0.5,
  },
  actionButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  actionIcon: {
    marginRight: 8,
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  dismissButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  dismissText: {
    color: '#999',
    fontSize: 14,
    fontWeight: '500',
  },
});

export default ServiceStatusBanner;
