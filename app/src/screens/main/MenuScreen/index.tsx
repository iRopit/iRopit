import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  Switch,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { Container } from '../../../components';
import { styles } from './styles';
import { getInitials } from './helper';
import { MenuScreenProps } from './types';
import { useMenuScreen } from './useMenuScreen';
import { APP_VERSION } from '../../../constants';

const MenuScreen = ({ navigation }: MenuScreenProps) => {
  const {
    user,
    settings,
    menuSections,
    colors,
    t,
    isDarkMode,
    isRTL,
    bgColor,
    textColor,
    saveAndSync,
    navigateToUserSettings,
  } = useMenuScreen(navigation);

  return (
    <Container
      isDark={isDarkMode}
      noPaddingHorizontal
      backgroundColor={bgColor}
      edges={['top', 'left', 'right']}
    >
      {/* Title like Notifications Screen */}
      <View style={styles.titleContainer}>
        <Text style={[styles.title, { color: textColor }]}>
          {t('menuTitle')}
        </Text>
      </View>

      <ScrollView style={styles.content}>
        {/* Profile Header - Improved Design */}
        <TouchableOpacity
          style={[styles.profileHeader, { backgroundColor: colors.surface }]}
          onPress={navigateToUserSettings}
          activeOpacity={0.7}
        >
          {user?.photoURL ? (
            <Image
              source={{ uri: user.photoURL }}
              style={styles.profileImage}
            />
          ) : (
            <View
              style={[styles.profileImage, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.profileInitials}>
                {getInitials(user?.displayName || 'User')}
              </Text>
            </View>
          )}

          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: colors.text }]}>
              {user?.displayName || 'iRopit User'}
            </Text>
            <Text
              style={[styles.profileEmail, { color: colors.textSecondary }]}
            >
              {user?.email}
            </Text>
          </View>

          <Icon
            name={isRTL ? 'chevron-back' : 'chevron-forward'}
            size={20}
            color={colors.textSecondary}
          />
        </TouchableOpacity>

        {/* Menu Sections */}
        {menuSections.map((section, sectionIndex) => (
          <View key={sectionIndex}>
            <Text
              style={[styles.sectionTitle, { color: colors.textSecondary }]}
            >
              {section.title}
            </Text>

            <View style={[styles.section, { backgroundColor: colors.surface }]}>
              {section.items.map((item: any, itemIndex: number) => (
                <TouchableOpacity
                  key={itemIndex}
                  style={[
                    styles.menuItem,
                    { borderBottomColor: colors.border },
                    itemIndex === section.items.length - 1 && styles.lastItem,
                  ]}
                  onPress={item.isSwitch ? undefined : item.onPress}
                  activeOpacity={item.isSwitch ? 1 : 0.7}
                >
                  <Icon
                    name={item.icon}
                    size={24}
                    color={
                      item.iconColor ||
                      (item.danger ? colors.error : colors.primary)
                    }
                    style={styles.menuIcon}
                  />

                  <View style={styles.menuContent}>
                    <Text
                      style={[
                        styles.menuTitle,
                        { color: item.danger ? colors.error : colors.text },
                      ]}
                    >
                      {item.title}
                    </Text>
                    {item.subtitle && !item.isSwitch && (
                      <Text
                        style={[
                          styles.menuSubtitle,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {item.subtitle}
                      </Text>
                    )}
                  </View>

                  {item.isSwitch ? (
                    <Switch
                      value={item.value}
                      onValueChange={val => saveAndSync(item.settingKey, val)}
                      trackColor={{
                        false: colors.border,
                        true: colors.primary,
                      }}
                      thumbColor={
                        item.value ? colors.white : colors.surfaceTertiary
                      }
                    />
                  ) : (
                    <Icon
                      name={isRTL ? 'chevron-back' : 'chevron-forward'}
                      size={20}
                      color={colors.textSecondary}
                    />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

      </ScrollView>

      <Text style={[styles.version, { color: colors.textSecondary, paddingBottom: 12 }]}>
        {`iRopit v${APP_VERSION}`}
      </Text>
    </Container>
  );
};

export default MenuScreen;
