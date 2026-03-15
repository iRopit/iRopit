/**
 * ConfirmDeleteBottomSheet Component
 * Professional bottom sheet for delete confirmation with icon
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Platform,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { BottomSheet } from '../layout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

interface ConfirmDeleteBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  isDark?: boolean;
  isRTL?: boolean;
  itemCount?: number;
}

const ConfirmDeleteBottomSheet: React.FC<ConfirmDeleteBottomSheetProps> = ({
  visible,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText,
  isDark = false,
  isRTL = false,
  itemCount = 1,
}) => {
  const bgColor = isDark ? '#1C1C1E' : '#FFFFFF';
  const textColor = isDark ? '#FFFFFF' : '#000000';
  const secondaryTextColor = isDark ? '#8E8E93' : '#6C6C70';
  const dangerColor = '#FF3B30';
  const cancelBgColor = isDark ? '#2C2C2E' : '#F2F2F7';
  const insets = useSafeAreaInsets();

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height={0.62}
      showHandle={true}
      showClose={false}
      isDark={isDark}
      style={{ backgroundColor: bgColor }}
    >
      <View
        style={[
          styles.container,
          { paddingBottom: Math.max(insets.bottom, 20) },
        ]}
      >
        {/* Icon */}
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: `${dangerColor}15` },
          ]}
        >
          <Ionicons name="trash-outline" size={48} color={dangerColor} />
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: textColor }]}>
          {title || (isRTL ? 'تأكيد الحذف' : 'Confirm Delete')}
        </Text>

        {/* Message */}
        <Text style={[styles.message, { color: secondaryTextColor }]}>
          {message ||
            (isRTL
              ? `هل أنت متأكد من حذف ${
                  itemCount > 1 ? `${itemCount} مكالمات` : 'هذه المكالمة'
                }؟`
              : `Are you sure you want to delete ${
                  itemCount > 1 ? `${itemCount} calls` : 'this call'
                }?`)}
        </Text>

        {/* Warning */}
        <View
          style={[
            styles.warningBox,
            { backgroundColor: isDark ? '#2C2C2E' : '#FFF9E6' },
          ]}
        >
          <Ionicons
            name="warning-outline"
            size={16}
            color={isDark ? '#FFB800' : '#F59E0B'}
            style={{ marginRight: isRTL ? 0 : 8, marginLeft: isRTL ? 8 : 0 }}
          />
          <Text
            style={[
              styles.warningText,
              { color: isDark ? '#FFB800' : '#F59E0B' },
            ]}
          >
            {isRTL
              ? 'لا يمكن التراجع عن هذا الإجراء'
              : 'This action cannot be undone'}
          </Text>
        </View>

        {/* Buttons */}
        <View style={styles.buttonsContainer}>
          <TouchableOpacity
            style={[
              styles.button,
              styles.cancelButton,
              { backgroundColor: cancelBgColor },
            ]}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={[styles.cancelButtonText, { color: textColor }]}>
              {cancelText || (isRTL ? 'إلغاء' : 'Cancel')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.button,
              styles.deleteButton,
              { backgroundColor: dangerColor },
            ]}
            onPress={handleConfirm}
            activeOpacity={0.8}
          >
            <Ionicons
              name="trash"
              size={18}
              color="#FFFFFF"
              style={{ marginRight: 6 }}
            />
            <Text style={styles.deleteButtonText}>
              {confirmText || (isRTL ? 'حذف' : 'Delete')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 20,
    width: '100%',
  },
  warningText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  buttonsContainer: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
    marginTop: 24,
  },
  button: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: 'transparent',
  },
  deleteButton: {
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  cancelButtonText: {
    fontSize: 17,
    fontWeight: '600',
  },
  deleteButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

export default ConfirmDeleteBottomSheet;
