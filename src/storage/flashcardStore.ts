/**
 * Generated flashcard decks.
 *
 * A deck costs a document upload and several model calls to make, so it is
 * stored rather than held in a screen's memory, and it syncs so a deck made on
 * one device can be studied on another. Every write queues its sync mutation
 * in the same transaction; deletes are soft so the deletion can sync too.
 */

import { db, DatabaseTransaction } from './database';
import { syncOutboxStore } from './syncOutboxStore';
import type { SyncOperation, SyncPayload } from './syncTypes';
import type { Flashcard } from '../utils/ankiExport';

/** How many decks one account keeps before the oldest is dropped. */
export const MAX_STORED_DECKS = 100;

/** Limits the sync API enforces; the builders trim to them so a deck always syncs. */
const SYNC_LIMITS = {
  title: 160,
  sourceName: 255,
  cards: 200,
  question: 500,
  answer: 2000,
  warnings: 50,
  warning: 1000,
};

export interface FlashcardDeck {
  id: string;
  userId: string;
  title: string;
  sourceName: string | null;
  cards: Flashcard[];
  pageCount: number;
  ocrPageCount: number;
  warnings: string[];
  createdAt: string;
}

interface DeckRow {
  [key: string]: unknown;
}

const parseJsonArray = <T>(value: unknown, fallback: T[]): T[] => {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    // A row written by a newer version, or one that was truncated. A deck that
    // cannot be read is better shown empty than allowed to break the screen.
    return fallback;
  }
};

const mapDeck = (row: DeckRow): FlashcardDeck => ({
  id: String(row.id),
  userId: String(row.user_id),
  title: String(row.title ?? 'Flashcards'),
  sourceName: typeof row.source_name === 'string' ? row.source_name : null,
  cards: parseJsonArray<Flashcard>(row.cards_json, []).filter(
    (card) => card && typeof card.question === 'string' && typeof card.answer === 'string',
  ),
  pageCount: Number(row.page_count) || 0,
  ocrPageCount: Number(row.ocr_page_count) || 0,
  warnings: parseJsonArray<string>(row.warnings_json, []),
  createdAt: String(row.created_at),
});

/** The sync payload for one stored deck row. */
export const flashcardDeckPayload = (row: DeckRow): SyncPayload => {
  const deck = mapDeck(row);
  return {
    title: deck.title.slice(0, SYNC_LIMITS.title) || 'Flashcards',
    source_name: deck.sourceName ? deck.sourceName.slice(0, SYNC_LIMITS.sourceName) : null,
    cards: deck.cards.slice(0, SYNC_LIMITS.cards).map((card) => ({
      question: card.question.slice(0, SYNC_LIMITS.question),
      answer: card.answer.slice(0, SYNC_LIMITS.answer),
    })),
    page_count: Math.max(0, Math.round(deck.pageCount)),
    ocr_page_count: Math.max(0, Math.round(deck.ocrPageCount)),
    warnings: deck.warnings
      .filter((warning) => typeof warning === 'string')
      .slice(0, SYNC_LIMITS.warnings)
      .map((warning) => warning.slice(0, SYNC_LIMITS.warning)),
    created_at: deck.createdAt,
  };
};

const enqueueDeck = (id: string, operation: SyncOperation, tx: DatabaseTransaction): void => {
  const row = tx.executeSync('SELECT * FROM flashcard_decks WHERE id = ?', [id]).rows?.[0];
  if (!row) return;
  const userId = String(row.user_id);
  syncOutboxStore.enqueueMutation(
    userId, 'flashcard_deck', id, operation, flashcardDeckPayload(row), 'account', userId, tx,
  );
};

/** Tombstones a deck, drops its cards, and queues the deletion. */
const softDelete = (id: string, userId: string, now: string, tx: DatabaseTransaction): void => {
  tx.executeSync(
    `UPDATE flashcard_decks
        SET deleted_at = ?, updated_at = ?, cards_json = '[]', card_count = 0, warnings_json = '[]'
      WHERE id = ?`,
    [now, now, id],
  );
  syncOutboxStore.enqueueMutation(userId, 'flashcard_deck', id, 'delete', {}, 'account', userId, tx);
};

export interface SaveDeckInput {
  id: string;
  userId: string;
  title: string;
  sourceName?: string | null;
  cards: Flashcard[];
  pageCount?: number;
  ocrPageCount?: number;
  warnings?: string[];
}

export const flashcardStore = {
  /** Newest first; the screen opens on the deck at the top. */
  getDecks: (userId: string): FlashcardDeck[] => {
    try {
      const result = db.executeSync(
        `SELECT * FROM flashcard_decks WHERE user_id = ? AND deleted_at IS NULL
          ORDER BY created_at DESC, rowid DESC`,
        [userId],
      );
      return (result.rows ?? []).map(mapDeck);
    } catch (error) {
      console.error('Error loading flashcard decks:', error);
      return [];
    }
  },

  getDeck: (id: string): FlashcardDeck | null => {
    try {
      const result = db.executeSync(
        'SELECT * FROM flashcard_decks WHERE id = ? AND deleted_at IS NULL',
        [id],
      );
      const row = result.rows?.[0];
      return row ? mapDeck(row) : null;
    } catch (error) {
      console.error('Error loading flashcard deck:', error);
      return null;
    }
  },

  save: (input: SaveDeckInput): void => {
    const now = new Date().toISOString();
    db.transactionSync((tx: DatabaseTransaction) => {
      const existing = tx.executeSync('SELECT created_at FROM flashcard_decks WHERE id = ?', [input.id])
        .rows?.[0];
      tx.executeSync(
        `INSERT OR REPLACE INTO flashcard_decks (
           id, user_id, title, source_name, card_count, cards_json,
           page_count, ocr_page_count, warnings_json, created_at, updated_at, deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          input.id,
          input.userId,
          input.title.slice(0, 120) || 'Flashcards',
          input.sourceName ?? null,
          input.cards.length,
          JSON.stringify(input.cards),
          input.pageCount ?? 0,
          input.ocrPageCount ?? 0,
          JSON.stringify(input.warnings ?? []),
          typeof existing?.created_at === 'string' ? existing.created_at : now,
          now,
        ],
      );
      enqueueDeck(input.id, existing ? 'update' : 'create', tx);

      // History is capped rather than allowed to grow forever. Dropping the
      // oldest is a real deletion, so it syncs like one.
      const overflow = tx.executeSync(
        `SELECT id FROM flashcard_decks
          WHERE user_id = ? AND deleted_at IS NULL
          ORDER BY created_at DESC, rowid DESC
          LIMIT -1 OFFSET ?`,
        [input.userId, MAX_STORED_DECKS],
      ).rows ?? [];
      overflow.forEach((row) => softDelete(String(row.id), input.userId, now, tx));
    });
  },

  remove: (id: string): void => {
    try {
      db.transactionSync((tx: DatabaseTransaction) => {
        const row = tx.executeSync(
          'SELECT user_id FROM flashcard_decks WHERE id = ? AND deleted_at IS NULL',
          [id],
        ).rows?.[0];
        if (!row) return;
        softDelete(id, String(row.user_id), new Date().toISOString(), tx);
      });
    } catch (error) {
      console.error('Error deleting flashcard deck:', error);
    }
  },

  /** Rewrites one deck's cards after an edit or a deletion in the reviewer. */
  replaceCards: (id: string, cards: Flashcard[]): void => {
    try {
      db.transactionSync((tx: DatabaseTransaction) => {
        const result = tx.executeSync(
          `UPDATE flashcard_decks SET cards_json = ?, card_count = ?, updated_at = ?
            WHERE id = ? AND deleted_at IS NULL`,
          [JSON.stringify(cards), cards.length, new Date().toISOString(), id],
        );
        if (result.rowsAffected) enqueueDeck(id, 'update', tx);
      });
    } catch (error) {
      console.error('Error updating flashcard deck:', error);
    }
  },
};
