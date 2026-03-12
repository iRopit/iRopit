import { createNavigationContainerRef, CommonActions } from '@react-navigation/native';
import { RootStackParamList } from '../types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateToChat() {
  if (navigationRef.isReady()) {
    navigationRef.dispatch(
      CommonActions.navigate({ name: 'Main', params: { screen: 'Chat' } }),
    );
  }
}
