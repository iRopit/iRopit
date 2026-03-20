import { Alert } from 'react-native';
import {
  ConfirmDeleteOptions,
  MuteAlertOptions,
  PermissionAlertOptions,
  MiuiPermissionAlertOptions,
  AlertButton,
} from './types';

/**
 * Generic Alert Service for consistent alerts across the app
 */
export class AlertService {
  /**
   * Show a confirmation dialog for delete operations
   */
  static confirmDelete(options: ConfirmDeleteOptions): void {
    const { onConfirm } = options;
    onConfirm();
  }

  /**
   * Show delete conversation confirmation
   */
  static confirmDeleteConversation(
    itemName: string,
    onConfirm: () => void | Promise<void>,
    isRTL: boolean = false,
  ): void {
    this.confirmDelete({
      title: isRTL ? 'حذف المحادثة' : 'Delete Conversation',
      message: isRTL
        ? `هل تريد حذف جميع الرسائل من ${itemName}?`
        : `Delete all messages from ${itemName}?`,
      onConfirm,
      isRTL,
    });
  }

  /**
   * Show delete selected items confirmation
   */
  static confirmDeleteSelected(
    count: number,
    onConfirm: () => void | Promise<void>,
    isRTL: boolean = false,
    itemType: string = 'conversations',
  ): void {
    const itemTypeAr =
      itemType === 'conversations'
        ? 'محادثة'
        : itemType === 'calls'
        ? 'مكالمة'
        : 'عنصر';

    this.confirmDelete({
      title: isRTL ? 'حذف العناصر المحددة' : 'Delete Selected Items',
      message: isRTL
        ? `هل أنت متأكد من حذف ${count} ${itemTypeAr}?`
        : `Are you sure you want to delete ${count} ${itemType}?`,
      onConfirm,
      isRTL,
    });
  }

  /**
   * Show mute notification alert
   */
  static showMuted(options: MuteAlertOptions): void {
    const { itemName, isRTL = false } = options;

    Alert.alert(
      isRTL ? 'تم الكتم' : 'Muted',
      isRTL
        ? `تم كتم الإشعارات من ${itemName}`
        : `Notifications from ${itemName} are now muted.`,
    );
  }

  /**
   * Show success alert
   */
  static showSuccess(
    title: string,
    message?: string,
    onPress?: () => void,
  ): void {
    Alert.alert(title, message, [{ text: 'OK', onPress }]);
  }

  /**
   * Show error alert
   */
  static showError(
    message: string,
    title: string = 'Error',
    isRTL: boolean = false,
  ): void {
    Alert.alert(isRTL ? 'خطأ' : title, message);
  }

  /**
   * Show permission request alert
   */
  static requestPermission(options: PermissionAlertOptions): void {
    const { title, message, onOpenSettings, cancelText, settingsText } =
      options;

    Alert.alert(title, message, [
      { text: cancelText || 'Cancel', style: 'cancel' },
      { text: settingsText || 'Open Settings', onPress: onOpenSettings },
    ]);
  }

  /**
   * Show MIUI-specific permission alert for Xiaomi devices
   */
  static requestMiuiPermission(options: MiuiPermissionAlertOptions): void {
    const { onAutoStartSettings, onNotificationSettings, laterText } = options;

    Alert.alert(
      'تفعيل خدمة الإشعارات المطلوبة',
      'أجهزة شاومي تحتاج إعدادات MIUI/ColorOS. يجب تفعيل "التشغيل التلقائي" (AutoStart) للسماح للتطبيق بالعمل بشكل صحيح.\n\nالخطوات المطلوبة:\n1. افتح إعدادات AutoStart\n2. ابحث عن iRopit\n3. فعّل التشغيل التلقائي\n4. ثم عد وفعّل خدمة الإشعارات',
      [
        { text: laterText || 'لاحقاً', style: 'cancel' },
        { text: 'إعدادات AutoStart', onPress: onAutoStartSettings },
        { text: 'إعدادات الإشعارات', onPress: onNotificationSettings },
      ],
    );
  }

  /**
   * Show standard notification permission alert
   */
  static requestNotificationPermission(onOpenSettings: () => void): void {
    this.requestPermission({
      title: 'Enable Notification Access',
      message: 'iRopit needs notification access to sync your messages.',
      onOpenSettings,
    });
  }

  /**
   * Show operation complete alert
   */
  static showOperationComplete(_isRTL: boolean = false, _message?: string): void {
    // No dialog shown
  }

  /**
   * Show custom alert with buttons
   */
  static show(title: string, message?: string, buttons?: AlertButton[]): void {
    Alert.alert(title, message, buttons);
  }
}
