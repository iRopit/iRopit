import Icon from 'react-native-vector-icons/Ionicons';
import React, { useRef, useEffect } from 'react';
import { View, Text, Animated, PanResponder, Linking } from 'react-native';
import { AppNotification } from '../../../../services/notificationService';
import { styles } from '../styles';
import { formatTime } from '../helper';
import { LIGHT_COLORS } from '../../../../theme/colors';

interface MessageBubbleProps {
  item: AppNotification;
  onDelete: (id: string) => void;
  isRTL: boolean;
  textColor: string;
  secondaryTextColor: string;
  bubbleColor: string;
  bgColor: string;
  primaryColor?: string;
  textInverseColor?: string;
}

const MessageBubble: React.FC<MessageBubbleProps> = React.memo(({
  item,
  onDelete,
  isRTL,
  textColor,
  secondaryTextColor,
  bubbleColor,
  bgColor,
  primaryColor = LIGHT_COLORS.primary,
  textInverseColor = LIGHT_COLORS.textInverse,
}) => {
  const isSent = item.smsType === 'sent';
  const translateX = useRef(new Animated.Value(0)).current;
  const swipeThreshold = 100;
  const maxSwipe = 100;

  const onDeleteRef = useRef(onDelete);
  const isRTLRef = useRef(isRTL);
  const itemIdRef = useRef(item.id);

  useEffect(() => {
    onDeleteRef.current = onDelete;
    isRTLRef.current = isRTL;
    itemIdRef.current = item.id;
  }, [onDelete, isRTL, item.id]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 10;
      },
      onPanResponderMove: (_, gestureState) => {
        if (isRTLRef.current) {
          if (gestureState.dx > 0)
            translateX.setValue(Math.min(gestureState.dx, maxSwipe));
        } else {
          if (gestureState.dx < 0)
            translateX.setValue(Math.max(gestureState.dx, -maxSwipe));
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        const shouldDelete = isRTLRef.current
          ? gestureState.dx > swipeThreshold
          : gestureState.dx < -swipeThreshold;

        if (shouldDelete) {
          Animated.timing(translateX, {
            toValue: isRTLRef.current ? 400 : -400,
            duration: 200,
            useNativeDriver: true,
          }).start(() => onDeleteRef.current(itemIdRef.current));
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  const renderTextWithLinks = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const phoneRegex = /(\d{10,})/g;

    const parts = text.split(urlRegex);

    return parts.map((part, index) => {
      if (urlRegex.test(part)) {
        return (
          <Text
            key={index}
            style={styles.linkText}
            onPress={() => Linking.openURL(part)}
          >
            {part}
          </Text>
        );
      }

      const phoneParts = part.split(phoneRegex);
      return phoneParts.map((phonePart, phoneIndex) => {
        if (phoneRegex.test(phonePart)) {
          return (
            <Text
              key={`${index}-${phoneIndex}`}
              style={styles.linkText}
              onPress={() => Linking.openURL(`tel:${phonePart}`)}
            >
              {phonePart}
            </Text>
          );
        }
        return <Text key={`${index}-${phoneIndex}`}>{phonePart}</Text>;
      });
    });
  };

  return (
    <View style={styles.bubbleContainer}>
      <View
        style={[styles.deleteBackground, isRTL ? { left: 0 } : { right: 0 }]}
      >
        <Icon name="trash" size={24} color="#FFFFFF" />
      </View>
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.bubbleWrapper,
          { transform: [{ translateX }], backgroundColor: bgColor },
        ]}
      >
        <View style={[styles.timeLabelRow, isSent && styles.timeLabelRowRight]}>
          <Text
            style={[
              styles.timeLabel,
              { color: secondaryTextColor },
            ]}
          >
            {formatTime(item.timestamp)}
          </Text>
          {item.simSlot != null && item.simSlot >= 0 && (
            <View style={[styles.simBadge, item.simSlot === 0 ? styles.simBadge0 : styles.simBadge1]}>
              <Text style={styles.simBadgeText}>SIM{item.simSlot + 1}</Text>
            </View>
          )}
        </View>
        <View
          style={[
            styles.bubble,
            { backgroundColor: isSent ? primaryColor : bubbleColor },
            isSent && styles.bubbleSent,
          ]}
        >
          <Text
            style={[
              styles.bubbleText,
              { color: isSent ? textInverseColor : textColor },
            ]}
          >
            {renderTextWithLinks(item.text)}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
});

export default MessageBubble;
