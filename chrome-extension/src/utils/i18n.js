/**
 * Internationalization (i18n) module
 */

// Translation object
export const translations = {
  en: {
    nav_sms: "SMS",
    nav_calls: "Calls",
    nav_chat: "Chat",
    nav_notifications: "Notifications",
    nav_devices: "Devices",
    settings_title: "Settings",
    settings_language: "Language",
    settings_profile: "User Profile",
    settings_display_name: "Display Name",
    settings_enter_name: "Enter your name",
    settings_save: "Save",
    settings_email: "Email",
    settings_notifications: "Notifications",
    settings_sms_notif: "SMS Notifications",
    settings_call_notif: "Call Notifications",
    settings_sound: "Sound Alerts",
    settings_account: "Account",
    settings_change_password: "Change Password",
    settings_delete_account: "Delete Account",
    settings_about: "About",
    settings_tagline: "Sync your SMS and calls across all devices",
    settings_smart_actions: "Premium Actions",
    settings_auto_copy_otp: "Copy OTP from SMS automatically",
    settings_auto_copy_otp_desc: "Automatically detect and copy OTP codes from received SMS messages.",
    settings_auto_copy_otp_email: "Copy OTP from email automatically",
    settings_auto_copy_otp_email_desc: "Automatically detect and copy OTP codes from received email notifications.",
    settings_auto_open_images: "Open received images automatically",
    settings_auto_open_images_desc: "Automatically open received images in the Chrome extension.",
    settings_auto_open_url: "Open received URLs automatically",
    settings_auto_open_url_desc: "Automatically open received links in a new browser tab.",
    settings_universal_copy: "Universal Copy",
    settings_universal_copy_desc: "Copy text from mobile and make it instantly available on desktop.",
    settings_incoming_call_popup: "Show Incoming Call Popup",
    settings_incoming_call_popup_desc: "Display a popup window in Chrome when an incoming call is received on your mobile device.",
    settings_outgoing_call_popup: "Show Outgoing Call Popup",
    settings_outgoing_call_popup_desc: "Display a popup window in Chrome when you start an outgoing call from your mobile device.",
    select_all: "Select All",
    search_messages: "Search messages...",
    search_calls: "Search calls...",
    search_notifications: "Search notifications...",
    section_messages: "Messages",
    section_call_history: "Call History",
    section_notifications: "Notifications",
    new_sms: "New SMS",
    empty_messages: "No messages yet",
    empty_messages_sub: "Messages from your phone will appear here",
    syncing_messages: "Syncing messages from your phone…",
    empty_calls: "No calls yet",
    empty_calls_sub: "Call history from your phone will appear here",
    syncing_calls: "Syncing calls from your phone…",
    empty_notifications: "No notifications yet",
    empty_notifications_sub: "Notifications from your phone will appear here",
    tooltip_toggle_theme: "Toggle dark mode",
    tooltip_toggle_language: "Switch to Arabic",
    tooltip_refresh: "Refresh",
    tooltip_settings: "Settings",
    tooltip_select_messages: "Select messages",
    tooltip_mark_all_read: "Mark all as read",
    tooltip_delete_selected: "Delete selected",
    tooltip_export_sms: "Export SMS to CSV",
    tooltip_select_calls: "Select calls",
    tooltip_mark_all_viewed: "Mark all as viewed",
    tooltip_export_calls: "Export calls to CSV",
    tooltip_select_notif: "Select notifications",
    tooltip_mark_notif_read: "Mark all as read",
    tooltip_export_notif: "Export Notifications to CSV",
    tooltip_export_insights_summary: "Export SMS & Calls to Excel",
    tooltip_export_insights_spending: "Export spending data to CSV",
    tooltip_delete_device: "Delete device",
    tooltip_back: "Back",
    tooltip_send_image: "Send Image",
    tooltip_send_file: "Send File",
    tooltip_logout: "Logout",
    tooltip_toggle_profile: "Toggle Profile",
    sms_modal_title: "Send SMS",
    sms_label_device: "Send from device",
    sms_select_device: "Select device...",
    sms_contacts_label: "Select from contacts",
    sms_label_phone: "Phone number",
    sms_placeholder_phone: "+1234567890",
    sms_label_message: "Message",
    sms_placeholder_message: "Type your message...",
    sms_btn_cancel: "Cancel",
    sms_btn_send: "Send SMS",
    nav_dashboard: "Insights",
    dash_title: "Insights",
    dash_from: "From",
    dash_to: "To",
    dash_apply: "Apply",
    dash_reset: "Reset",
    common_loading: "Loading...",
    dash_sms: "SMS",
    dash_calls: "Calls",
    dash_notifications: "Notifications",
    dash_export_summary: "Export SMS & Calls",
    dash_export_spending: "Export Spending",
    dash_insights_title: "SMS Spending Insights",
    dash_insights_empty_filter: "Apply a date filter to see spending analysis",
    dash_insights_no_sms: "No SMS data in selected range",
    dash_insights_no_financial: "No financial SMS detected in selected range",
    dash_insights_all_devices: "All Devices",
    dash_spent: "Spent",
    dash_received: "Received",
    dash_net: "Net",
    dash_spending_by_date: "Spending by Date",
    dash_notif_by_date: "Notifications by Date",
    dash_select_range: "Select a date range and apply filter",
    dash_no_data: "No data found for selected range",
  },
  ar: {
    nav_sms: "الرسائل",
    nav_calls: "المكالمات",
    nav_chat: "المحادثة",
    nav_notifications: "الإشعارات",
    nav_devices: "الأجهزة",
    settings_title: "الإعدادات",
    settings_language: "اللغة / Language",
    settings_profile: "الملف الشخصي",
    settings_display_name: "الاسم المعروض",
    settings_enter_name: "أدخل اسمك",
    settings_save: "حفظ",
    settings_email: "البريد الإلكتروني",
    settings_notifications: "الإشعارات",
    settings_sms_notif: "إشعارات الرسائل",
    settings_call_notif: "إشعارات المكالمات",
    settings_sound: "التنبيهات الصوتية",
    settings_account: "الحساب",
    settings_change_password: "تغيير كلمة المرور",
    settings_delete_account: "حذف الحساب",
    settings_about: "حول التطبيق",
    settings_tagline: "مزامنة الرسائل والمكالمات عبر جميع الأجهزة",
    settings_smart_actions: "الإجراءات المميزة",
    settings_auto_copy_otp: "نسخ OTP من الرسائل تلقائيًا",
    settings_auto_copy_otp_desc: "الكشف التلقائي عن رموز OTP في الرسائل الواردة ونسخها.",
    settings_auto_copy_otp_email: "نسخ OTP من البريد الإلكتروني تلقائيًا",
    settings_auto_copy_otp_email_desc: "الكشف التلقائي عن رموز OTP في إشعارات البريد الإلكتروني الواردة ونسخها.",
    settings_auto_open_images: "فتح الصور الواردة تلقائيًا",
    settings_auto_open_images_desc: "فتح الرسائل النصية الواردة تلقائيًا في إضافة Chrome.",
    settings_auto_open_url: "فتح الروابط الواردة تلقائيًا",
    settings_auto_open_url_desc: "فتح الروابط الواردة تلقائيًا في تبويب جديد.",
    settings_universal_copy: "النسخ الشامل",
    settings_universal_copy_desc: "انسخ نصًا من الهاتف واجعله متاحًا فورًا على سطح المكتب.",
    settings_incoming_call_popup: "عرض نافذة المكالمة الواردة",
    settings_incoming_call_popup_desc: "عرض نافذة منبثقة في Chrome عند استقبال مكالمة واردة على جهازك المحمول.",
    settings_outgoing_call_popup: "عرض نافذة المكالمة الصادرة",
    settings_outgoing_call_popup_desc: "عرض نافذة منبثقة في Chrome عند بدء مكالمة صادرة من جهازك المحمول.",
    select_all: "تحديد الكل",
    search_messages: "...بحث في الرسائل",
    search_calls: "...بحث في المكالمات",
    search_notifications: "...بحث في الإشعارات",
    section_messages: "الرسائل",
    section_call_history: "سجل المكالمات",
    section_notifications: "الإشعارات",
    new_sms: "رسالة جديدة",
    empty_messages: "لا توجد رسائل بعد",
    empty_messages_sub: "ستظهر رسائل هاتفك هنا",
    syncing_messages: "جارٍ مزامنة الرسائل من هاتفك…",
    empty_calls: "لا توجد مكالمات بعد",
    empty_calls_sub: "سيظهر سجل مكالمات هاتفك هنا",
    syncing_calls: "جارٍ مزامنة المكالمات من هاتفك…",
    empty_notifications: "لا توجد إشعارات بعد",
    empty_notifications_sub: "ستظهر إشعارات هاتفك هنا",
    tooltip_toggle_theme: "تبديل الوضع الليلي",
    tooltip_toggle_language: "التبديل إلى الإنجليزية",
    tooltip_refresh: "تحديث",
    tooltip_settings: "الإعدادات",
    tooltip_select_messages: "تحديد الرسائل",
    tooltip_mark_all_read: "تعليم الكل كمقروء",
    tooltip_delete_selected: "حذف المحدد",
    tooltip_export_sms: "تصدير الرسائل",
    tooltip_select_calls: "تحديد المكالمات",
    tooltip_mark_all_viewed: "تعليم الكل كمشاهد",
    tooltip_export_calls: "تصدير المكالمات",
    tooltip_select_notif: "تحديد الإشعارات",
    tooltip_mark_notif_read: "تعليم الكل كمقروء",
    tooltip_export_notif: "تصدير الإشعارات",
    tooltip_export_insights_summary: "تصدير الرسائل والمكالمات إلى Excel",
    tooltip_export_insights_spending: "تصدير بيانات الإنفاق",
    tooltip_delete_device: "حذف الجهاز",
    tooltip_back: "رجوع",
    tooltip_send_image: "إرسال صورة",
    tooltip_send_file: "إرسال ملف",
    tooltip_logout: "تسجيل الخروج",
    tooltip_toggle_profile: "عرض الملف الشخصي",
    sms_modal_title: "إرسال رسالة",
    sms_label_device: "إرسال من جهاز",
    sms_select_device: "اختر جهاز...",
    sms_contacts_label: "اختر من جهات الاتصال",
    sms_label_phone: "رقم الهاتف",
    sms_placeholder_phone: "+1234567890",
    sms_label_message: "الرسالة",
    sms_placeholder_message: "...اكتب رسالتك",
    sms_btn_cancel: "إلغاء",
    sms_btn_send: "إرسال رسالة",
    nav_dashboard: "الإحصائيات",
    dash_title: "الإحصائيات",
    dash_from: "من",
    dash_to: "إلى",
    dash_apply: "تطبيق",
    dash_reset: "إعادة تعيين",
    common_loading: "جارٍ التحميل...",
    dash_sms: "الرسائل",
    dash_calls: "المكالمات",
    dash_notifications: "الإشعارات",
    dash_export_summary: "تصدير الرسائل والمكالمات",
    dash_export_spending: "تصدير الإنفاق",
    dash_insights_title: "تحليل الإنفاق من الرسائل",
    dash_insights_empty_filter: "طبّق فلتر التاريخ لعرض تحليل الإنفاق",
    dash_insights_no_sms: "لا توجد رسائل في النطاق المحدد",
    dash_insights_no_financial: "لم يتم اكتشاف رسائل مالية في النطاق المحدد",
    dash_insights_all_devices: "كل الأجهزة",
    dash_spent: "المصروف",
    dash_received: "المستلم",
    dash_net: "الصافي",
    dash_spending_by_date: "الإنفاق حسب التاريخ",
    dash_notif_by_date: "الإشعارات حسب التاريخ",
    dash_select_range: "اختر نطاق تاريخ وطبّق الفلتر",
    dash_no_data: "لا توجد بيانات في النطاق المحدد",
  },
}

// Get current language from localStorage
let currentLanguage = localStorage.getItem("appLanguage") || "en"

/**
 * Get current language
 * @returns {string} Current language code
 */
export function getCurrentLanguage() {
  return currentLanguage
}

/**
 * Set current language
 * @param {string} lang - Language code
 */
export function setCurrentLanguage(lang) {
  currentLanguage = lang
  localStorage.setItem("appLanguage", lang)
}

/**
 * Apply translations to DOM elements
 */
export function applyTranslations() {
  const trans = translations[currentLanguage]

  document.querySelectorAll("[data-i18n]").forEach((elem) => {
    const key = elem.getAttribute("data-i18n")
    if (trans[key]) {
      elem.textContent = trans[key]
    }
  })

  document.querySelectorAll("[data-i18n-placeholder]").forEach((elem) => {
    const key = elem.getAttribute("data-i18n-placeholder")
    if (trans[key]) {
      elem.placeholder = trans[key]
    }
  })

  document.querySelectorAll("[data-i18n-title]").forEach((elem) => {
    const key = elem.getAttribute("data-i18n-title")
    if (trans[key]) {
      elem.title = trans[key]
    }
  })

  // Update direction
  document.body.setAttribute("dir", currentLanguage === "ar" ? "rtl" : "ltr")
}
