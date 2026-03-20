import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { ColorTheme } from '../../../../theme/colors';
import { GroupedCall } from '../types';
import { styles } from '../styles';
import {
  ACTION_WIDTH,
  formatTime,
  getInitials,
  getCallTypeIndicator,
} from '../helper';

const SwipeableCallItem = ({
  item,
  onPress,
  onDelete,
  isRTL,
  isDarkMode,
  textColor,
  secondaryTextColor,
  bgColor,
  avatarBgColor,
  colors,
  isSelectMode,
  isSelected,
  onToggleSelect,
}: {
  item: GroupedCall;
  onPress: () => void;
  onDelete: () => void;
  isRTL: boolean;
  isDarkMode: boolean;
  textColor: string;
  secondaryTextColor: string;
  bgColor: string;
  avatarBgColor: string;
  colors: ColorTheme;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}) => {
  const translateX = useRef(new Animated.Value(0)).current;
  const [swiped, setSwiped] = useState(false);

  const handleSwipe = (direction: 'left' | 'right') => {
    const toValue = direction === 'left' ? -ACTION_WIDTH : ACTION_WIDTH;
    Animated.spring(translateX, {
      toValue,
      useNativeDriver: true,
      friction: 8,
    }).start();
    setSwiped(true);
  };

  const resetSwipe = () => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      friction: 8,
    }).start();
    setSwiped(false);
  };

  const typeInfo = getCallTypeIndicator(item.lastType);
  const displayName = item.contactName || item.phoneNumber;
  const isMissed = item.lastType === 'missed' || item.lastType === 'rejected';

  return (
    <View style={[styles.swipeContainer, { backgroundColor: bgColor }]}>
      {!isSelectMode && (
        <View
          style={[
            styles.actionsContainer,
            isRTL ? styles.actionsLeft : styles.actionsRight,
          ]}
        >
          <TouchableOpacity
            style={[styles.actionButton, styles.deleteButton]}
            onPress={() => {
              resetSwipe();
              onDelete();
            }}
          >
            <Ionicons name="trash" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      )}

      <Animated.View
        style={[
          styles.callRow,
          {
            backgroundColor: bgColor,
            transform: [{ translateX: isSelectMode ? 0 : translateX }],
            width: '100%',
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => {
            if (isSelectMode && onToggleSelect) {
              onToggleSelect();
            } else if (swiped) {
              resetSwipe();
            } else {
              onPress();
            }
          }}
          onLongPress={() => {
            if (!isSelectMode) {
              handleSwipe(isRTL ? 'right' : 'left');
            }
          }}
          delayLongPress={300}
          style={styles.rowContent}
          activeOpacity={0.7}
        >
          {/* Checkbox for select mode */}
          {isSelectMode && (
            <View style={styles.checkboxContainer}>
              <View
                style={[styles.checkbox, isSelected && styles.checkboxSelected]}
              >
                {isSelected && (
                  <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                )}
              </View>
            </View>
          )}

          <View
            style={[
              styles.avatarContainer,
              isRTL && { marginRight: 0, marginLeft: 12 },
            ]}
          >
            <View style={[styles.avatar, { backgroundColor: avatarBgColor }]}>
              {getInitials(item.contactName || '', item.phoneNumber) === '??' ? (
                <Ionicons name="person" size={22} color={textColor} />
              ) : (
                <Text style={[styles.avatarText, { color: textColor }]}>
                  {getInitials(item.contactName || '', item.phoneNumber)}
                </Text>
              )}
            </View>
          </View>

          <View style={styles.callContent}>
            <View style={styles.topRow}>
              <View
                style={[
                  styles.nameRow,
                  // isRTL && { flexDirection: 'row-reverse' },
                ]}
              >
                <Text
                  style={[
                    styles.callerName,
                    { color: textColor },
                    isMissed && styles.missedCallName,
                    isRTL && { marginRight: 0, marginLeft: 4 },
                  ]}
                  numberOfLines={1}
                >
                  {displayName}
                </Text>
              </View>
            </View>
            <View
              style={[styles.subtitleRow, isRTL && { flexDirection: 'row' }]}
            >
              <Ionicons
                name={typeInfo.icon}
                size={14}
                color={typeInfo.color}
                style={isRTL ? { marginLeft: 6 } : { marginRight: 6 }}
              />
              <Text
                style={[
                  styles.phoneText,
                  { color: secondaryTextColor, writingDirection: 'ltr', flex: 1 },
                ]}
              >
                {item.phoneNumber
                  ? `\u200E${item.phoneNumber.replace(/[^\d\+\-\s\(\)]/g, '')}`
                  : ''}
              </Text>
              <View style={styles.timeContainer}>
                <Text style={[styles.timeText, { color: secondaryTextColor }]}>
                  {formatTime(item.lastTimestamp)}
                </Text>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>
      <View style={[styles.separator, { backgroundColor: colors.border }]} />
    </View>
  );
};

export default SwipeableCallItem;
