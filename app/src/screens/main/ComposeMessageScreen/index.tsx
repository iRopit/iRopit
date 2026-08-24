import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useTheme } from '../../../contexts/ThemeContext';
import { useSMSStore } from '../../../store/smsStore';

import { ComposeMessageScreenProps } from './types';
import { styles } from './styles';

const ComposeMessageScreen = ({ navigation }: ComposeMessageScreenProps) => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const { colors, t } = useTheme();
  const addMessage = useSMSStore(state => state.addMessage);

  const handleSend = async () => {
    if (!phoneNumber.trim()) {
      Alert.alert('خطأ', 'الرجاء إدخال رقم الهاتف');
      return;
    }
    if (!message.trim()) {
      Alert.alert('خطأ', 'الرجاء إدخال الرسالة');
      return;
    }

    setIsSending(true);
    try {
      // Add message to store
      const newMessage = {
        id: Date.now().toString(),
        phoneNumber: phoneNumber.trim(),
        contactName: null,
        body: message.trim(),
        timestamp: Date.now(),
        type: 'sent' as const,
        read: true,
        deviceId: 'android',
      };

      addMessage(newMessage);

      Alert.alert('✓', 'تم إرسال الرسالة', [
        { text: 'حسناً', onPress: () => navigation.goBack() },
      ]);
    } catch (error: any) {
      Alert.alert('خطأ', error.message || 'فشل إرسال الرسالة');
    }
    setIsSending(false);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Phone Number Input */}
        <View style={styles.inputSection}>
          <Text style={[styles.label, { color: colors.text }]}>رقم الهاتف</Text>
          <View
            style={[
              styles.inputContainer,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={styles.inputIcon}>📱</Text>
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="أدخل رقم الهاتف"
              placeholderTextColor={colors.textSecondary}
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
            />
          </View>
        </View>

        {/* Message Input */}
        <View style={styles.inputSection}>
          <Text style={[styles.label, { color: colors.text }]}>الرسالة</Text>
          <View
            style={[
              styles.messageContainer,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <TextInput
              style={[styles.messageInput, { color: colors.text }]}
              placeholder="اكتب رسالتك هنا..."
              placeholderTextColor={colors.textSecondary}
              value={message}
              onChangeText={setMessage}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
          </View>
          <Text style={[styles.charCount, { color: colors.textSecondary }]}>
            {message.length} / 160
          </Text>
        </View>

        {/* Send Button */}
        <TouchableOpacity
          style={[
            styles.sendButton,
            { backgroundColor: colors.primary },
            isSending && styles.sendButtonDisabled,
          ]}
          onPress={handleSend}
          disabled={isSending}
        >
          <Text style={styles.sendButtonIcon}>📤</Text>
          <Text style={styles.sendButtonText}>
            {isSending ? 'جاري الإرسال...' : 'إرسال الرسالة'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default ComposeMessageScreen;
