import { useEffect, useRef } from 'react';
import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

export interface SharedData {
  mimeType: string;
  text?: string;
  subject?: string;
  /** Single URI (content:// or file://) for SEND action */
  uri?: string;
  /** All URIs for SEND_MULTIPLE action */
  uris?: string[];
}

const { ShareModule } = NativeModules;

/**
 * Listens for content shared to iRopit from the Android share sheet.
 * Calls `onReceive` with the shared data both on initial launch and
 * whenever the app receives a new share while already running.
 */
export function useShareReceive(onReceive: (data: SharedData) => void) {
  const onReceiveRef = useRef(onReceive);
  onReceiveRef.current = onReceive;

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!ShareModule || typeof ShareModule.getSharedData !== 'function') return;

    let subscription: any = null;

    try {
      // Pick up data shared when the app was launched from the share sheet
      ShareModule.getSharedData()
        .then((data: SharedData | null) => {
          if (data) onReceiveRef.current(data);
        })
        .catch(() => {});

      // Pick up data shared while the app is already running
      const emitter = new NativeEventEmitter(ShareModule);
      subscription = emitter.addListener('SharedDataReceived', (data: SharedData) => {
        try { onReceiveRef.current(data); } catch {}
      });
    } catch {}

    return () => {
      try { subscription?.remove(); } catch {}
    };
  }, []);
}

