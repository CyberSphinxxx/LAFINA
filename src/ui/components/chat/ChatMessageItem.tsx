import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { BookOpen, FileSpreadsheet, FileText, Presentation, Share2 } from 'lucide-react-native';
import { Colors, Fonts, Shadows, useThemedStyles } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeColors } from '../../contexts/ThemeContext';
import type { ChatAttachment, ChatMessage } from '../../../storage/chatStore';
import { DOCUMENT_FORMATS, formatFileSize, isDocumentFormat } from '../../../skills/documentSkill';
import type { DocumentFormat } from '../../../skills/documentSkill';

const FORMAT_ICONS: Record<DocumentFormat, React.ComponentType<{ size: number; color: string }>> = {
  pdf: FileText,
  docx: FileText,
  xlsx: FileSpreadsheet,
  pptx: Presentation,
};

interface ChatMessageItemProps {
  item: ChatMessage;
  /** "Handbook p. 32" when the reply was grounded in the USTP Student Handbook. */
  handbookNote?: string | null;
  onOpenAttachment?: (attachment: ChatAttachment) => void;
}

export const ChatMessageItem: React.FC<ChatMessageItemProps> = ({ item, handbookNote, onOpenAttachment }) => {
  const isUser = item.sender === 'user';
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);
  const attachment = item.attachment;
  const format = attachment && isDocumentFormat(attachment.format) ? attachment.format : null;
  const AttachmentIcon = format ? FORMAT_ICONS[format] : FileText;

  return (
    <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
      <View style={[
        styles.bubble,
        isUser ? styles.userBubble : [styles.assistantBubble, themed.assistantBubble]
      ]}>
        <Text style={[
          styles.messageText,
          isUser ? styles.userText : [styles.assistantText, themed.assistantText]
        ]}>
          {item.content}
        </Text>
        {attachment ? (
          <TouchableOpacity
            style={[styles.fileCard, themed.fileCard]}
            onPress={() => onOpenAttachment?.(attachment)}
            accessibilityRole="button"
            accessibilityLabel={`Open or share ${attachment.fileName}`}
          >
            <AttachmentIcon size={22} color={colors.red} />
            <View style={styles.fileBody}>
              <Text style={[styles.fileName, themed.assistantText]} numberOfLines={1}>
                {attachment.fileName}
              </Text>
              <Text style={[styles.fileMeta, themed.assistantTime]}>
                {[format ? DOCUMENT_FORMATS[format].label : null, formatFileSize(attachment.sizeBytes)]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            <Share2 size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
        <View style={styles.footer}>
          {handbookNote ? (
            <View
              style={[styles.handbookChip, themed.handbookChip]}
              accessibilityLabel={`Answered from the USTP Student Handbook, ${handbookNote.replace(/^Handbook /, '')}`}
            >
              <BookOpen size={10} color={colors.blue} />
              <Text style={[styles.handbookText, themed.handbookText]}>{handbookNote}</Text>
            </View>
          ) : null}
          <Text style={[
            styles.timeText,
            isUser ? styles.userTime : [styles.assistantTime, themed.assistantTime]
          ]}>
            {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  messageRow: {
    flexDirection: 'row',
    marginVertical: 6,
    width: '100%',
  },
  userRow: {
    justifyContent: 'flex-end',
  },
  assistantRow: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    ...Shadows.card,
  },
  userBubble: {
    backgroundColor: Colors.blue,
    borderBottomRightRadius: 2,
  },
  assistantBubble: {
    borderBottomLeftRadius: 2,
    borderWidth: 1,
  },
  messageText: {
    fontSize: 14,
    fontFamily: Fonts.body,
    lineHeight: 20,
  },
  userText: {
    color: '#FFFFFF',
  },
  assistantText: {
    // Handled by themed styles
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
  },
  fileBody: {
    flex: 1,
    marginHorizontal: 10,
  },
  fileName: {
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  fileMeta: {
    fontSize: 11,
    fontFamily: Fonts.body,
    marginTop: 1,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    marginTop: 4,
    gap: 6,
  },
  handbookChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    gap: 3,
  },
  handbookText: {
    fontSize: 9,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  timeText: {
    fontSize: 9,
    fontFamily: Fonts.body,
  },
  userTime: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  assistantTime: {
    // Handled by themed styles
  },
});

const getThemedStyles = (colors: ThemeColors) => ({
  assistantBubble: {
    backgroundColor: colors.cardBg,
    borderColor: colors.border,
  },
  assistantText: {
    color: colors.textPrimary,
  },
  assistantTime: {
    color: colors.textMuted,
  },
  fileCard: {
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
  },
  handbookChip: {
    borderColor: colors.blue,
  },
  handbookText: {
    color: colors.blue,
  },
});
