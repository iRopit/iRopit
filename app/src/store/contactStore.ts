import { create } from 'zustand';
import firestore from '@react-native-firebase/firestore';
import { PermissionsAndroid, Platform } from 'react-native';
import Contacts from 'react-native-contacts';
import { useAuthStore } from './authStore';
import { useDeviceStore } from './deviceStore';
import { COLLECTIONS } from '../constants';

interface Contact {
  id: string;
  name: string;
  phoneNumber: string;
  phoneNumbers?: string[];
  thumbnail?: string;
}

interface ContactState {
  contacts: Contact[];
  isLoading: boolean;
  isSyncing: boolean;
  lastSynced: number | null;
  error: string | null;
  loadContacts: () => Promise<void>;
  syncContactsToFirebase: () => Promise<void>;
}

export const useContactStore = create<ContactState>((set, get) => ({
  contacts: [],
  isLoading: false,
  isSyncing: false,
  lastSynced: null,
  error: null,

  loadContacts: async () => {
    if (Platform.OS !== 'android') return;

    try {
      set({ isLoading: true, error: null });

      // Check permission
      const permission = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
      );

      if (!permission) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          set({ isLoading: false, error: 'Contacts permission denied' });
          return;
        }
      }

      // Get all contacts
      const allContacts = await Contacts.getAll();

      // Filter and format contacts with phone numbers
      const formattedContacts: Contact[] = allContacts
        .filter(
          contact => contact.phoneNumbers && contact.phoneNumbers.length > 0,
        )
        .map(contact => {
          const phoneNumbers = contact.phoneNumbers.map(p => p.number);
          return {
            id: contact.recordID,
            name:
              `${contact.givenName || ''} ${contact.familyName || ''}`.trim() ||
              'Unknown',
            phoneNumber: phoneNumbers[0] || '',
            phoneNumbers: phoneNumbers,
            thumbnail: contact.thumbnailPath || undefined,
          };
        })
        .filter(c => c.phoneNumber) // Only contacts with phone numbers
        .sort((a, b) => a.name.localeCompare(b.name));

      set({ contacts: formattedContacts, isLoading: false });
      console.log(`[ContactStore] Loaded ${formattedContacts.length} contacts`);
    } catch (error: any) {
      console.warn('[ContactStore] Error loading contacts:', error);
      set({ isLoading: false, error: error.message });
    }
  },

  syncContactsToFirebase: async () => {
    const { user } = useAuthStore.getState();
    const { currentDevice } = useDeviceStore.getState();

    if (!user || !currentDevice) {
      console.log('[ContactStore] Cannot sync - no user or device');
      return;
    }

    try {
      set({ isSyncing: true });

      // Load contacts first if not loaded
      let { contacts } = get();
      if (contacts.length === 0) {
        await get().loadContacts();
        contacts = get().contacts;
      }

      if (contacts.length === 0) {
        console.log('[ContactStore] No contacts to sync');
        set({ isSyncing: false });
        return;
      }

      // Save contacts to Firebase (in batches of 500)
      const batchSize = 500;
      const batches = [];

      for (let i = 0; i < contacts.length; i += batchSize) {
        const batch = contacts.slice(i, i + batchSize);
        batches.push(batch);
      }

      const contactsRef = firestore()
        .collection(COLLECTIONS.USERS)
        .doc(user.uid)
        .collection(COLLECTIONS.DEVICES)
        .doc(currentDevice.id)
        .collection('contacts');

      // Clear existing contacts
      const existingDocs = await contactsRef.limit(500).get();
      const deleteBatch = firestore().batch();
      existingDocs.docs.forEach(doc => {
        deleteBatch.delete(doc.ref);
      });
      await deleteBatch.commit();

      // Add new contacts
      for (const batch of batches) {
        const writeBatch = firestore().batch();
        batch.forEach(contact => {
          const docRef = contactsRef.doc(contact.id);
          writeBatch.set(docRef, {
            name: contact.name,
            phoneNumber: contact.phoneNumber,
            phoneNumbers: contact.phoneNumbers || [contact.phoneNumber],
            updatedAt: Date.now(),
          });
        });
        await writeBatch.commit();
      }

      const now = Date.now();
      set({ isSyncing: false, lastSynced: now });
      console.log(
        `[ContactStore] Synced ${contacts.length} contacts to Firebase`,
      );
    } catch (error: any) {
      const code = error?.code || '';
      if (code === 'firestore/unavailable' || code === 'unavailable') {
        // Transient network error during startup — will retry on next foreground
        console.log('[ContactStore] Firestore unavailable, will retry later');
        set({ isSyncing: false });
        return;
      }
      console.warn('[ContactStore] Error syncing contacts (code:', code, '):', error);
      set({ isSyncing: false, error: error.message });
    }
  },
}));
