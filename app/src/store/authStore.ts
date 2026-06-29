import { create } from 'zustand';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { User } from '../types';
import { COLLECTIONS } from '../constants';
import { NativeCredentialsService } from '../services/nativeCredentials';
import {
  AppError,
  parseFirebaseAuthError,
  ErrorCode,
  logError,
} from '../utils/errors';
import { authLogger as logger } from '../utils/logger';

interface AuthState {
  user: User | null;
  firebaseUser: FirebaseAuthTypes.User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  accountDeletedNotice: boolean;

  // Actions
  initialize: () => void;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  clearAccountDeletedNotice: () => void;
  clearError: () => void;
}

// Configure Google Sign In
GoogleSignin.configure({
  webClientId: '723637478368-dq4ad954ot30p4bes5iuk5ba8bud1ecl.apps.googleusercontent.com',
});

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  firebaseUser: null,
  isLoading: true,
  isAuthenticated: false,
  error: null,
  accountDeletedNotice: false,

  initialize: () => {
    const unsubscribe = auth().onAuthStateChanged(async firebaseUser => {
      if (firebaseUser) {
        const userData: User = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
          createdAt: Date.now(),
          lastLoginAt: Date.now(),
        };

        // Set authenticated immediately, don't wait for Firestore
        set({
          user: userData,
          firebaseUser,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });

        try {
          firestore()
            .collection(COLLECTIONS.USERS)
            .doc(firebaseUser.uid)
            .set(userData, { merge: true })
            .catch(() => {});
        } catch (error: any) {
          // Ignore Firestore errors - user is already authenticated
        }

        // Register device on sign-in (covers first-time sign-in on any device).
        // Uses lazy require to avoid circular dependency with deviceStore.
        try {
          const { useDeviceStore } = require('./deviceStore');
          useDeviceStore.getState().registerDevice().catch(() => {});
        } catch (e) {}
      } else {
        set({
          user: null,
          firebaseUser: null,
          isAuthenticated: false,
          isLoading: false,
        });
      }
    });

    return unsubscribe;
  },

  signInWithEmail: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      logger.info(`Signing in user: ${email}`);
      await auth().signInWithEmailAndPassword(email, password);
      logger.info('Sign in successful');
    } catch (error: any) {
      const appError = parseFirebaseAuthError(error);
      logError(appError, 'signInWithEmail');
      set({ error: appError.getLocalizedMessage('en'), isLoading: false });
      throw appError;
    }
  },

  signUpWithEmail: async (
    email: string,
    password: string,
    displayName: string,
  ) => {
    set({ isLoading: true, error: null });
    try {
      logger.info(`Creating new user: ${email}`);
      const result = await auth().createUserWithEmailAndPassword(
        email,
        password,
      );
      await result.user.updateProfile({ displayName });

      // Create user document with photoURL
      const userData: User = {
        uid: result.user.uid,
        email: email,
        displayName: displayName,
        photoURL: result.user.photoURL || null,
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
      };

      await firestore()
        .collection(COLLECTIONS.USERS)
        .doc(result.user.uid)
        .set(userData);

      logger.info('User created successfully');
    } catch (error: any) {
      const appError = parseFirebaseAuthError(error);
      logError(appError, 'signUpWithEmail');
      set({ error: appError.getLocalizedMessage('en'), isLoading: false });
      throw appError;
    }
  },

  signInWithGoogle: async () => {
    console.log('[AUTH] signInWithGoogle started');
    set({ isLoading: true, error: null });
    try {
      // Check if your device supports Google Play
      console.log('[AUTH] Checking Play Services...');
      await GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });
      console.log('[AUTH] Play Services OK, calling GoogleSignin.signIn()...');

      // Get the users ID token
      const signInResult = await GoogleSignin.signIn();
      console.log('[AUTH] signIn returned:', JSON.stringify(signInResult));
      // Check if sign in was successful (v16.x returns { type: 'success', data: {...} })
      if (!signInResult || signInResult.type === 'cancelled') {
        throw new Error('Google Sign-In was cancelled');
      }

      // Handle v16.x response format: { type: 'success', data: { idToken, user } }
      let idToken: string | null = null;
      let accessToken: string | null = null;
      let googleDisplayName: string | null = null;
      let googlePhotoURL: string | null = null;

      // Try different response formats
      if ('data' in signInResult && signInResult.data) {
        // v16.x format
        idToken = signInResult.data.idToken;
        googleDisplayName = signInResult.data.user?.name || null;
        googlePhotoURL = signInResult.data.user?.photo || null;
      } else if ('idToken' in signInResult) {
        // Older format
        idToken = (signInResult as any).idToken;
        googleDisplayName = (signInResult as any).user?.name || null;
        googlePhotoURL = (signInResult as any).user?.photo || null;
      }

      // If still no idToken, try getTokens()
      if (!idToken) {
        try {
          const tokens = await GoogleSignin.getTokens();
          idToken = tokens.idToken;
          // If no idToken but have accessToken, use it
          if (!idToken && tokens.accessToken) {
            accessToken = tokens.accessToken;
          }
        } catch (tokenError) {}
      }

      // We can use either idToken or accessToken with Firebase
      if (!idToken && !accessToken) {
        throw new Error('No ID token or access token received from Google');
      }

      // Create a Google credential with the token
      // GoogleAuthProvider.credential(idToken, accessToken) - either can be null
      const googleCredential = auth.GoogleAuthProvider.credential(
        idToken,
        accessToken as string | undefined,
      );

      // Sign-in the user with the credential
      const userCredential = await auth().signInWithCredential(
        googleCredential,
      );

      // Create or update user document with photoURL
      const userData: User = {
        uid: userCredential.user.uid,
        email: userCredential.user.email || '',
        displayName:
          googleDisplayName || userCredential.user.displayName || 'User',
        photoURL: googlePhotoURL || userCredential.user.photoURL || null,
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
      };

      await firestore()
        .collection(COLLECTIONS.USERS)
        .doc(userCredential.user.uid)
        .set(userData, { merge: true });

      // Note: isLoading will be set to false by onAuthStateChanged listener
      // But add a fallback in case it doesn't fire
    } catch (error: any) {
      console.log('[AUTH] signInWithGoogle ERROR:', error?.code || error?.message || error);
      // Handle specific Google Sign-In errors
      const errorMessage =
        error?.message || error?.code || 'Google Sign-In failed';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  signOut: async () => {
    set({ isLoading: true, error: null });
    try {
      // Clear native credentials for background operation
      try {
        await NativeCredentialsService.clearCredentials();
      } catch (e) {}

      // Sign out from Google if signed in with Google
      try {
        await GoogleSignin.signOut();
      } catch (e) {
        // Ignore if not signed in with Google
      }

      // Clear all stores data before signing out
      const { useSMSStore } = require('./smsStore');
      const { useDeviceStore } = require('./deviceStore');
      const { useChatStore } = require('./chatStore');
      const { useCallStore } = require('./callStore');
      const { useNotificationStore } = require('./notificationStore');

      useSMSStore.getState().cleanup();
      useDeviceStore.getState().cleanup();
      useChatStore.getState().cleanup();
      useCallStore.getState().cleanup();
      useNotificationStore.getState().cleanup();

      await auth().signOut();
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  deleteAccount: async () => {
    set({ isLoading: true, error: null });
    try {
      const currentUser = auth().currentUser;
      if (!currentUser) {
        throw new AppError(
          ErrorCode.AUTH_USER_NOT_FOUND,
          'No authenticated user found',
        );
      }

      const uid = currentUser.uid;

      const deleteByQuery = async (
        ref: any,
        field: string,
        value: string,
      ) => {
        const snap = await ref.where(field, '==', value).get();
        if (snap.empty) return;

        const batch = firestore().batch();
        snap.docs.forEach((d: any) => batch.delete(d.ref));
        await batch.commit();
      };

      // Revoke all device sharing links so recipients immediately lose access.
      // Owner side: shares/requests created by this user.
      await deleteByQuery(firestore().collection('deviceShares'), 'ownerUid', uid).catch(() => {});
      await deleteByQuery(firestore().collection('deviceShareRequests'), 'ownerUid', uid).catch(() => {});
      await deleteByQuery(firestore().collection('deviceShareIndex'), 'ownerUid', uid).catch(() => {});

      // Recipient side: shares/requests where this user is the recipient.
      await deleteByQuery(firestore().collection('deviceShares'), 'sharedWithUid', uid).catch(() => {});
      await deleteByQuery(firestore().collection('deviceShareRequests'), 'sharedWithUid', uid).catch(() => {});
      await deleteByQuery(firestore().collection('deviceShareIndex'), 'sharedWithUid', uid).catch(() => {});

      // Best-effort cleanup of profile document before deleting auth user.
      await firestore().collection(COLLECTIONS.USERS).doc(uid).delete().catch(() => {});

      try {
        await GoogleSignin.signOut();
      } catch (e) {
        // Ignore if user is not signed in with Google.
      }

      try {
        await NativeCredentialsService.clearCredentials();
      } catch (e) {
        // Ignore native credential cleanup errors.
      }

      await currentUser.delete();

      // Clear app stores to avoid stale cached data after deletion.
      try {
        const { useSMSStore } = require('./smsStore');
        const { useDeviceStore } = require('./deviceStore');
        const { useChatStore } = require('./chatStore');
        const { useCallStore } = require('./callStore');
        const { useNotificationStore } = require('./notificationStore');

        useSMSStore.getState().cleanup();
        useDeviceStore.getState().cleanup();
        useChatStore.getState().cleanup();
        useCallStore.getState().cleanup();
        useNotificationStore.getState().cleanup();
      } catch (e) {
        // Ignore cleanup errors.
      }

      set({
        user: null,
        firebaseUser: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
        accountDeletedNotice: true,
      });
    } catch (error: any) {
      const appError = parseFirebaseAuthError(error);
      logError(appError, 'deleteAccount');
      set({ error: appError.getLocalizedMessage('en'), isLoading: false });
      throw appError;
    }
  },

  resetPassword: async (email: string) => {
    await auth().sendPasswordResetEmail(email);
  },

  clearAccountDeletedNotice: () => set({ accountDeletedNotice: false }),

  clearError: () => set({ error: null }),
}))
