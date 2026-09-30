import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FileUp, GraduationCap, Layers, Pencil, Share2, Trash2 } from 'lucide-react-native';
import { flashcardStore } from '../../../storage';
import type { FlashcardDeck } from '../../../storage';
import { ankiFileName, generateId, toAnkiTsv } from '../../../utils';
import type { Flashcard } from '../../../utils';
import { hasProEntitlement } from '../../../cloud';
import {
  DEFAULT_CARDS,
  describeFlashcardFailure,
  flashcardSkill,
  MAX_PDF_BYTES,
} from '../../../skills/flashcardSkill';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, FontSize, Layout, Shadows, Spacing } from '../../theme';
import {
  formatWhen,
  MIME_PDF,
  pickDocument,
  ProFeaturePanel,
  shareTextFile,
  ToolScreenHeader,
  useToolBack,
} from '../../components/tools';
import type { RegisterToolBack } from '../../components/tools';
import { StudyModal } from './StudyModal';
import { CardEditModal } from './CardEditModal';

const CARD_COUNT_CHOICES = [20, 40, 80];

interface FlashcardsScreenProps {
  userId: string;
  refreshTrigger: number;
  onRefresh: () => void;
  onBack: () => void;
  registerBack?: RegisterToolBack;
}

/**
 * Turns a PDF into a deck of flashcards, studies it, and gets it into Anki.
 *
 * The document is read and the cards written on the LAFINA server, so this
 * screen is the upload, the wait, and what the student does with the result.
 * Decks sync, so one made on the desktop is here to study on the bus.
 */
export const FlashcardsScreen: React.FC<FlashcardsScreenProps> = ({
  userId,
  refreshTrigger,
  onRefresh,
  onBack,
  registerBack,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);
  const entitled = hasProEntitlement(userId);

  const [decks, setDecks] = useState<FlashcardDeck[]>([]);
  const [openDeckId, setOpenDeckId] = useState<string | null>(null);
  const [cardTarget, setCardTarget] = useState(DEFAULT_CARDS);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [studyIndex, setStudyIndex] = useState<number | null>(null);
  const [editIndex, setEditIndex] = useState<number | null>(null);

  // A generation outlives this screen on purpose: the deck is stored before
  // any state is touched, so leaving mid-run still leaves the deck behind.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadDecks = useCallback(() => {
    if (!entitled) {
      setDecks([]);
      return;
    }
    const stored = flashcardStore.getDecks(userId);
    setDecks(stored);
    setOpenDeckId((current) => (current && stored.some((deck) => deck.id === current) ? current : null));
  }, [userId, entitled]);

  useEffect(() => {
    loadDecks();
  }, [loadDecks, refreshTrigger]);

  const openDeck = useMemo(
    () => decks.find((deck) => deck.id === openDeckId) ?? null,
    [decks, openDeckId]
  );

  // Back from an open deck returns to the list before leaving Flashcards.
  const closeDeck = useCallback((): boolean => {
    setOpenDeckId(null);
    return true;
  }, []);
  useToolBack(registerBack, openDeckId ? closeDeck : null);

  const handleChoosePdf = async (): Promise<void> => {
    if (busy) return;
    setError('');
    const picked = await pickDocument([MIME_PDF], MAX_PDF_BYTES);
    if (picked.kind === 'cancelled') return;
    if (picked.kind === 'error') {
      setError(picked.message);
      return;
    }

    const sourceName = picked.document.name;
    setBusy(true);
    setProgress('Reading the document…');
    // No progress events, so the label moves on a timer: honest about the
    // stage, not about the percentage.
    const stageTimer = setTimeout(() => {
      if (mounted.current) setProgress('Writing flashcards…');
    }, 6000);

    try {
      const result = await flashcardSkill.generateFromPdf({
        filename: sourceName,
        base64: picked.document.base64,
        maxCards: cardTarget,
      });
      if (result.status !== 'success' || !result.data) {
        if (mounted.current) setError(describeFlashcardFailure(result));
        return;
      }
      const deckId = generateId('deck');
      flashcardStore.save({
        id: deckId,
        userId,
        title: result.data.deckTitle || sourceName,
        sourceName,
        cards: result.data.cards,
        pageCount: result.data.pagesRead,
        ocrPageCount: result.data.ocrPages.length,
        warnings: result.data.warnings,
      });
      onRefresh();
      if (!mounted.current) return;
      loadDecks();
      setOpenDeckId(deckId);
    } catch (generateError) {
      console.error('[Flashcards] Generation failed:', generateError);
      if (mounted.current) setError('Flashcards could not be generated from that document.');
    } finally {
      clearTimeout(stageTimer);
      if (mounted.current) {
        setBusy(false);
        setProgress('');
      }
    }
  };

  const handleExport = async (deck: FlashcardDeck): Promise<void> => {
    if (deck.cards.length === 0) return;
    const outcome = await shareTextFile({
      fileName: ankiFileName(deck.title),
      contents: toAnkiTsv(deck.cards),
      title: 'Export for Anki',
    });
    if (outcome === 'failed') setError('That deck could not be shared.');
  };

  const confirmDeleteDeck = (deck: FlashcardDeck): void => {
    Alert.alert(
      'Delete deck',
      `Delete “${deck.title}” and its ${deck.cards.length} cards? It is removed from your other devices too. Anything you exported is untouched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            flashcardStore.remove(deck.id);
            setOpenDeckId(null);
            loadDecks();
            onRefresh();
          },
        },
      ]
    );
  };

  const confirmDeleteCard = (deck: FlashcardDeck, index: number): void => {
    Alert.alert('Remove card', deck.cards[index]?.question ?? '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          flashcardStore.replaceCards(deck.id, deck.cards.filter((_, position) => position !== index));
          loadDecks();
        },
      },
    ]);
  };

  const saveCard = (deck: FlashcardDeck, index: number, edited: Flashcard): void => {
    flashcardStore.replaceCards(
      deck.id,
      deck.cards.map((card, position) => (position === index ? edited : card))
    );
    setEditIndex(null);
    loadDecks();
  };

  if (!entitled) {
    return (
      <View style={styles.container}>
        <ToolScreenHeader title="Flashcards" subtitle="Turn a PDF into a study deck" onBack={onBack} />
        <ProFeaturePanel
          feature="Flashcards"
          description="Upload lecture notes or a chapter and LAFINA writes the questions, ready to study here or export into Anki. The document is read by the LAFINA server, which is why this one needs the plan."
        />
      </View>
    );
  }

  if (openDeck) {
    return (
      <View style={styles.container}>
        <ToolScreenHeader
          title={openDeck.title}
          subtitle={`${openDeck.cards.length} cards · ${openDeck.pageCount} page${openDeck.pageCount === 1 ? '' : 's'}${
            openDeck.ocrPageCount > 0 ? ` · ${openDeck.ocrPageCount} scanned` : ''
          }`}
          onBack={closeDeck}
          actions={[
            { key: 'export', label: 'Export for Anki', icon: Share2, onPress: () => void handleExport(openDeck) },
            { key: 'delete', label: 'Delete deck', icon: Trash2, onPress: () => confirmDeleteDeck(openDeck) },
          ]}
        />
        <FlatList
          data={openDeck.cards}
          keyExtractor={(card, index) => `${index}-${card.question}`}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <>
              <TouchableOpacity
                style={[styles.primaryButton, themed.primaryButton, openDeck.cards.length === 0 && styles.disabled]}
                onPress={() => setStudyIndex(0)}
                disabled={openDeck.cards.length === 0}
                accessibilityRole="button"
              >
                <GraduationCap size={18} color={colors.white} />
                <Text style={[styles.primaryLabel, themed.onAccent]}>Study</Text>
              </TouchableOpacity>
              {openDeck.warnings.map((warning) => (
                <Text key={warning} style={[styles.warning, themed.warning]}>
                  {warning}
                </Text>
              ))}
            </>
          }
          ListEmptyComponent={
            <Text style={[styles.emptyText, themed.textSecondary]}>Every card in this deck was removed.</Text>
          }
          renderItem={({ item: card, index }) => (
            <TouchableOpacity
              style={[styles.cardRow, themed.card]}
              onPress={() => setStudyIndex(index)}
              accessibilityRole="button"
              accessibilityLabel={`Study: ${card.question}`}
            >
              <View style={styles.cardText}>
                <Text style={[styles.question, themed.textPrimary]}>{card.question}</Text>
                <Text style={[styles.answer, themed.textSecondary]} numberOfLines={3}>
                  {card.answer}
                </Text>
              </View>
              <View style={styles.cardActions}>
                <TouchableOpacity
                  onPress={() => setEditIndex(index)}
                  accessibilityRole="button"
                  accessibilityLabel="Edit this card"
                  hitSlop={6}
                  style={styles.cardAction}
                >
                  <Pencil size={16} color={colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => confirmDeleteCard(openDeck, index)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove this card"
                  hitSlop={6}
                  style={styles.cardAction}
                >
                  <Trash2 size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          )}
        />
        <StudyModal
          visible={studyIndex !== null}
          title={openDeck.title}
          cards={openDeck.cards}
          index={Math.min(studyIndex ?? 0, Math.max(0, openDeck.cards.length - 1))}
          onIndexChange={setStudyIndex}
          onClose={() => setStudyIndex(null)}
        />
        <CardEditModal
          card={editIndex !== null ? openDeck.cards[editIndex] ?? null : null}
          onSave={(edited) => editIndex !== null && saveCard(openDeck, editIndex, edited)}
          onCancel={() => setEditIndex(null)}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ToolScreenHeader
        title="Flashcards"
        subtitle={
          decks.length === 0
            ? 'Turn a PDF into a study deck'
            : `${decks.length} deck${decks.length === 1 ? '' : 's'} · synced across your devices`
        }
        onBack={onBack}
      />
      <FlatList
        data={decks}
        keyExtractor={(deck) => deck.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={[styles.generate, Shadows.card, themed.card]}>
            <Text style={[styles.generateLabel, themed.textSecondary]}>Cards per deck</Text>
            <View style={styles.chips}>
              {CARD_COUNT_CHOICES.map((count) => {
                const active = cardTarget === count;
                return (
                  <TouchableOpacity
                    key={count}
                    style={[styles.chip, themed.chip, active && themed.chipActive]}
                    onPress={() => setCardTarget(count)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.chipLabel, active ? themed.onAccent : themed.textPrimary]}>{count}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity
              style={[styles.primaryButton, themed.primaryButton, busy && styles.disabled]}
              onPress={() => void handleChoosePdf()}
              disabled={busy}
              accessibilityRole="button"
            >
              {busy ? <ActivityIndicator color={colors.white} /> : <FileUp size={18} color={colors.white} />}
              <Text style={[styles.primaryLabel, themed.onAccent]}>{busy ? progress : 'Choose a PDF'}</Text>
            </TouchableOpacity>
            {busy && (
              <Text style={[styles.note, themed.textSecondary]}>
                Long documents take a minute. You can use the rest of LAFINA — the deck appears here when it is ready.
              </Text>
            )}
            {error ? (
              <Text style={[styles.error, themed.error]} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}
            <Text style={[styles.note, themed.textMuted]}>
              PDFs up to {Math.round(MAX_PDF_BYTES / (1024 * 1024))} MB. The file is read on the LAFINA server and is
              not kept there.
            </Text>
          </View>
        }
        ListEmptyComponent={
          busy ? null : (
            <View style={styles.empty}>
              <Layers size={40} color={colors.red} />
              <Text style={[styles.emptyTitle, themed.textPrimary]}>No decks yet</Text>
              <Text style={[styles.emptyText, themed.textSecondary]}>
                Choose a PDF — lecture notes, a chapter, a handout — and LAFINA pulls out what is worth memorising.
                Decks made on the desktop app appear here too.
              </Text>
            </View>
          )
        }
        renderItem={({ item: deck }) => (
          <TouchableOpacity
            style={[styles.deckRow, themed.card]}
            onPress={() => setOpenDeckId(deck.id)}
            onLongPress={() => confirmDeleteDeck(deck)}
            accessibilityRole="button"
            accessibilityHint="Double tap to open. Double tap and hold to delete."
          >
            <Layers size={20} color={colors.red} />
            <View style={styles.deckText}>
              <Text style={[styles.deckTitle, themed.textPrimary]} numberOfLines={1}>
                {deck.title}
              </Text>
              <Text style={[styles.deckMeta, themed.textSecondary]}>
                {deck.cards.length} cards · {formatWhen(deck.createdAt)}
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
  error: { color: colors.error },
  warning: { color: colors.warning, backgroundColor: colors.bannerBg },
  card: { backgroundColor: colors.cardBg, borderColor: colors.border },
  chip: { backgroundColor: colors.inputBg, borderColor: colors.border },
  chipActive: { backgroundColor: colors.red, borderColor: colors.red },
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
  generateLabel: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.small,
    fontWeight: 'bold',
  },
  chips: {
    flexDirection: 'row',
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  chip: {
    borderWidth: 1,
    borderRadius: Layout.borderRadiusPill,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs + 2,
    marginRight: Spacing.sm,
  },
  chipLabel: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.body,
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
    marginTop: Spacing.sm,
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
  deckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Layout.borderRadiusCard,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  deckText: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  deckTitle: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.bodyLarge,
    fontWeight: 'bold',
  },
  deckMeta: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
    marginTop: 2,
  },
  cardRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: Layout.borderRadiusButton,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  cardText: {
    flex: 1,
  },
  question: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.body,
  },
  answer: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
    marginTop: Spacing.xs,
    lineHeight: 17,
  },
  cardActions: {
    marginLeft: Spacing.sm,
    justifyContent: 'space-between',
  },
  cardAction: {
    padding: Spacing.xs,
  },
});
