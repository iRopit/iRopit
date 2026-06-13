import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { Permission } from '../types';

interface PermissionsStepProps {
  permissions: Permission[];
  isRTL: boolean;
  actualTheme: 'light' | 'dark';
  colors: {
    text: string;
    textSecondary: string;
    surface: string;
    surfaceSecondary: string;
    border: string;
    primary: string;
    success: string;
    error: string;
  };
  translate: (key: string) => string;
  onRequestPermission: (permissionId: string) => void;
  onRequestAllPermissions: () => Promise<void>;
}

const PermissionsStep: React.FC<PermissionsStepProps> = ({
  permissions,
  isRTL,
  actualTheme,
  colors,
  translate,
  onRequestPermission,
  onRequestAllPermissions,
}) => {
  const [grantingAll, setGrantingAll] = React.useState(false);
  const isDark = actualTheme === 'dark';
  const allGranted = permissions.every(p => p.granted);
  const anyUngranted = permissions.some(p => !p.granted);

  const handleGrantAll = async () => {
    setGrantingAll(true);
    try {
      await onRequestAllPermissions();
    } finally {
      setGrantingAll(false);
    }
  };

  return (
    <ScrollView
      style={localStyles.container}
      contentContainerStyle={localStyles.contentContainer}
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      {/* Title Section */}
      <View style={localStyles.titleSection}>
        <Text style={[localStyles.title, { color: colors.text }]}>
          {translate('onboarding.permissions.title')}
        </Text>
        <Text style={[localStyles.subtitle, { color: colors.textSecondary }]}>
          {translate('onboarding.permissions.subtitle')}
        </Text>
      </View>

      {/* Grant All Button */}
      {anyUngranted && !allGranted && (
        <TouchableOpacity
          style={[
            localStyles.grantAllButton,
            { backgroundColor: colors.primary, opacity: grantingAll ? 0.7 : 1 },
          ]}
          onPress={handleGrantAll}
          disabled={grantingAll}
          activeOpacity={0.8}
        >
          <Icon
            name="shield-checkmark-outline"
            size={20}
            color={isDark ? colors.black : '#FFF'}
          />
          <Text style={[localStyles.grantAllText, { color: isDark ? colors.black : '#FFF' }]}>
            {grantingAll
              ? (isRTL ? 'جاري المنح...' : 'Granting...')
              : (isRTL ? 'منح جميع الأذونات' : 'Grant All Permissions')}
          </Text>
        </TouchableOpacity>
      )}

      {/* Permissions List */}
      <View style={localStyles.permissionsList}>
        {permissions.map(permission => {
          const isGranted = permission.granted;
          return (
            <View
              key={permission.id}
              style={[
                localStyles.permissionCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: isGranted ? colors.success : colors.border,
                },
              ]}
            >
              {/* Icon */}
              <View
                style={[
                  localStyles.iconContainer,
                  {
                    backgroundColor: isGranted
                      ? `${colors.success}20`
                      : `${colors.primary}15`,
                  },
                ]}
              >
                <Icon
                  name={isGranted ? 'checkmark-circle' : permission.icon}
                  size={28}
                  color={isGranted ? colors.success : colors.primary}
                />
              </View>

              {/* Info */}
              <View style={localStyles.infoContainer}>
                <Text
                  style={[localStyles.permissionName, { color: colors.text }]}
                >
                  {isRTL ? permission.nameAr : permission.name}
                  {permission.required && (
                    <Text style={{ color: colors.error }}> *</Text>
                  )}
                </Text>
                <Text
                  style={[
                    localStyles.permissionDesc,
                    { color: colors.textSecondary },
                  ]}
                >
                  {isRTL ? permission.descriptionAr : permission.description}
                </Text>
              </View>

              {/* Action Button */}
              {isGranted ? (
                <View
                  style={[
                    localStyles.grantedBadge,
                    { backgroundColor: colors.success },
                  ]}
                >
                  <Icon name="checkmark" size={18} color="#FFF" />
                </View>
              ) : (
                <TouchableOpacity
                  style={[
                    localStyles.grantButton,
                    { backgroundColor: colors.primary },
                  ]}
                  onPress={() => onRequestPermission(permission.id)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      localStyles.grantButtonText,
                      { color: isDark ? colors.black : colors.text },
                    ]}
                  >
                    {translate('onboarding.permissions.grant')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>

      {/* Info Note */}
      <View
        style={[
          localStyles.infoNote,
          { backgroundColor: `${colors.primary}10` },
        ]}
      >
        <Icon
          name="information-circle-outline"
          size={20}
          color={colors.primary}
        />
        <Text
          style={[localStyles.infoNoteText, { color: colors.textSecondary }]}
        >
          {isRTL
            ? 'يمكنك تغيير هذه الأذونات لاحقاً من الإعدادات'
            : 'You can change these permissions later in Settings'}
        </Text>
      </View>
    </ScrollView>
  );
};

const localStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  titleSection: {
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  grantAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    marginBottom: 16,
  },
  grantAllText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  permissionsList: {
    gap: 10,
  },
  permissionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoContainer: {
    flex: 1,
    marginHorizontal: 12,
  },
  permissionName: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  permissionDesc: {
    fontSize: 12,
    lineHeight: 16,
    opacity: 0.8,
  },
  grantedBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grantButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  grantButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  infoNote: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginTop: 14,
    gap: 10,
  },
  infoNoteText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});

export default PermissionsStep;
