import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';

interface Device {
  id: string;
  name: string;
  nickname?: string;
  type: string;
  platform: string;
  model: string;
  isOnline?: boolean;
}

interface DeviceFilterDropdownProps {
  devices: Device[];
  currentDevice: Device | null;
  selectedDeviceId: string | null;
  onSelectDevice: (deviceId: string | null) => void;
  isRTL: boolean;
  isDarkMode: boolean;
  colors: any;
}

const DeviceFilterDropdown: React.FC<DeviceFilterDropdownProps> = ({
  devices,
  currentDevice,
  selectedDeviceId,
  onSelectDevice,
  isRTL,
  isDarkMode,
  colors,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const textColor = colors.text;
  const secondaryTextColor = colors.textSecondary;

  // Filter to mobile/tablet only (exclude chrome extensions)
  const mobileDevices = useMemo(
    () =>
      devices.filter(d => {
        const platform = (d.platform || '').toLowerCase();
        const type = (d.type || '').toLowerCase();
        return !platform.includes('chrome') && type !== 'extension';
      }),
    [devices],
  );

  // Determine selected device info
  const selectedDevice = useMemo(() => {
    if (!selectedDeviceId) return currentDevice;
    return mobileDevices.find(d => d.id === selectedDeviceId) || currentDevice;
  }, [selectedDeviceId, mobileDevices, currentDevice]);

  const getDeviceIcon = (device: Device | null) => {
    if (!device) return 'phone-portrait-outline';
    const platform = (device.platform || device.type || '').toLowerCase();
    if (platform.includes('chrome')) return 'laptop-outline';
    if (platform.includes('ios') || platform.includes('iphone'))
      return 'phone-portrait-outline';
    return 'phone-portrait-outline';
  };

  const getDeviceLabel = (device: Device | null) => {
    if (!device) return 'Device';
    return device.nickname || device.name || device.model || 'Device';
  };

  // Don't render if only one mobile device (nothing to switch to)
  if (mobileDevices.length <= 1) return null;

  const selIcon = getDeviceIcon(selectedDevice);
  const selLabel = getDeviceLabel(selectedDevice);
  const selOnline = selectedDevice?.isOnline;

  return (
    <>
      {/* Trigger row */}
      <TouchableOpacity
        onPress={() => setDropdownOpen(true)}
        activeOpacity={0.8}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          marginHorizontal: 12,
          marginBottom: 8,
          paddingHorizontal: 12,
          paddingVertical: 9,
          borderRadius: 10,
          backgroundColor: isDarkMode
            ? 'rgba(255,255,255,0.07)'
            : 'rgba(0,0,0,0.05)',
          borderWidth: 1,
          borderColor: isDarkMode
            ? 'rgba(255,255,255,0.1)'
            : 'rgba(0,0,0,0.08)',
        }}
      >
        <View style={{ position: 'relative', marginRight: 8 }}>
          <Ionicons name={selIcon} size={16} color={colors.primary} />
          <View
            style={{
              position: 'absolute',
              bottom: -2,
              right: -3,
              width: 7,
              height: 7,
              borderRadius: 4,
              backgroundColor: selOnline ? '#22c55e' : '#9ca3af',
              borderWidth: 1,
              borderColor: isDarkMode ? '#1f2937' : '#ffffff',
            }}
          />
        </View>
        <Text
          style={{
            flex: 1,
            color: textColor,
            fontSize: 13,
            fontWeight: '600',
          }}
          numberOfLines={1}
        >
          {isRTL ? 'الجهاز: ' : 'Device: '}
          {selLabel}
        </Text>
        <Ionicons name="chevron-down" size={14} color={secondaryTextColor} />
      </TouchableOpacity>

      {/* Dropdown Modal */}
      <Modal
        visible={dropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDropdownOpen(false)}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
          activeOpacity={1}
          onPress={() => setDropdownOpen(false)}
        >
          <View
            style={{
              margin: 16,
              marginTop: 120,
              borderRadius: 14,
              backgroundColor: isDarkMode ? '#1e1e2e' : '#ffffff',
              overflow: 'hidden',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.25,
              shadowRadius: 12,
              elevation: 8,
            }}
          >
            {/* Header */}
            <View
              style={{
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: isDarkMode
                  ? 'rgba(255,255,255,0.08)'
                  : 'rgba(0,0,0,0.06)',
              }}
            >
              <Text
                style={{
                  color: secondaryTextColor,
                  fontSize: 12,
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {isRTL ? 'اختر الجهاز' : 'Select Device'}
              </Text>
            </View>

            {/* Device options */}
            {mobileDevices.map((device, idx) => {
              const isActive =
                device.id === (selectedDeviceId || currentDevice?.id);
              const isCurrent = device.id === currentDevice?.id;
              const icon = getDeviceIcon(device);
              const label = getDeviceLabel(device);

              return (
                <TouchableOpacity
                  key={device.id}
                  onPress={() => {
                    onSelectDevice(device.id);
                    setDropdownOpen(false);
                  }}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 16,
                    paddingVertical: 13,
                    backgroundColor: isActive
                      ? isDarkMode
                        ? 'rgba(99,102,241,0.15)'
                        : 'rgba(99,102,241,0.08)'
                      : 'transparent',
                    borderTopWidth: idx === 0 ? 0 : 1,
                    borderTopColor: isDarkMode
                      ? 'rgba(255,255,255,0.05)'
                      : 'rgba(0,0,0,0.04)',
                  }}
                >
                  <View style={{ position: 'relative', marginRight: 12 }}>
                    <Ionicons
                      name={icon}
                      size={18}
                      color={isActive ? colors.primary : secondaryTextColor}
                    />
                    <View
                      style={{
                        position: 'absolute',
                        bottom: -2,
                        right: -3,
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: device.isOnline
                          ? '#22c55e'
                          : '#9ca3af',
                        borderWidth: 1.5,
                        borderColor: isDarkMode ? '#1e1e2e' : '#ffffff',
                      }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: isActive ? colors.primary : textColor,
                        fontSize: 15,
                        fontWeight: isActive ? '700' : '400',
                      }}
                    >
                      {label}
                      {isCurrent
                        ? isRTL
                          ? ' (الحالي)'
                          : ' (Current)'
                        : ''}
                    </Text>
                  </View>
                  <Text
                    style={{
                      color: device.isOnline ? '#22c55e' : secondaryTextColor,
                      fontSize: 11,
                      fontWeight: '600',
                    }}
                  >
                    {device.isOnline
                      ? isRTL
                        ? 'متصل'
                        : 'Online'
                      : isRTL
                        ? 'غير متصل'
                        : 'Offline'}
                  </Text>
                  {isActive && (
                    <Ionicons
                      name="checkmark"
                      size={16}
                      color={colors.primary}
                      style={{ marginLeft: 8 }}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

export default DeviceFilterDropdown;
