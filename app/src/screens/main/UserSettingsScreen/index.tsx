import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useAuthStore } from '../../../store/authStore';
import { useTheme } from '../../../contexts/ThemeContext';
import Icon from 'react-native-vector-icons/Ionicons';
import { Container } from '../../../components';

import { UserSettingsScreenProps } from './types';
import { styles } from './styles';

const UserSettingsScreen = ({ navigation }: UserSettingsScreenProps) => {
  const { user } = useAuthStore();
  const { colors, t, isDarkMode, isRTL } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName || '');

  // Dynamic colors
  const bgColor = colors.background;
  const textColor = colors.text;

  const handleSaveName = async () => {
    if (!displayName.trim()) {
      Alert.alert('Error', 'Display name cannot be empty');
      return;
    }

    setIsLoading(true);
    try {
      // Update Firebase Auth
      await user?.updateProfile?.({ displayName: displayName.trim() });

      // Update Firestore
      const firestore = require('@react-native-firebase/firestore').default();
      await firestore.collection('users').doc(user?.uid).update({
        displayName: displayName.trim(),
        updatedAt: Date.now(),
      });

      setEditMode(false);
      Alert.alert('Success', 'Profile updated successfully');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Container
      isDark={isDarkMode}
      noPaddingHorizontal
      backgroundColor={bgColor}
      edges={['top', 'left', 'right']}
    >
      {/* Header with back button */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Icon
            name={isRTL ? 'chevron-forward' : 'chevron-back'}
            size={28}
            color={colors.primary}
          />
        </TouchableOpacity>
      </View>

      {/* Title */}
      <View style={styles.titleContainer}>
        <Text style={[styles.title, { color: textColor }]}>
          {t('userSettings')}
        </Text>
      </View>

      <ScrollView style={styles.content}>
        {/* Profile Section */}
        <View style={[styles.section, { borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {t('profileInfo')}
          </Text>

          <View style={styles.profileCard}>
            {user?.photoURL && (
              <Image
                source={{ uri: user.photoURL }}
                style={styles.profileImage}
              />
            )}
            {!user?.photoURL && (
              <View
                style={[
                  styles.profileImage,
                  { backgroundColor: colors.primary },
                ]}
              >
                <Icon name="person" size={40} color="#fff" />
              </View>
            )}

            <View style={styles.profileInfo}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                {t('email')}
              </Text>
              <Text style={[styles.value, { color: colors.text }]}>
                {user?.email}
              </Text>

              <Text
                style={[
                  styles.label,
                  { color: colors.textSecondary, marginTop: 12 },
                ]}
              >
                {t('displayName')}
              </Text>

              {editMode ? (
                <TextInput
                  style={[
                    styles.input,
                    { borderColor: colors.primary, color: colors.text },
                  ]}
                  placeholder="Enter display name"
                  placeholderTextColor={colors.textSecondary}
                  value={displayName}
                  onChangeText={setDisplayName}
                  editable={!isLoading}
                />
              ) : (
                <Text style={[styles.value, { color: colors.text }]}>
                  {user?.displayName || 'Not set'}
                </Text>
              )}
            </View>
          </View>

          {editMode ? (
            <View style={styles.buttonGroup}>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: colors.primary }]}
                onPress={handleSaveName}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Save</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: colors.error }]}
                onPress={() => {
                  setEditMode(false);
                  setDisplayName(user?.displayName || '');
                }}
                disabled={isLoading}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.primary }]}
              onPress={() => setEditMode(true)}
            >
              <Text style={styles.editButtonText}>{t('editProfile')}</Text>
            </TouchableOpacity>
          )}
        </View>

      </ScrollView>
    </Container>
  );
};

export default UserSettingsScreen;
