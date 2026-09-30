import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import type { Flashcard } from '../../../utils';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, FontSize, Layout, Spacing } from '../../theme';
import { ToolSheet } from '../../components/tools';

/** The same limits the desktop editor and the sync API use. */
const MAX_QUESTION = 500;
const MAX_ANSWER = 2000;

interface CardEditModalProps {
  card: Flashcard | null;
  onSave: (card: Flashcard) => void;
  onCancel: () => void;
}

/** Rewrites one card; both sides are required. */
export const CardEditModal: React.FC<CardEditModalProps> = ({ card, onSave, onCancel }) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');

  useEffect(() => {
    if (!card) return;
    setQuestion(card.question);
    setAnswer(card.answer);
  }, [card]);

  const complete = question.trim().length > 0 && answer.trim().length > 0;

  return (
    <ToolSheet
      visible={card !== null}
      title="Edit card"
      onClose={onCancel}
      footer={
        <>
          <TouchableOpacity style={styles.footerButton} onPress={onCancel} accessibilityRole="button">
            <Text style={[styles.footerLabel, themed.textSecondary]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.footerButton, complete ? themed.save : themed.saveDisabled]}
            onPress={() => onSave({ question: question.trim(), answer: answer.trim() })}
            disabled={!complete}
            accessibilityRole="button"
            accessibilityState={{ disabled: !complete }}
          >
            <Text style={[styles.footerLabel, themed.onAccent]}>Save</Text>
          </TouchableOpacity>
        </>
      }
    >
      <Text style={[styles.label, themed.textSecondary]}>Question</Text>
      <TextInput
        style={[styles.input, themed.input]}
        value={question}
        onChangeText={setQuestion}
        maxLength={MAX_QUESTION}
        multiline
        placeholder="What should you be able to answer?"
        placeholderTextColor={colors.placeholder}
        accessibilityLabel="Question"
      />
      <Text style={[styles.count, themed.textMuted]}>
        {question.length} / {MAX_QUESTION}
      </Text>
      <Text style={[styles.label, themed.textSecondary]}>Answer</Text>
      <TextInput
        style={[styles.input, styles.answer, themed.input]}
        value={answer}
        onChangeText={setAnswer}
        maxLength={MAX_ANSWER}
        multiline
        placeholder="The answer, in a sentence or two"
        placeholderTextColor={colors.placeholder}
        accessibilityLabel="Answer"
      />
      <Text style={[styles.count, themed.textMuted]}>
        {answer.length} / {MAX_ANSWER}
      </Text>
    </ToolSheet>
  );
};

const getThemedStyles = (colors: ThemeColors) => ({
  textSecondary: { color: colors.textSecondary },
  textMuted: { color: colors.textMuted },
  onAccent: { color: colors.white },
  input: { backgroundColor: colors.inputBg, borderColor: colors.border, color: colors.textPrimary },
  save: { backgroundColor: colors.red },
  saveDisabled: { backgroundColor: colors.textMuted },
});

const styles = StyleSheet.create({
  label: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.small,
    fontWeight: 'bold',
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderRadius: Layout.borderRadiusButton,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  answer: {
    minHeight: 120,
  },
  count: {
    alignSelf: 'flex-end',
    fontFamily: Fonts.body,
    fontSize: FontSize.caption,
    marginTop: 2,
  },
  footerButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Layout.borderRadiusPill,
    marginLeft: Spacing.sm,
  },
  footerLabel: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.body,
    fontWeight: 'bold',
  },
});
