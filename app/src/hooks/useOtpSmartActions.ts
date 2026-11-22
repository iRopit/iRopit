import { useEffect, useRef } from 'react';
import { Platform, ToastAndroid } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import notificationService from '../services/notificationService';
import {
  buildOtpSourceFromNotification,
  extractOtpCode,
  isLikelyEmailNotification,
} from '../utils/otp';

const OTP_DEDUPE_WINDOW_MS = 30 * 1000;
const OTP_DEDUPE_MAX_KEYS = 300;

function pruneRecentKeys(map: Map<string, number>, now: number) {
  for (const [key, ts] of map) {
    if (now - ts > OTP_DEDUPE_WINDOW_MS) {
      map.delete(key);
    }
  }
  if (map.size <= OTP_DEDUPE_MAX_KEYS) return;
  const ordered = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  map.clear();
  ordered.slice(0, OTP_DEDUPE_MAX_KEYS).forEach(([key, ts]) => map.set(key, ts));
}

export const useOtpSmartActions = () => {
  const recentHandledRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const unsubscribe = notificationService.onNotificationReceived(raw => {
      const notification = (raw || {}) as Record<string, any>;

      const smsType = String(notification.smsType || '').toLowerCase();
      const direction = String(notification.direction || '').toLowerCase();
      if (smsType === 'sent' || direction === 'outgoing') {
        return;
      }

      const source = buildOtpSourceFromNotification(notification);
      const otp = extractOtpCode(source);
      if (!otp) return;

      const ts = Number(notification.timestamp || Date.now());
      const minuteBucket = Math.floor(ts / (60 * 1000));
      const dedupeKey = `${otp}|${notification.packageName || ''}|${minuteBucket}`;
      const now = Date.now();
      pruneRecentKeys(recentHandledRef.current, now);
      if (recentHandledRef.current.has(dedupeKey)) return;
      recentHandledRef.current.set(dedupeKey, now);

      Clipboard.setString(otp);
      const prefix = isLikelyEmailNotification(notification) ? 'Email OTP' : 'SMS OTP';
      ToastAndroid.show(`${prefix} copied: ${otp}`, ToastAndroid.SHORT);
    });

    return () => {
      unsubscribe();
      recentHandledRef.current.clear();
    };
  }, []);
};

export default useOtpSmartActions;
