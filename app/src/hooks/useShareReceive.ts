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

// Try multiple ways to get the native module reference
function getShareModule() {
  const mod = NativeModules.ShareModule;
  if (mod && typeof mod.getSharedData === 'function') return mod;

  // Fabric/bridgeless may expose the module differently — try TurboModuleRegistry
  try {
    const { TurboModuleRegistry } = require('react-native');
    if (TurboModuleRegistry?.get) {
      const turbo = TurboModuleRegistry.get('ShareModule');
      if (turbo && typeof turbo.getSharedData === 'function') return turbo;
    }
  } catch {}

  return null;
}

const ShareModule = getShareModule();

/**
 * Listens for content shared to iRopit from the Android share sheet.
 * Uses both native events AND AppState-based polling to reliably
 * detect shares regardless of Fabric/TurboModule compatibility.
 */
export function useShareReceive(onReceive: (data: SharedData) => void) {
  const onReceiveRef = useRef(onReceive);
  onReceiveRef.current = onReceive;

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const pollNative = () => {
      if (!ShareModule) return;
      ShareModule.getSharedData()
        .then((data: SharedData | null) => {
          if (data) {
            try { onReceiveRef.current(data); } catch {}
          }
        })
        .catch(() => {});
    };

    // 1. Check for data that arrived before JS was ready (cold launch share)
    pollNative();

    // 2. Listen for native events via DeviceEventEmitter (works with bridge interop)
    const eventSub = DeviceEventEmitter.addListener('SharedDataReceived', (data: SharedData) => {
      // Clear pending data on native side so appState poll won't re-deliver
      if (ShareModule) ShareModule.getSharedData().catch(() => {});
      try { onReceiveRef.current(data); } catch {}
    });

    // 3. Poll when app comes to foreground — most reliable method for
    //    warm-launch shares on all architectures.
    //    Native getSharedData() clears pending data, preventing double delivery.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        pollNative();
      }
    });

    return () => {
      try { eventSub?.remove(); } catch {}
      try { appStateSub?.remove(); } catch {}
    };
  }, []);
}

