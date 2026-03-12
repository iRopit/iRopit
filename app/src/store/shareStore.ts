import { create } from 'zustand';
import { SharedData } from '../hooks/useShareReceive';

interface ShareState {
  pendingShare: SharedData | null;
  setPendingShare: (data: SharedData | null) => void;
  clearPendingShare: () => void;
}

export const useShareStore = create<ShareState>(set => ({
  pendingShare: null,
  setPendingShare: data => set({ pendingShare: data }),
  clearPendingShare: () => set({ pendingShare: null }),
}));
