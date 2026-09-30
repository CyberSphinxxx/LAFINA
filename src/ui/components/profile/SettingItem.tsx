import React, { useRef } from 'react';
import { View, Text, Switch, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Fonts, useThemedStyles } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeColors } from '../../contexts/ThemeContext';

/** Where a toggle was touched (pageX, pageY), or null when it changed without a touch. */
export interface ToggleOrigin {
  x: number;
  y: number;
}

interface SettingItemProps {
  text: string;
  type?: 'toggle' | 'link' | 'value' | 'clickable';
  value?: boolean;
  onValueChange?: (val: boolean, origin: ToggleOrigin | null) => void;
  valueText?: string;
  onPress?: () => void;
  isDestructive?: boolean;
}

export const SettingItem: React.FC<SettingItemProps> = ({
  text,
  type = 'link',
  value,
  onValueChange,
  valueText,
  onPress,
  isDestructive = false,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);
  const touchRef = useRef<ToggleOrigin | null>(null);

  if (type === 'toggle') {
    return (
      <View style={styles.settingItem}>
        <Text style={[styles.settingText, themed.settingText]}>{text}</Text>
        {/* The touch point, for effects that start where the switch was pressed (the theme reveal). */}
        <View
          onTouchStart={(event) => {
            touchRef.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
          }}
        >
          <Switch
            value={value}
            onValueChange={(next) => {
              const origin = touchRef.current;
              touchRef.current = null;
              onValueChange?.(next, origin);
            }}
            trackColor={{ false: '#767577', true: colors.red }}
            thumbColor={Platform.OS === 'android' ? '#FFF' : undefined}
          />
        </View>
      </View>
    );
  }

  if (type === 'value') {
    return (
      <View style={styles.settingItem}>
        <Text style={[styles.settingText, themed.settingText]}>{text}</Text>
        <Text style={[styles.settingValue, themed.settingValue]}>{valueText}</Text>
      </View>
    );
  }

  if (type === 'clickable') {
    return (
      <TouchableOpacity
        onPress={onPress}
        style={styles.settingItemClickable}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.settingText,
            themed.settingText,
            isDestructive && { color: colors.error, fontWeight: 'bold' }
          ]}
        >
          {text}
        </Text>
      </TouchableOpacity>
    );
  }

  // Default: 'link'
  return (
    <TouchableOpacity
      style={styles.settingItem}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.settingText, themed.settingText]}>{text}</Text>
      {valueText && <Text style={[styles.linkValue, themed.settingValue]}>{valueText}</Text>}
      <Text style={[styles.linkArrow, themed.linkArrow]}>➔</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  settingItemClickable: {
    paddingVertical: 14,
  },
  settingText: {
    fontSize: 14,
    fontFamily: Fonts.body,
    flex: 1,
    marginRight: 8,
  },
  settingValue: {
    fontSize: 12,
  },
  linkValue: {
    fontSize: 11,
    marginLeft: 'auto',
    marginRight: 8,
  },
  linkArrow: {
    fontSize: 12,
  },
});

const getThemedStyles = (colors: ThemeColors) => ({
  settingText: {
    color: colors.textPrimary,
  },
  settingValue: {
    color: colors.textSecondary,
  },
  linkArrow: {
    color: colors.textMuted,
  },
});
