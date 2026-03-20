import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { SwipeableItemProps } from '../types';
import { styles, ACTION_WIDTH } from '../styles';
import {
  formatTime,
  getInitials,
  getAppIconName,
  getAppIconColor,
} from '../helper';

const SwipeableItem: React.FC<SwipeableItemProps> = React.memo(({
  item,
  onPress,
  onDelete,
  onMute,
  isRTL,
  colors,
  isDarkMode,
  isSelectMode,
  isSelected,
  onToggleSelect,
}) => {
  const translateX = useRef(new Animated.Value(0)).current;
  const [swiped, setSwiped] = useState(false);

  const handleSwipe = (direction: 'left' | 'right') => {
    const toValue = direction === 'left' ? -ACTION_WIDTH * 2 : ACTION_WIDTH * 2;
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

  // Dynamic styles based on theme
  const bgColor = colors.background;
  const avatarBgColor = colors.surfaceSecondary;
  const textColor = colors.text;
  const secondaryTextColor = colors.textSecondary;
  const separatorColor = colors.border;

  return (
    <View style={[styles.swipeContainer, { backgroundColor: bgColor }]}>
      {/* Actions Background - Right side for LTR, Left side for RTL */}
      {!isSelectMode && (
        <View
          style={[
            styles.actionsContainer,
            isRTL ? styles.actionsLeft : styles.actionsRight,
          ]}
        >
          <TouchableOpacity
            style={[styles.actionButton, styles.muteButton]}
            onPress={() => {
              onMute();
              resetSwipe();
            }}
          >
            <Ionicons name="notifications-off" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.deleteButton]}
            onPress={() => {
              onDelete();
            }}
          >
            <Ionicons name="trash" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      )}

      <Animated.View
        style={[
          styles.messageRow,
          {
            backgroundColor: bgColor,
            transform: [{ translateX: isSelectMode ? 0 : translateX }],
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

          {/* Avatar with Badge */}
          <View style={styles.avatarContainer}>
            <View style={[styles.avatar, { backgroundColor: avatarBgColor }]}>
              <Text style={[styles.avatarText, { color: textColor }]}>
                {getInitials(item.title)}
              </Text>
            </View>
            {item.unreadCount > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>
                  {item.unreadCount > 99 ? '99+' : item.unreadCount}
                </Text>
              </View>
            )}
          </View>

          {/* Content */}
          <View style={styles.messageContent}>
            <View style={styles.topRow}>
              <View style={styles.titleRow}>
                <Ionicons
                  name={getAppIconName(item.type, item.packageName)}
                  size={16}
                  color={getAppIconColor(item.type, item.packageName)}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[styles.senderName, { color: textColor }]}
                  numberOfLines={1}
                >
                  {item.title || 'Unknown'}
                </Text>
              </View>
              <View style={styles.timeContainer}>
                <Text style={[styles.timeText, { color: secondaryTextColor }]}>
                  {formatTime(item.lastTimestamp)}
                </Text>
                <Text style={[styles.chevron, { color: secondaryTextColor }]}>
                  ›
                </Text>
              </View>
            </View>
            <Text
              style={[styles.previewText, { color: secondaryTextColor }]}
              numberOfLines={2}
            >
              {item.lastText}
            </Text>
          </View>
        </TouchableOpacity>
      </Animated.View>
      <View
        style={[
          styles.separator,
          isRTL ? styles.separatorRTL : styles.separatorLTR,
          { backgroundColor: separatorColor },
        ]}
      />
    </View>
  );
});

export default SwipeableItem;
