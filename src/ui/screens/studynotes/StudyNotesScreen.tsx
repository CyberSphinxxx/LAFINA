import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { BookOpen, FileUp, NotebookPen, Share2, Trash2 } from 'lucide-react-native';
import { notesStore, studyNoteStore } from '../../../storage';
import type { StudySummaryRecord } from '../../../storage';
import { generateId } from '../../../utils';
import { hasProEntitlement } from '../../../cloud';
import {
  describeStudyNotesFailure,
  MAX_DOCUMENT_BYTES,
  studyNotesSkill,
} from '../../../skills/studyNotesSkill';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, FontSize, Layout, Shadows, Spacing } from '../../theme';
import {
  formatWhen,
  MIME_DOCX,
  MIME_PDF,
  MIME_PPTX,
  pickDocument,
  ProFeaturePanel,
  shareTextFile,
  ToolScreenHeader,
  useToolBack,
} from '../../components/tools';
import type { RegisterToolBack } from '../../components/tools';

export const KIND_LABEL: Record<string, string> = {
  pdf: 'PDF',
  docx: 'Word',
  pptx: 'PowerPoint',
};

/** A filename every platform accepts, derived from the title. */
export const summaryFileName = (title: string): string => {
  const safe = (title || 'study-notes')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${safe || 'study-notes'}.md`;
};

interface StudyNotesScreenProps {
  userId: string;
  refreshTrigger: number;
  onRefresh: () => void;
  onBack: () => void;
  registerBack?: RegisterToolBack;
}

/**
 * Summarises a lecture document into revision notes: an overview, the points
 * under each heading, and the terms worth knowing. The result stays here (and
 * on the student's other devices), can go into Notes, or can be shared.
 */
export const StudyNotesScreen: React.FC<StudyNotesScreenProps> = ({
  userId,
  refreshTrigger,
  onRefresh,
  onBack,
  registerBack,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);
  const entitled = hasProEntitlement(userId);

  const [summaries, setSummaries] = useState<StudySummaryRecord[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [savedToNotes, setSavedToNotes] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadSummaries = useCallback(() => {
    if (!entitled) {
      setSummaries([]);
      return;
    }
    const stored = studyNoteStore.getSummaries(userId);
    setSummaries(stored);
    setOpenId((current) => (current && stored.some((summary) => summary.id === current) ? current : null));
  }, [userId, entitled]);

  useEffect(() => {
    loadSummaries();
  }, [loadSummaries, refreshTrigger]);

  const open = useMemo(
    () => summaries.find((summary) => summary.id === openId) ?? null,
    [summaries, openId]
  );

  const closeSummary = useCallback((): boolean => {
    setOpenId(null);
    setSavedToNotes(null);
    return true;
  }, []);
  useToolBack(registerBack, openId ? closeSummary : null);

  const handleChooseDocument = async (): Promise<void> => {
    if (busy) return;
    setError('');
    const picked = await pickDocument([MIME_PDF, MIME_DOCX, MIME_PPTX], MAX_DOCUMENT_BYTES);
    if (picked.kind === 'cancelled') return;
    if (picked.kind === 'error') {
      setError(picked.message);
      return;
    }

    const sourceName = picked.document.name;
    setBusy(true);
    setProgress('Reading the document…');
    const stageTimer = setTimeout(() => {
      if (mounted.current) setProgress('Writing your notes…');
    }, 6000);

    try {
      const result = await studyNotesSkill.summarizeDocument({
        filename: sourceName,
        base64: picked.document.base64,
      });
      if (result.status !== 'success' || !result.data) {
        if (mounted.current) setError(describeStudyNotesFailure(result));
        return;
      }
      const id = generateId('summary');
      studyNoteStore.save({
        id,
        userId,
        title: result.data.title || sourceName,
        sourceName,
        sourceKind: result.data.sourceKind,
        overview: result.data.overview,
        sections: result.data.sections,
        keyTerms: result.data.keyTerms,
        markdown: result.data.markdown,
        pageCount: result.data.pagesRead,
        warnings: result.data.warnings,
      });
      onRefresh();
      if (!mounted.current) return;
      loadSummaries();
      setOpenId(id);
    } catch (summaryError) {
      console.error('[StudyNotes] Summary failed:', summaryError);
      if (mounted.current) setError('Study notes could not be made from that document.');
    } finally {
      clearTimeout(stageTimer);
      if (mounted.current) {
        setBusy(false);
        setProgress('');
      }
    }
  };

  const saveToNotes = (summary: StudySummaryRecord): void => {
    try {
      notesStore.insert({
        id: generateId('note'),
        userId,
        title: summary.title,
        // Mobile notes are the light markdown dialect; the desktop turns this
        // into rich text when it opens the note.
        body: summary.markdown,
        category: 'Learning',
        isPinned: false,
        tags: ['Study notes'],
        isVoiceTranscribed: false,
      });
      setSavedToNotes(summary.id);
      onRefresh();
    } catch (noteError) {
      console.error('[StudyNotes] Could not save to Notes:', noteError);
      setError('These notes could not be saved to Notes.');
    }
  };

  const handleExport = async (summary: StudySummaryRecord): Promise<void> => {
    const outcome = await shareTextFile({
      fileName: summaryFileName(summary.title),
      contents: summary.markdown,
      title: 'Share study notes',
      mimeType: 'text/markdown',
    });
    if (outcome === 'failed') setError('These notes could not be shared.');
  };

  const confirmDelete = (summary: StudySummaryRecord): void => {
    Alert.alert(
      'Delete study notes',
      `Delete the notes for “${summary.title}”? They are removed from your other devices too. Anything saved into Notes or shared is untouched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            studyNoteStore.remove(summary.id);
            setOpenId(null);
            loadSummaries();
            onRefresh();
          },
        },
      ]
    );
  };

  if (!entitled) {
    return (
      <View style={styles.container}>
        <ToolScreenHeader title="Study Notes" subtitle="Revision notes from your lectures" onBack={onBack} />
        <ProFeaturePanel
          feature="Study Notes"
          description="Upload a PDF, Word file or slide deck and LAFINA writes revision notes: an overview, the key points under each heading, and the terms worth knowing. The document is read by the LAFINA server, which is why this one needs the plan."
        />
      </View>
    );
  }

  if (open) {
    return (
      <View style={styles.container}>
        <ToolScreenHeader
          title={open.title}
          subtitle={`${KIND_LABEL[open.sourceKind] ?? 'Document'} · ${open.pageCount} page${
            open.pageCount === 1 ? '' : 's'
          } · ${formatWhen(open.createdAt)}`}
          onBack={closeSummary}
          actions={[
            { key: 'share', label: 'Share as Markdown', icon: Share2, onPress: () => void handleExport(open) },
            { key: 'delete', label: 'Delete these notes', icon: Trash2, onPress: () => confirmDelete(open) },
          ]}
        />
        <ScrollView contentContainerStyle={styles.listContent}>
          <TouchableOpacity
            style={[styles.primaryButton, themed.primaryButton, savedToNotes === open.id && styles.disabled]}
            onPress={() => saveToNotes(open)}
            disabled={savedToNotes === open.id}
            accessibilityRole="button"
          >
            <NotebookPen size={18} color={colors.white} />
            <Text style={[styles.primaryLabel, themed.onAccent]}>
              {savedToNotes === open.id ? 'Saved to Notes' : 'Save to Notes'}
            </Text>
          </TouchableOpacity>
          {error ? <Text style={[styles.error, themed.error]}>{error}</Text> : null}
          {open.warnings.map((warning) => (
            <Text key={warning} style={[styles.warning, themed.warning]}>
              {warning}
            </Text>
          ))}
          {open.overview ? (
            <View style={[styles.block, themed.card]}>
              <Text style={[styles.blockTitle, themed.textPrimary]}>Overview</Text>
              <Text style={[styles.body, themed.textPrimary]}>{open.overview}</Text>
            </View>
          ) : null}
          {open.sections.map((section, sectionIndex) => (
            <View key={`${sectionIndex}-${section.heading}`} style={[styles.block, themed.card]}>
              <Text style={[styles.blockTitle, themed.textPrimary]} accessibilityRole="header">
                {section.heading}
              </Text>
              {section.points.map((point, pointIndex) => (
                <View key={pointIndex} style={styles.point}>
                  <Text style={[styles.bullet, themed.accent]}>•</Text>
                  <Text style={[styles.body, styles.pointText, themed.textPrimary]}>{point}</Text>
                </View>
              ))}
            </View>
          ))}
          {open.keyTerms.length > 0 && (
            <View style={[styles.block, themed.card]}>
              <Text style={[styles.blockTitle, themed.textPrimary]}>Key terms</Text>
              {open.keyTerms.map((term) => (
                <Text key={term.term} style={[styles.body, styles.term, themed.textPrimary]}>
                  <Text style={styles.termName}>{term.term}</Text>
                  <Text style={themed.textSecondary}> — {term.meaning}</Text>
                </Text>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ToolScreenHeader
        title="Study Notes"
        subtitle={
          summaries.length === 0
            ? 'Revision notes from your lectures'
            : `${summaries.length} set${summaries.length === 1 ? '' : 's'} · synced across your devices`
        }
        onBack={onBack}
      />
      <FlatList
        data={summaries}
        keyExtractor={(summary) => summary.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={[styles.generate, Shadows.card, themed.card]}>
            <TouchableOpacity
              style={[styles.primaryButton, themed.primaryButton, busy && styles.disabled]}
              onPress={() => void handleChooseDocument()}
              disabled={busy}
              accessibilityRole="button"
            >
              {busy ? <ActivityIndicator color={colors.white} /> : <FileUp size={18} color={colors.white} />}
              <Text style={[styles.primaryLabel, themed.onAccent]}>{busy ? progress : 'Choose a document'}</Text>
            </TouchableOpacity>
            {busy && (
              <Text style={[styles.note, themed.textSecondary]}>
                Long documents take a minute. You can use the rest of LAFINA — the notes appear here when they are
                ready.
              </Text>
            )}
            {error ? (
              <Text style={[styles.error, themed.error]} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}
            <Text style={[styles.note, themed.textMuted]}>
              PDF, Word (.docx) or PowerPoint (.pptx), up to {Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB. The
              file is read on the LAFINA server and is not kept there.
            </Text>
          </View>
        }
        ListEmptyComponent={
          busy ? null : (
            <View style={styles.empty}>
              <BookOpen size={40} color={colors.red} />
              <Text style={[styles.emptyTitle, themed.textPrimary]}>No study notes yet</Text>
              <Text style={[styles.emptyText, themed.textSecondary]}>
                Choose lecture slides, a handout or a chapter and LAFINA turns it into notes you can revise from.
                Notes made on the desktop app appear here too.
              </Text>
            </View>
          )
        }
        renderItem={({ item: summary }) => (
          <TouchableOpacity
            style={[styles.row, themed.card]}
            onPress={() => setOpenId(summary.id)}
            onLongPress={() => confirmDelete(summary)}
            accessibilityRole="button"
            accessibilityHint="Double tap to open. Double tap and hold to delete."
          >
            <BookOpen size={20} color={colors.red} />
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, themed.textPrimary]} numberOfLines={1}>
                {summary.title}
              </Text>
              <Text style={[styles.rowMeta, themed.textSecondary]}>
                {KIND_LABEL[summary.sourceKind] ?? 'Document'} · {summary.sections.length} section
                {summary.sections.length === 1 ? '' : 's'} · {formatWhen(summary.createdAt)}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
};

const getThemedStyles = (colors: ThemeColors) => ({
  textPrimary: { color: colors.textPrimary },
  textSecondary: { color: colors.textSecondary },
  textMuted: { color: colors.textMuted },
  onAccent: { color: colors.white },
  accent: { color: colors.red },
  error: { color: colors.error },
  warning: { color: colors.warning, backgroundColor: colors.bannerBg },
  card: { backgroundColor: colors.cardBg, borderColor: colors.border },
  primaryButton: { backgroundColor: colors.red },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  listContent: {
    paddingBottom: 140,
  },
  generate: {
    borderWidth: 1,
    borderRadius: Layout.borderRadiusCard,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Layout.borderRadiusPill,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  primaryLabel: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.bodyLarge,
    fontWeight: 'bold',
    marginLeft: Spacing.sm,
  },
  disabled: {
    opacity: 0.6,
  },
  note: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
    marginTop: Spacing.xs,
    lineHeight: 17,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
    marginVertical: Spacing.sm,
  },
  warning: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
    borderRadius: Layout.borderRadiusButton,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  empty: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
  },
  emptyTitle: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.subtitle,
    fontWeight: 'bold',
    marginTop: Spacing.md,
  },
  emptyText: {
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
    textAlign: 'center',
    marginTop: Spacing.sm,
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Layout.borderRadiusCard,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  rowText: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  rowTitle: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.bodyLarge,
    fontWeight: 'bold',
  },
  rowMeta: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
    marginTop: 2,
  },
  block: {
    borderWidth: 1,
    borderRadius: Layout.borderRadiusCard,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  blockTitle: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.bodyLarge,
    fontWeight: 'bold',
    marginBottom: Spacing.sm,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
    lineHeight: 21,
  },
  point: {
    flexDirection: 'row',
    marginBottom: Spacing.xs,
  },
  bullet: {
    width: 16,
    fontFamily: Fonts.heading,
    fontSize: FontSize.body,
    lineHeight: 21,
  },
  pointText: {
    flex: 1,
  },
  term: {
    marginBottom: Spacing.sm,
  },
  termName: {
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
});
