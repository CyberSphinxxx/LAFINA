import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { FilePlus2, Lock, Send, X } from 'lucide-react-native';
import { Colors, Fonts, Shadows, useThemedStyles } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeColors } from '../../contexts/ThemeContext';

interface ChatInputProps {
  inputText: string;
  setInputText: (text: string) => void;
  onSend: () => void;
  isKeyboardVisible: boolean;
  /** Opens the file formats (and the Student Handbook switch). Absent hides the button. */
  onOpenFiles?: () => void;
  /** Creating files needs Student Pro; the button says so instead of hiding. */
  filesLocked?: boolean;
  /** The format picked for the next message, e.g. "PDF". */
  fileLabel?: string | null;
  onClearFile?: () => void;
  isSending?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  inputText,
  setInputText,
  onSend,
  isKeyboardVisible,
  onOpenFiles,
  filesLocked = false,
  fileLabel = null,
  onClearFile,
  isSending = false,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);

  return (
    <View style={[
      styles.inputContainer,
      themed.inputContainer,
      { bottom: isKeyboardVisible ? 0 : 104 }
    ]}>
      {fileLabel ? (
        <View style={[styles.chip, themed.chip]}>
          <Text style={[styles.chipText, themed.chipText]}>Creating a {fileLabel} file</Text>
          <TouchableOpacity
            onPress={onClearFile}
            accessibilityRole="button"
            accessibilityLabel={`Don't create a ${fileLabel} file`}
            hitSlop={8}
          >
            <X size={14} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={styles.row}>
        {onOpenFiles ? (
          <TouchableOpacity
            onPress={onOpenFiles}
            style={styles.fileBtn}
            disabled={isSending}
            accessibilityRole="button"
            accessibilityLabel={filesLocked ? 'Create a file (Student Pro)' : 'Create a file'}
            hitSlop={6}
          >
            <FilePlus2 size={22} color={fileLabel ? colors.red : colors.textSecondary} />
            {filesLocked ? (
              <View style={[styles.lockBadge, themed.lockBadge]}>
                <Lock size={9} color={colors.white} />
              </View>
            ) : null}
          </TouchableOpacity>
        ) : null}
        <TextInput
          style={[styles.input, themed.input]}
          placeholder={fileLabel ? `Describe the ${fileLabel} file you want…` : 'Ask LAFINA...'}
          placeholderTextColor={colors.textSecondary}
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={onSend}
          returnKeyType="send"
        />
        <TouchableOpacity
          onPress={onSend}
          style={[styles.sendBtn, Shadows.micButton, isSending && styles.sendDisabled]}
          disabled={isSending}
          accessibilityRole="button"
          accessibilityLabel={fileLabel ? `Create ${fileLabel} file` : 'Send message'}
        >
          <Send size={18} color={colors.white} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  inputContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    position: 'absolute',
    left: 0,
    right: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 8,
    gap: 6,
  },
  chipText: {
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  fileBtn: {
    width: 36,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  lockBadge: {
    position: 'absolute',
    right: 2,
    bottom: 6,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    fontSize: 14,
    fontFamily: Fonts.body,
    marginRight: 10,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {
    opacity: 0.5,
  },
});

const getThemedStyles = (colors: ThemeColors) => ({
  inputContainer: {
    backgroundColor: colors.cardBg,
    borderTopColor: colors.border,
  },
  input: {
    borderColor: colors.border,
    backgroundColor: colors.inputBg,
    color: colors.textPrimary,
  },
  chip: {
    borderColor: colors.red,
    backgroundColor: colors.inputBg,
  },
  chipText: {
    color: colors.textPrimary,
  },
  lockBadge: {
    backgroundColor: colors.textMuted,
  },
});
