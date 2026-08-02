import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import firestore from '@react-native-firebase/firestore';
import { CallLog } from '../types';
import { COLLECTIONS, CALL_PAGE_SIZE } from '../constants';
import { useAuthStore } from './authStore';
import { useDeviceStore } from './deviceStore';
import { encryptCall, decryptCall } from '../services/cryptoService';

let callListenerGeneration = 0;

interface CallState {
  calls: CallLog[];
  activeDeviceId: string | null;
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  unsubscribe: (() => void) | null;

  // Actions
  loadCalls: (deviceId?: string) => void;
  setCalls: (calls: CallLog[]) => void;
  addCall: (call: CallLog) => void;
  addCallAndSync: (call: CallLog, userId: string) => Promise<void>;
  syncCalls: (localCalls: any[]) => Promise<void>;
  syncCallsToFirebase: (userId: string) => Promise<void>;
  clearAllCalls: () => Promise<void>;
  deleteCallsByPhoneNumbers: (phoneNumbers: string[]) => Promise<void>;
  cleanup: () => void;
}

export const useCallStore = create<CallState>()(
  persist(
    (set, get) => ({
      calls: [],
      activeDeviceId: null,
      isLoading: false,
      isSyncing: false,
      error: null,
      unsubscribe: null,

      setCalls: (calls: CallLog[]) => {
        set({ calls });
      },

      addCall: (call: CallLog) => {
        const { calls, activeDeviceId } = get();
        const callDeviceId = (call as any).deviceId;
        if (activeDeviceId && callDeviceId && callDeviceId !== activeDeviceId) {
          return;
        }

        // تجنب التكرار
        if (!calls.find(c => c.id === call.id)) {
          set({ calls: [call, ...calls] });
        }
      },

      // إضافة مكالمة وحفظها في Firebase مباشرة
      addCallAndSync: async (call: CallLog, userId: string) => {
        const { calls, activeDeviceId } = get();
        const { currentDevice } = useDeviceStore.getState();
        const callDeviceId = (call as any).deviceId || currentDevice?.id;
        const shouldProjectInCurrentView =
          !activeDeviceId || !callDeviceId || callDeviceId === activeDeviceId;

        // تجنب التكرار
        if (shouldProjectInCurrentView && !calls.find(c => c.id === call.id)) {
          set({ calls: [call, ...calls] });
        }

        // حفظ في Firebase فوراً
        if (userId && currentDevice) {
          try {
            const phoneNumber =
              (call as any).phoneNumber || (call as any).number || 'unknown';

            // إزالة القيم undefined التي لا يقبلها Firestore
            const callData: Record<string, any> = {
              id: call.id,
              userId,
              deviceId: currentDevice.id,
              deviceName:
                currentDevice.nickname ||
                currentDevice.name ||
                'Android Device',
              phoneNumber,
              contactName: call.contactName || null,
              type: call.type || 'incoming',
              duration: call.duration || 0,
              timestamp: call.timestamp || Date.now(),
              syncedAt: Date.now(),
              simSlot: call.simSlot ?? -1,
            };

            // Use a stable docId based on call timestamp + phone number
            // Normalize phone: strip everything except digits and '+' to match FirebaseHelper.java format
            const cleanPhone = phoneNumber.replace(/[^0-9+]/g, '');
            const docId = `call_${call.timestamp}_${cleanPhone}`.replace(
              /[\/\.]/g,
              '_',
            );

            // Encrypt sensitive call data before saving
            const encryptedCallData = await encryptCall(callData, userId);

            await firestore()
              .collection(COLLECTIONS.USERS)
              .doc(userId)
              .collection(COLLECTIONS.DEVICES)
              .doc(currentDevice.id)
              .collection(COLLECTIONS.CALLS)
              .doc(docId)
              .set(encryptedCallData, { merge: true });
          } catch (error) {}
        }
      },

      syncCallsToFirebase: async (userId: string) => {
        const { calls } = get();
        const { currentDevice } = useDeviceStore.getState();
        if (!userId || !currentDevice || calls.length === 0) return;

        try {
          const batch = firestore().batch();

          for (const call of calls.slice(0, 50)) {
            // آخر 50 مكالمة فقط
            // استخدام number أو phoneNumber (للتوافق)
            const phoneNumber = call.phoneNumber || call.number || 'unknown';

            // إزالة القيم undefined التي لا يقبلها Firestore
            const callData: Record<string, any> = {
              id: call.id,
              userId,
              deviceId: currentDevice.id,
              deviceName:
                currentDevice.nickname ||
                currentDevice.name ||
                'Android Device',
              phoneNumber,
              contactName: call.contactName || null,
              type: call.type || 'incoming',
              duration: call.duration || 0,
              timestamp: call.timestamp || Date.now(),
              syncedAt: Date.now(),
              simSlot: call.simSlot ?? -1,
            };

            const docId = `call_${call.timestamp}_${phoneNumber.replace(/[^0-9+]/g, '')}`.replace(
              /[\/\.]/g,
              '_',
            );
            const docRef = firestore()
              .collection(COLLECTIONS.USERS)
              .doc(userId)
              .collection(COLLECTIONS.DEVICES)
              .doc(currentDevice.id)
              .collection(COLLECTIONS.CALLS)
              .doc(docId);

            // Encrypt call data before saving
            const encryptedCallData = await encryptCall(callData, userId);
            batch.set(docRef, encryptedCallData, { merge: true });
          }

          await batch.commit();
        } catch (error: any) {}
      },

      loadCalls: async (deviceIdParam?: string) => {
        const { user } = useAuthStore.getState();
        const { currentDevice } = useDeviceStore.getState();
        if (!user || !currentDevice) return;

        const deviceId = deviceIdParam || currentDevice.id;
        const previousDeviceId = get().activeDeviceId;
        const isSwitchingDevice =
          !!previousDeviceId && previousDeviceId !== deviceId;
        const listenerGeneration = ++callListenerGeneration;
        const isStaleListener = () => listenerGeneration !== callListenerGeneration;

        // Unsubscribe from previous listener
        const { unsubscribe: prevUnsubscribe } = get();
        if (prevUnsubscribe) {
          prevUnsubscribe();
        }

        set({
          isLoading: true,
          activeDeviceId: deviceId,
          calls: isSwitchingDevice ? [] : get().calls,
        });

        const isLikelyCallPayload = (data: any): boolean => {
          if (!data || typeof data !== 'object') return false;

          const t = String(data.type || data.callType || '').toLowerCase();
          if (
            t.includes('incoming') ||
            t.includes('outgoing') ||
            t.includes('missed') ||
            t.includes('rejected') ||
            t === 'call' ||
            t === 'whatsapp_call'
          ) {
            return true;
          }

          const hasDuration = Number.isFinite(Number(data.duration));
          const hasPhone = !!(data.phoneNumber || data.number || data.address);
          if (hasDuration && hasPhone) return true;

          return false;
        };

        const decryptCallWithTimeout = async (
          call: any,
          timeoutMs = 300,
        ): Promise<CallLog> => {
          try {
            const timeoutPromise = new Promise<CallLog>(resolve => {
              setTimeout(() => resolve(call as CallLog), timeoutMs);
            });

            return (await Promise.race([
              decryptCall(call, user.uid),
              timeoutPromise,
            ])) as CallLog;
          } catch (_) {
            return call as CallLog;
          }
        };

        // Track whether the initial full snapshot has been processed.
        // Subsequent snapshots only carry changed documents (docChanges),
        // so we can merge them incrementally without re-decrypting everything.
        let isInitialSnapshot = true;

        const unsubscribe = firestore()
          .collection(COLLECTIONS.USERS)
          .doc(user.uid)
          .collection(COLLECTIONS.DEVICES)
          .doc(deviceId)
          .collection(COLLECTIONS.CALLS)
          .orderBy('timestamp', 'desc')
          .limit(CALL_PAGE_SIZE)
          .onSnapshot(
            async snapshot => {
              if (isStaleListener()) return;

              if (isInitialSnapshot) {
                isInitialSnapshot = false;

                // Initial load: process all documents with chunked decryption
                const rawCalls: CallLog[] = [];
                snapshot.forEach(doc => {
                  const data: any = doc.data() || {};
                  const normalizedData = {
                    ...data,
                    timestamp:
                      data.timestamp ||
                      data.createdAt?.toMillis?.() ||
                      data.syncedAt ||
                      Date.now(),
                  };
                  if (isLikelyCallPayload(normalizedData)) {
                    rawCalls.push({ id: doc.id, ...normalizedData } as CallLog);
                  }
                });
                // Decrypt in chunks with yields so large initial loads don't
                // freeze the JS thread and cause navigation lag.
                const DECRYPT_CHUNK = 100;
                const calls: CallLog[] = [];
                let hasRenderedProgressive = false;
                for (let i = 0; i < rawCalls.length; i += DECRYPT_CHUNK) {
                  const chunk = rawCalls.slice(i, i + DECRYPT_CHUNK);
                  const decryptedChunk = (await Promise.all(
                    chunk.map(call => decryptCallWithTimeout(call)),
                  )) as CallLog[];
                  calls.push(...decryptedChunk);

                  // Render the first chunks progressively so selected-device
                  // lists don't stay blank while the whole history decrypts.
                  if (!hasRenderedProgressive || i % (DECRYPT_CHUNK * 3) === 0) {
                    const progressive = [...calls];
                    progressive.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                    if (isStaleListener()) return;
                    set({ calls: progressive, isLoading: false });
                    hasRenderedProgressive = true;
                  }

                  await new Promise(resolve => setTimeout(resolve, 0));
                  if (isStaleListener()) return;
                }
                if (isStaleListener()) return;
                calls.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                set({ calls, isLoading: false });
                return;
              }

              // Subsequent snapshots: only process added/modified documents so
              // a new call appears immediately without re-decrypting everything.
              const changes = snapshot
                .docChanges()
                .filter(c => c.type === 'added' || c.type === 'modified')
                .filter(c => isLikelyCallPayload(c.doc.data()));
              if (changes.length > 0) {
                const rawNew = changes.map(
                  c => {
                    const data: any = c.doc.data() || {};
                    return {
                      id: c.doc.id,
                      ...data,
                      timestamp:
                        data.timestamp ||
                        data.createdAt?.toMillis?.() ||
                        data.syncedAt ||
                        Date.now(),
                    } as CallLog;
                  },
                );
                const newCalls = (await Promise.all(
                  rawNew.map(call => decryptCallWithTimeout(call)),
                )) as CallLog[];
                if (isStaleListener()) return;

                const { calls: currentCalls } = get();
                const callsMap = new Map(currentCalls.map(c => [c.id, c]));
                for (const call of newCalls) {
                  callsMap.set(call.id, call);
                }
                const merged = Array.from(callsMap.values());
                merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                if (isStaleListener()) return;
                set({ calls: merged });
                return;
              }

              // Firestore can emit snapshots with documents but no docChanges
              // after cache/metadata churn. Keep calls aligned by merging top docs.
              if (snapshot.docs.length > 0) {
                const mapped = await Promise.allSettled(
                  snapshot.docs.map(async docSnap => {
                    const data: any = docSnap.data() || {};
                    const normalizedData = {
                      ...data,
                      timestamp:
                        data.timestamp ||
                        data.createdAt?.toMillis?.() ||
                        data.syncedAt ||
                        Date.now(),
                    };
                    if (!isLikelyCallPayload(normalizedData)) return null;
                    return await decryptCallWithTimeout({
                      id: docSnap.id,
                      ...normalizedData,
                    } as CallLog);
                  }),
                );

                const fromSnapshot = mapped
                  .filter(r => r.status === 'fulfilled' && !!r.value)
                  .map((r: any) => r.value as CallLog);
                if (isStaleListener()) return;

                if (fromSnapshot.length > 0) {
                  const { calls: currentCalls } = get();
                  const snapshotMap = new Map(currentCalls.map(c => [c.id, c]));
                  for (const call of fromSnapshot) {
                    snapshotMap.set(call.id, call);
                  }
                  const snapshotMerged = Array.from(snapshotMap.values());
                  snapshotMerged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                  if (isStaleListener()) return;
                  set({ calls: snapshotMerged });
                }
              }
            },
            error => {
              if (isStaleListener()) return;
              set({ error: error.message, isLoading: false });
            },
          );

        set({ unsubscribe });
      },

      syncCalls: async (localCalls: any[]) => {
        const { user } = useAuthStore.getState();
        const { currentDevice } = useDeviceStore.getState();
        if (!user || !currentDevice) return;

        set({ isSyncing: true, error: null });

        try {
          // Build all doc refs + data first
          const CHUNK_SIZE = 400; // Firestore batch limit is 500; use 400 for safety
          const docs: Array<{ ref: any; data: Omit<CallLog, 'id'> }> = [];

          for (const call of localCalls) {
            let callType: CallLog['type'] = 'incoming';
            switch (call.type) {
              case 1:
              case 'INCOMING':
              case 'incoming':
                callType = 'incoming';
                break;
              case 2:
              case 'OUTGOING':
              case 'outgoing':
                callType = 'outgoing';
                break;
              case 3:
              case 'MISSED':
              case 'missed':
                callType = 'missed';
                break;
              case 5:
              case 'REJECTED':
              case 'rejected':
                callType = 'rejected';
                break;
            }

            const callData: Omit<CallLog, 'id'> = {
              userId: user.uid,
              deviceId: currentDevice.id,
              phoneNumber: call.phoneNumber || call.number,
              contactName: call.name || call.contactName,
              type: callType,
              duration: parseInt(call.duration) || 0,
              timestamp:
                parseInt(call.dateTime) ||
                parseInt(call.timestamp) ||
                Date.now(),
              syncedAt: Date.now(),
              simSlot: call.simSlot ?? -1,
            };

            const cleanPhoneSync = (callData.phoneNumber || '').replace(/[^0-9+]/g, '');
            const docId = `call_${callData.timestamp}_${cleanPhoneSync}`.replace(/[\/\.]/g, '_');
            const docRef = firestore()
              .collection(COLLECTIONS.USERS)
              .doc(user.uid)
              .collection(COLLECTIONS.DEVICES)
              .doc(currentDevice.id)
              .collection(COLLECTIONS.CALLS)
              .doc(docId);

            docs.push({ ref: docRef, data: callData });
          }

          // Write in chunks to stay within Firestore batch limit + yield to JS thread
          for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
            const chunk = docs.slice(i, i + CHUNK_SIZE);
            const batch = firestore().batch();
            chunk.forEach(({ ref, data }) => batch.set(ref, data, { merge: true }));
            await batch.commit();
            await new Promise(resolve => setTimeout(resolve, 0));
          }

          set({ isSyncing: false });
        } catch (error: any) {
          set({ error: error.message, isSyncing: false });
        }
      },

      clearAllCalls: async () => {
        const { user } = useAuthStore.getState();
        const { currentDevice } = useDeviceStore.getState();
        if (!user || !currentDevice) return;

        try {
          // Get all calls for this device
          const snapshot = await firestore()
            .collection(COLLECTIONS.USERS)
            .doc(user.uid)
            .collection(COLLECTIONS.DEVICES)
            .doc(currentDevice.id)
            .collection(COLLECTIONS.CALLS)
            .get();

          // Delete in batches
          const batch = firestore().batch();
          snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
          });
          await batch.commit();

          // Clear local state
          set({ calls: [] });
        } catch (error) {}
      },

      deleteCallsByPhoneNumbers: async (phoneNumbers: string[]) => {
        const { user } = useAuthStore.getState();
        const { currentDevice } = useDeviceStore.getState();
        const { calls } = get();
        if (!user || !currentDevice || phoneNumbers.length === 0) return;

        try {
          // Get calls for these phone numbers
          const snapshot = await firestore()
            .collection(COLLECTIONS.USERS)
            .doc(user.uid)
            .collection(COLLECTIONS.DEVICES)
            .doc(currentDevice.id)
            .collection(COLLECTIONS.CALLS)
            .get();

          // Filter docs that match the phone numbers
          const docsToDelete = snapshot.docs.filter(doc => {
            const data = doc.data();
            return phoneNumbers.includes(data.phoneNumber);
          });

          // Delete in batches (Firestore limit is 500 per batch)
          const batchSize = 500;
          for (let i = 0; i < docsToDelete.length; i += batchSize) {
            const batch = firestore().batch();
            const chunk = docsToDelete.slice(i, i + batchSize);
            chunk.forEach(doc => {
              batch.delete(doc.ref);
            });
            await batch.commit();
          }

          // Update local state
          const updatedCalls = calls.filter(
            call => !phoneNumbers.includes(call.phoneNumber),
          );
          set({ calls: updatedCalls });
        } catch (error) {}
      },

      cleanup: () => {
        callListenerGeneration++;
        const { unsubscribe } = get();
        if (unsubscribe) {
          unsubscribe();
          set({ unsubscribe: null, activeDeviceId: null });
        }
      },
    }),
    {
      name: 'call-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        calls: state.calls.slice(0, 200),
      }),
    },
  ),
);
