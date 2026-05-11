import { useEffect, useRef } from 'react';
import { NativeModules, Platform, AppState, DeviceEventEmitter } from 'react-native';

export interface SharedData {
  mimeType: string;
  text?: string;
  subject?: string;
  /** Single URI (content:// or file://) for SEND action */
  uri?: string;
  /** All URIs for SEND_MULTIPLE action */
  uris?: string[];
}

// Our custom module name — distinct from React Native's built-in 'ShareModule'
// which is used by Share.share() and has no getSharedData method.
const NATIVE_MODULE_NAME = 'IropitShareModule';

// Resolve the native module LAZILY at call time.  Under the New Architecture
// (TurboModules / Bridgeless), `NativeModules.IropitShareModule` may be a proxy
// where method properties exist as descriptors but `typeof` is not 'function'
// until the module has been instantiated by calling any method.  We prefer
// TurboModuleRegistry which forces instantiation.
function resolveShareModule(): any | null {
  // Prefer TurboModuleRegistry first (works under Bridgeless / New Arch).
  try {
    const { TurboModuleRegistry } = require('react-native');
    if (TurboModuleRegistry?.get) {
      const turbo = TurboModuleRegistry.get(NATIVE_MODULE_NAME);
      if (turbo) return turbo;
    }
  } catch {}

  // Fallback to legacy NativeModules lookup.
  try {
    const mod = NativeModules[NATIVE_MODULE_NAME];
    if (mod) return mod;
  } catch {}

  return null;
}

/**
 * Listens for content shared to iRopit from the Android share sheet.
 *
 * Robustness strategy (cold-start is the hard case):
 *  1. Aggressive polling on mount — retry every 500ms for the first 10s.
 *     This covers the race where the native module isn't yet reachable from
 *     JS, or where `pendingShare` hasn't been written to static fields yet.
 *  2. DeviceEventEmitter listener for runtime shares (warm path).
 *  3. AppState 'active' poll for foreground-resume shares.
 */
export function useShareReceive(onReceive: (data: SharedData) => void) {
  const onReceiveRef = useRef(onReceive);
  onReceiveRef.current = onReceive;

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    // Single authoritative deliver — calls getSharedData() to atomically
    // consume and clear the native pending flag, then fires onReceive.
    // Native hasPending is the deduplication gate: only the first call wins.
    const pollNative = () => {
      const mod = resolveShareModule();
      if (!mod) return;
      const fn = mod.getSharedData;
      if (!fn) return;
      try {
        const p = fn.call(mod);
        if (p && typeof p.then === 'function') {
          p.then((data: SharedData | null) => {
            if (data) {
              try { onReceiveRef.current(data); } catch {}
            }
          }).catch(() => {});
        }
      } catch {}
    };

    // 1) Cold-start poll: every 500ms for 15s.
    pollNative();
    let attempts = 0;
    const MAX_ATTEMPTS = 30;
    const interval = setInterval(() => {
      attempts++;
      if (attempts >= MAX_ATTEMPTS) { clearInterval(interval); return; }
      pollNative();
    }, 500);

    // 2) DeviceEventEmitter push — warm path (app already running) and as an
    //    extra cold-start trigger fired by the delayed scheduleEmit() calls.
    //    Data comes in the event payload; call getSharedData() to drain the
    //    native flag so subsequent polls don't re-deliver.
    const eventSub = DeviceEventEmitter.addListener('SharedDataReceived', (data: SharedData) => {
      // Drain native pending so polls don't re-deliver.
      const mod = resolveShareModule();
      if (mod) {
        try { (mod.getSharedData as Function).call(mod).catch?.(() => {}); } catch {}
      }
      // Always deliver on a push event — native side sent this intentionally.
      try { onReceiveRef.current(data); } catch {}
    });

    // 3) AppState 'active' poll — catches shares received while backgrounded.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') pollNative();
    });

    return () => {
      try { clearInterval(interval); } catch {}
      try { eventSub?.remove(); } catch {}
      try { appStateSub?.remove(); } catch {}
    };
  }, []);
}

