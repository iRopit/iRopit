import { useEffect, useCallback, useState, useMemo, useRef } from 'react';
import { Platform, NativeModules } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../../types';
import { useTheme } from '../../../contexts/ThemeContext';
import { AlertService } from '../../../components/shared';
import { GroupedCall } from './types';
import { useCallStore } from '../../../store';
import { useDeviceStore } from '../../../store/deviceStore';
import { useDeviceFilterStore } from '../../../store/deviceFilterStore';
import useNativeEvents from '../../../hooks';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

/**
 * Custom hook to separate business logic from UI in CallsScreen
 */
export const useCallsScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const {
    calls,
    isLoading,
    isSyncing,
    loadCalls,
    clearAllCalls,
    deleteCallsByPhoneNumbers,
    syncCalls,
  } = useCallStore();
  const { requestPermissions } = useNativeEvents();
  const { currentDevice, devices, loadDevices } = useDeviceStore();
  const { isRTL, isDarkMode, colors } = useTheme();

  // Persist selected device so leaving/returning to the tab keeps the same filter.
  const selectedDeviceId = useDeviceFilterStore(state => state.callsDeviceId);
  const setSelectedDeviceId = useDeviceFilterStore(state => state.setCallsDeviceId);
  const activeDeviceId = selectedDeviceId || currentDevice?.id || null;

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedCalls, setSelectedCalls] = useState<string[]>([]);
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    'single' | 'selected' | 'all' | null
  >(null);
  const [singleDeleteItem, setSingleDeleteItem] = useState<GroupedCall | null>(
    null,
  );

  // Theme colors - use canonical theme tokens
  const bgColor = colors.background;
  const textColor = colors.text;
  const secondaryTextColor = colors.textSecondary;
  const surfaceColor = isDarkMode ? colors.surface : colors.surfaceSecondary;
  const avatarBgColor = isDarkMode
    ? colors.surfaceSecondary
    : colors.surfaceTertiary;

  // Initialize call listener
  const initializeCallListener = useCallback(async () => {
    // Attach the Firestore listener first so selected-device calls appear
    // immediately; do not block on native top-up sync.
    loadCalls(activeDeviceId || undefined);

    if (Platform.OS === 'android') {
      await requestPermissions();

      // Lightweight top-up sync to avoid stale Calls tab when a realtime
      // write/event is missed while app was backgrounded.
      try {
        // Native call log is only for the current physical device; skip this
        // when viewing another selected device to avoid unrelated delay.
        if (!activeDeviceId || activeDeviceId === currentDevice?.id) {
          const { CallLogModule } = NativeModules;
          const recentNativeCalls = (await CallLogModule?.getCallLog?.(300)) || [];
          if (recentNativeCalls.length > 0) {
            await syncCalls(recentNativeCalls);
          }
        }
      } catch (_) {}
    }
  }, [requestPermissions, loadCalls, activeDeviceId, syncCalls, currentDevice?.id]);

  const refreshCalls = useCallback(async () => {
    // Refresh selected-device listener immediately.
    loadCalls(activeDeviceId || undefined);

    if (Platform.OS === 'android') {
      try {
        if (!activeDeviceId || activeDeviceId === currentDevice?.id) {
          const { CallLogModule } = NativeModules;
          const recentNativeCalls = (await CallLogModule?.getCallLog?.(300)) || [];
          if (recentNativeCalls.length > 0) {
            await syncCalls(recentNativeCalls);
          }
        }
      } catch (_) {}
    }
  }, [loadCalls, activeDeviceId, syncCalls, currentDevice?.id]);

  useEffect(() => {
    initializeCallListener();
  }, [initializeCallListener]);

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
          // Key by timestamp in seconds + last 9 digits of phone
          const digits = (c.phoneNumber || '').replace(/[^0-9]/g, '');
          const suffix = digits.length > 9 ? digits.slice(-9) : digits;
          const tsSeconds = Math.floor(Number(c.timestamp) / 1000);
          map[`${tsSeconds}_${suffix}`] = c.simSlot;
        }
      }
      setSimSlotMap(map);

      // Re-sync native calls to Firestore to fix any incorrect call types
      syncCalls(nativeCalls);
    }).catch(() => {});
  }, []);

  // Load devices list on mount
  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  // Group calls by phone number
  const groupedCalls = useMemo(() => {
    const groups: { [key: string]: GroupedCall } = {};
    const validCalls = Array.isArray(calls) ? calls : [];

    // Normalize phone number for grouping: strip non-digits, take last 9 digits
    const normalizeForGroup = (phone: string): string => {
      const digits = phone.replace(/[^0-9]/g, '');
      return digits.length > 9 ? digits.slice(-9) : digits;
    };

    // Resolve simSlot: prefer Firestore value, fallback to native lookup
    const resolveSimSlot = (call: any): number | undefined => {
      if (call.simSlot != null && call.simSlot >= 0) return call.simSlot;
      const suffix = normalizeForGroup(call.phoneNumber || '');
      const tsSeconds = Math.floor(Number(call.timestamp) / 1000);
      // Try exact second, then ±1s window
      for (let offset = 0; offset <= 1; offset++) {
        const val = simSlotMap[`${tsSeconds + offset}_${suffix}`] ?? simSlotMap[`${tsSeconds - offset}_${suffix}`];
        if (val != null) return val;
      }
      return undefined;
    };

    validCalls.forEach(call => {
      const groupKey = normalizeForGroup(call.phoneNumber);
      const simSlot = resolveSimSlot(call);

      if (!groups[groupKey]) {
        groups[groupKey] = {
          key: groupKey,
          contactName: call.contactName || '',
          phoneNumber: call.phoneNumber,
          lastType: call.type,
          lastTimestamp: call.timestamp,
          lastDuration: call.duration,
          lastSimSlot: simSlot,
          count: 1,
          calls: [call],
        };
      } else {
        groups[groupKey].count++;
        groups[groupKey].calls.push(call);
        if (call.timestamp > groups[groupKey].lastTimestamp) {
          groups[groupKey].lastTimestamp = call.timestamp;
          groups[groupKey].lastType = call.type;
          groups[groupKey].lastDuration = call.duration;
          groups[groupKey].lastSimSlot = simSlot;
        }
        if (call.contactName && !groups[groupKey].contactName) {
          groups[groupKey].contactName = call.contactName;
        }
      }
    });

    let result = Object.values(groups).sort(
      (a, b) => b.lastTimestamp - a.lastTimestamp,
    );

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        g =>
          g.contactName.toLowerCase().includes(query) ||
          g.phoneNumber.includes(query),
      );
    }

    return result;
  }, [calls, searchQuery, simSlotMap]);

  // Handlers
  const handlePress = useCallback(
    (group: GroupedCall) => {
      const lastCall = group.calls.reduce((latest, call) =>
        call.timestamp > latest.timestamp ? call : latest,
      );
      navigation.navigate('CallDetail', { call: lastCall });
    },
    [navigation],
  );

  const handleDelete = useCallback(async (group: GroupedCall) => {
    await deleteCallsByPhoneNumbers([group.phoneNumber]);
  }, [deleteCallsByPhoneNumbers]);

  const confirmDelete = useCallback(async () => {
    if (deleteTarget === 'single' && singleDeleteItem) {
      await deleteCallsByPhoneNumbers([singleDeleteItem.phoneNumber]);
      AlertService.showOperationComplete(
        isRTL,
        isRTL ? 'تم حذف المكالمة' : 'Call deleted',
      );
    } else if (deleteTarget === 'selected') {
      await deleteCallsByPhoneNumbers(selectedCalls);
      setSelectedCalls([]);
      setIsSelectMode(false);
      AlertService.showOperationComplete(
        isRTL,
        isRTL ? 'تم حذف المكالمات المحددة' : 'Selected calls deleted',
      );
    } else if (deleteTarget === 'all') {
      await clearAllCalls();
      AlertService.showOperationComplete(
        isRTL,
        isRTL ? 'تم حذف كل المكالمات' : 'All calls deleted',
      );
    }
    setShowDeleteSheet(false);
    setDeleteTarget(null);
    setSingleDeleteItem(null);
  }, [
    deleteTarget,
    singleDeleteItem,
    selectedCalls,
    deleteCallsByPhoneNumbers,
    clearAllCalls,
    isRTL,
  ]);

  const toggleSelectCall = useCallback((phoneNumber: string) => {
    setSelectedCalls(prev =>
      prev.includes(phoneNumber)
        ? prev.filter(p => p !== phoneNumber)
        : [...prev, phoneNumber],
    );
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedCalls.length === groupedCalls.length) {
      setSelectedCalls([]);
    } else {
      setSelectedCalls(groupedCalls.map(g => g.phoneNumber));
    }
  }, [selectedCalls.length, groupedCalls]);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedCalls.length === 0) return;
    await deleteCallsByPhoneNumbers(selectedCalls);
    setSelectedCalls([]);
    setIsSelectMode(false);
  }, [selectedCalls, deleteCallsByPhoneNumbers]);

  const handleDeleteAllCalls = useCallback(async () => {
    if (groupedCalls.length === 0) return;
    await clearAllCalls();
  }, [groupedCalls.length, clearAllCalls]);

  const cancelSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedCalls([]);
  }, []);

  const enterSelectMode = useCallback(() => {
    setIsSelectMode(true);
  }, []);

  return {
    // Data
    groupedCalls,
    calls,
    searchQuery,
    isSelectMode,
    selectedCalls,
    isLoading,
    isSyncing,

    // Device filter
    devices,
    currentDevice,
    selectedDeviceId,
    setSelectedDeviceId,

    // Theme
    isRTL,
    isDarkMode,
    colors,
    bgColor,
    textColor,
    secondaryTextColor,
    surfaceColor,
    avatarBgColor,

    // Handlers
    setSearchQuery,
    handlePress,
    handleDelete,
    toggleSelectCall,
    toggleSelectAll,
    handleDeleteSelected,
    handleDeleteAllCalls,
    cancelSelectMode,
    enterSelectMode,
    loadCalls: refreshCalls,

    // Delete sheet state
    showDeleteSheet,
    setShowDeleteSheet,
    deleteTarget,
    singleDeleteItem,
    confirmDelete,
  };
};
