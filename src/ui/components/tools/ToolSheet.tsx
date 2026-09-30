import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, FontSize, Layout, Spacing } from '../../theme';

interface ToolSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Pinned below the scrolling content, e.g. Save / Cancel. */
  footer?: React.ReactNode;
}

/** A bottom sheet for the tool screens' settings, history and editors. */
export const ToolSheet: React.FC<ToolSheetProps> = ({ visible, title, onClose, children, footer }) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.backdrop, themed.backdrop]}>
        <Pressable style={styles.dismissArea} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, themed.sheet]}>
          <View style={styles.header}>
            <Text style={[styles.title, themed.title]} accessibilityRole="header">
              {title}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
            >
              <X size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={[styles.footer, themed.footer]}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
};

const getThemedStyles = (colors: ThemeColors) => ({
  backdrop: { backgroundColor: colors.overlay },
  sheet: { backgroundColor: colors.background },
  title: { color: colors.textPrimary },
  footer: { borderTopColor: colors.divider },
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
  },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: Layout.borderRadiusCard + 4,
    borderTopRightRadius: Layout.borderRadiusCard + 4,
    paddingTop: Spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.sm,
  },
  title: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.title,
    fontWeight: 'bold',
  },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
