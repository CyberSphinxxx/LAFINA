import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CheckSquare, Image as ImageIcon, Square } from 'lucide-react-native';
import { useTheme } from '../../../contexts/ThemeContext';
import type { ThemeColors } from '../../../contexts/ThemeContext';
import { noteBodyToMarkdown, parseNoteBlocks } from '../../../../utils';
import type { NoteBlock, NoteInline } from '../../../../utils';

/** How far one level of list nesting is pushed in. */
const INDENT = 16;

interface NoteBodyProps {
  /** A note body in either format; a desktop one is projected on the way in. */
  body: string;
  /** Caps a preview. Anything past it is replaced by a "more" line. */
  maxBlocks?: number;
  /** Given, checkboxes can be ticked; without it the note is read-only. */
  onToggleChecklist?: (index: number) => void;
  /** Card sizing rather than editor sizing. */
  compact?: boolean;
}

const spanStyle = (
  span: NoteInline,
  colors: ThemeColors
): Record<string, unknown> | undefined => {
  const style: Record<string, unknown> = {};
  if (span.bold) style.fontWeight = 'bold';
  if (span.italic) style.fontStyle = 'italic';
  if (span.highlight) {
    style.backgroundColor = colors.noteHighlightBg;
    style.color = colors.noteHighlightText;
  }
  if (span.code) {
    style.fontFamily = 'monospace';
    style.backgroundColor = colors.inputBg;
  }
  return Object.keys(style).length > 0 ? style : undefined;
};

const Spans: React.FC<{ spans: NoteInline[]; colors: ThemeColors }> = ({ spans, colors }) => (
  <>
    {spans.map((span, index) => (
      <Text key={index} style={spanStyle(span, colors)}>
        {span.text}
      </Text>
    ))}
  </>
);

/**
 * Draws a note the way the desktop editor does.
 *
 * Both apps store the same dialect, so a note written on the desktop has to
 * read as headings, quotes and lists here too rather than as its own markup.
 * Checklists are the reason this is a view tree and not one `Text`: a to-do
 * is only useful if it can be ticked.
 */
export const NoteBody: React.FC<NoteBodyProps> = ({
  body,
  maxBlocks,
  onToggleChecklist,
  compact = false,
}) => {
  const { colors } = useTheme();
  const blocks = useMemo(() => parseNoteBlocks(noteBodyToMarkdown(body)), [body]);

  const sizes = compact ? compactSizes : fullSizes;
  const shown = maxBlocks === undefined ? blocks : blocks.slice(0, maxBlocks);
  const hidden = blocks.length - shown.length;

  const renderBlock = (block: NoteBlock, key: number): React.ReactNode => {
    switch (block.kind) {
      case 'divider':
        return <View key={key} style={[styles.divider, { backgroundColor: colors.border }]} />;

      case 'image':
        return (
          <View key={key} style={styles.imageRow}>
            <ImageIcon size={compact ? 11 : 14} color={colors.textMuted} />
            <Text style={[sizes.body, styles.imageLabel, { color: colors.textMuted }]}>
              {block.alt || 'Image'}
            </Text>
          </View>
        );

      case 'heading':
        return (
          <Text
            key={key}
            style={[sizes.heading[block.level], { color: colors.textPrimary }]}
          >
            <Spans spans={block.spans} colors={colors} />
          </Text>
        );

      case 'quote':
        return (
          <View key={key} style={styles.quoteRow}>
            <View style={[styles.quoteBar, { backgroundColor: colors.border }]} />
            <Text style={[sizes.body, styles.quoteText, { color: colors.textSecondary }]}>
              <Spans spans={block.spans} colors={colors} />
            </Text>
          </View>
        );

      case 'bullet':
      case 'ordered':
        return (
          <View key={key} style={[styles.row, { marginLeft: block.depth * INDENT }]}>
            <Text style={[sizes.body, styles.marker, { color: colors.textMuted }]}>
              {block.kind === 'bullet' ? '•' : `${block.marker}.`}
            </Text>
            <Text style={[sizes.body, styles.flexText, { color: colors.textSecondary }]}>
              <Spans spans={block.spans} colors={colors} />
            </Text>
          </View>
        );

      case 'checklist': {
        const Box = block.checked ? CheckSquare : Square;
        const size = compact ? 13 : 18;
        const content = (
          <>
            <Box
              size={size}
              color={block.checked ? colors.success : colors.textMuted}
              style={styles.checkbox}
            />
            <Text
              style={[
                sizes.body,
                styles.flexText,
                { color: block.checked ? colors.textMuted : colors.textPrimary },
                block.checked && styles.done,
              ]}
            >
              <Spans spans={block.spans} colors={colors} />
            </Text>
          </>
        );
        const style = [styles.row, styles.checkRow, { marginLeft: block.depth * INDENT }];
        return onToggleChecklist ? (
          <TouchableOpacity
            key={key}
            style={style}
            activeOpacity={0.6}
            onPress={() => onToggleChecklist(block.index)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: block.checked }}
            accessibilityLabel={block.spans.map((span) => span.text).join('')}
          >
            {content}
          </TouchableOpacity>
        ) : (
          <View key={key} style={style}>
            {content}
          </View>
        );
      }

      default: {
        const text = block.spans.map((span) => span.text).join('');
        // A blank line is spacing between paragraphs, not an empty row.
        if (!text.trim()) return <View key={key} style={styles.blankLine} />;
        return (
          <Text key={key} style={[sizes.body, { color: colors.textSecondary }]}>
            <Spans spans={block.spans} colors={colors} />
          </Text>
        );
      }
    }
  };

  return (
    <View>
      {shown.map(renderBlock)}
      {hidden > 0 && (
        <Text style={[sizes.body, { color: colors.textMuted }]}>
          {`+${hidden} more line${hidden === 1 ? '' : 's'}`}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  checkRow: { paddingVertical: 2 },
  checkbox: { marginTop: 2, marginRight: 8 },
  marker: { marginRight: 6 },
  flexText: { flex: 1 },
  done: { textDecorationLine: 'line-through' },
  divider: { height: 1, marginVertical: 8 },
  quoteRow: { flexDirection: 'row', alignItems: 'stretch', marginVertical: 2 },
  quoteBar: { width: 3, borderRadius: 2, marginRight: 8 },
  quoteText: { flex: 1, fontStyle: 'italic' },
  imageRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  imageLabel: { marginLeft: 6, fontStyle: 'italic' },
  blankLine: { height: 6 },
});

const compactText = StyleSheet.create({
  body: { fontFamily: 'sans-serif', fontSize: 12, lineHeight: 16 },
  h1: { fontFamily: 'sans-serif-medium', fontSize: 14, fontWeight: 'bold', marginBottom: 2 },
  h2: { fontFamily: 'sans-serif-medium', fontSize: 13, fontWeight: 'bold', marginBottom: 2 },
  h3: { fontFamily: 'sans-serif-medium', fontSize: 12, fontWeight: 'bold', marginBottom: 2 },
});

const fullText = StyleSheet.create({
  body: { fontFamily: 'sans-serif', fontSize: 15, lineHeight: 22 },
  h1: { fontFamily: 'sans-serif-medium', fontSize: 22, fontWeight: 'bold', marginTop: 8, marginBottom: 4 },
  h2: { fontFamily: 'sans-serif-medium', fontSize: 18, fontWeight: 'bold', marginTop: 8, marginBottom: 4 },
  h3: { fontFamily: 'sans-serif-medium', fontSize: 15, fontWeight: 'bold', marginTop: 6, marginBottom: 2 },
});

const compactSizes = {
  body: compactText.body,
  heading: { 1: compactText.h1, 2: compactText.h2, 3: compactText.h3 },
};

const fullSizes = {
  body: fullText.body,
  heading: { 1: fullText.h1, 2: fullText.h2, 3: fullText.h3 },
};
