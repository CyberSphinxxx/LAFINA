import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Search } from 'lucide-react-native';
import { formatTimestamp, wordCount } from '../../../meetings';
import type { TranscriptSegment } from '../../../meetings';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, Spacing } from '../../theme';
import { getMeetingThemedStyles, meetingStyles } from './meetingStyles';

/** Lines drawn at once; a search narrows a long meeting to what matters. */
const PAGE = 300;

/**
 * What Whisper actually heard, line by line, so the notes can be checked
 * against their source and a mis-heard name spotted before it is trusted.
 */
export const TranscriptList: React.FC<{
  segments: TranscriptSegment[];
  language: string | null;
  model: string | null;
}> = ({ segments, language, model }) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getMeetingThemedStyles);
  const [query, setQuery] = useState('');
  const hours = segments.some((segment) => segment.startMs >= 3_600_000);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? segments.filter((segment) => segment.text.toLowerCase().includes(needle)) : segments;
  }, [segments, query]);

  if (!segments.length) {
    return (
      <Text style={[meetingStyles.body, styles.empty, themed.textSecondary]}>
        There is no transcript for this meeting yet.
      </Text>
    );
  }

  return (
    <View>
      <View style={[meetingStyles.row, meetingStyles.input, themed.input, styles.search]}>
        <Search size={16} color={colors.textMuted} />
        <TextInput
          style={[meetingStyles.body, styles.searchInput, themed.textPrimary]}
          placeholder="Search the transcript"
          placeholderTextColor={colors.placeholder}
          value={query}
          onChangeText={setQuery}
          accessibilityLabel="Search the transcript"
        />
      </View>
      <Text style={[meetingStyles.small, styles.meta, themed.textMuted]}>
        {wordCount(segments).toLocaleString()} words
        {language ? ` · ${language.toUpperCase()}` : ''}
        {model ? ` · Whisper ${model}` : ''}
        {query ? ` · ${shown.length} matching line${shown.length === 1 ? '' : 's'}` : ''}
      </Text>
      <View style={[meetingStyles.card, themed.card]}>
        {shown.slice(0, PAGE).map((segment, index) => (
          <View key={`${segment.startMs}-${index}`} style={styles.line}>
            <Text style={[meetingStyles.small, styles.time, themed.accent]}>
              {formatTimestamp(segment.startMs, hours)}
            </Text>
            <Text style={[meetingStyles.body, styles.text, themed.textPrimary]} selectable>
              {segment.text}
            </Text>
          </View>
        ))}
        {shown.length > PAGE && (
          <Text style={[meetingStyles.small, themed.textMuted]}>
            Showing the first {PAGE} of {shown.length} lines. Search to find a moment, or share the transcript to
            read it all.
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  empty: {
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
  search: {
    paddingVertical: 0,
  },
  searchInput: {
    flex: 1,
    marginLeft: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  meta: {
    marginBottom: Spacing.sm,
  },
  line: {
    flexDirection: 'row',
    marginBottom: Spacing.sm,
  },
  time: {
    width: 64,
    fontFamily: Fonts.heading,
    fontVariant: ['tabular-nums'],
    paddingTop: 2,
  },
  text: {
    flex: 1,
  },
});
