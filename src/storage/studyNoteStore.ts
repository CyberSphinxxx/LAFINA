/**
 * Generated study notes.
 *
 * Like a flashcard deck, a summary costs an upload and several model calls, so
 * it is stored rather than held in a screen's memory, and it syncs so notes
 * made on one device can be read on another. Every write queues its sync
 * mutation in the same transaction; deletes are soft so the deletion syncs too.
 */

import { db, DatabaseTransaction } from './database';
import { syncOutboxStore } from './syncOutboxStore';
import type { SyncOperation, SyncPayload } from './syncTypes';
import type { StudyNoteSection, StudyNoteTerm } from '../skills/studyNotesSkill';

/** How many summaries one account keeps before the oldest is dropped. */
export const MAX_STORED_SUMMARIES = 100;

/** Limits the sync API enforces; the builder trims to them so a summary always syncs. */
const SYNC_LIMITS = {
  title: 160,
  sourceName: 255,
  overview: 10_000,
  sections: 60,
  heading: 300,
  points: 50,
  point: 2000,
  terms: 100,
  term: 200,
  meaning: 2000,
  markdown: 200_000,
  warnings: 50,
  warning: 1000,
};

const SOURCE_KINDS = ['pdf', 'docx', 'pptx'];

export interface StudySummaryRecord {
  id: string;
  userId: string;
  title: string;
  sourceName: string | null;
  sourceKind: string;
  overview: string;
  sections: StudyNoteSection[];
  keyTerms: StudyNoteTerm[];
  markdown: string;
  pageCount: number;
  warnings: string[];
  createdAt: string;
}

interface SummaryRow {
  [key: string]: unknown;
}

const parseJsonArray = <T>(value: unknown): T[] => {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    // A row written by a newer version, or a truncated one. Better shown
    // partly empty than allowed to break the screen.
    return [];
  }
};

const mapSummary = (row: SummaryRow): StudySummaryRecord => ({
  id: String(row.id),
  userId: String(row.user_id),
  title: String(row.title ?? 'Study notes'),
  sourceName: typeof row.source_name === 'string' ? row.source_name : null,
  sourceKind: typeof row.source_kind === 'string' ? row.source_kind : 'pdf',
  overview: typeof row.overview === 'string' ? row.overview : '',
  sections: parseJsonArray<StudyNoteSection>(row.sections_json).filter(
    (section) => section && typeof section.heading === 'string',
  ),
  keyTerms: parseJsonArray<StudyNoteTerm>(row.key_terms_json).filter(
    (term) => term && typeof term.term === 'string',
  ),
  markdown: typeof row.markdown === 'string' ? row.markdown : '',
  pageCount: Number(row.page_count) || 0,
  warnings: parseJsonArray<string>(row.warnings_json),
  createdAt: String(row.created_at),
});

/** The sync payload for one stored summary row. */
export const studySummaryPayload = (row: SummaryRow): SyncPayload => {
  const summary = mapSummary(row);
  return {
    title: summary.title.slice(0, SYNC_LIMITS.title) || 'Study notes',
    source_name: summary.sourceName ? summary.sourceName.slice(0, SYNC_LIMITS.sourceName) : null,
    source_kind: SOURCE_KINDS.includes(summary.sourceKind) ? summary.sourceKind : '',
    overview: summary.overview.slice(0, SYNC_LIMITS.overview),
    sections: summary.sections.slice(0, SYNC_LIMITS.sections).map((section) => ({
      heading: section.heading.slice(0, SYNC_LIMITS.heading),
      points: (Array.isArray(section.points) ? section.points : [])
        .filter((point) => typeof point === 'string')
        .slice(0, SYNC_LIMITS.points)
        .map((point) => point.slice(0, SYNC_LIMITS.point)),
    })),
    key_terms: summary.keyTerms
      .filter((term) => typeof term.meaning === 'string')
      .slice(0, SYNC_LIMITS.terms)
      .map((term) => ({
        term: term.term.slice(0, SYNC_LIMITS.term),
        meaning: term.meaning.slice(0, SYNC_LIMITS.meaning),
      })),
    markdown: summary.markdown.slice(0, SYNC_LIMITS.markdown),
    page_count: Math.max(0, Math.round(summary.pageCount)),
    warnings: summary.warnings
      .filter((warning) => typeof warning === 'string')
      .slice(0, SYNC_LIMITS.warnings)
      .map((warning) => warning.slice(0, SYNC_LIMITS.warning)),
    created_at: summary.createdAt,
  };
};

const enqueueSummary = (id: string, operation: SyncOperation, tx: DatabaseTransaction): void => {
  const row = tx.executeSync('SELECT * FROM study_summaries WHERE id = ?', [id]).rows?.[0];
  if (!row) return;
  const userId = String(row.user_id);
  syncOutboxStore.enqueueMutation(
    userId, 'study_summary', id, operation, studySummaryPayload(row), 'account', userId, tx,
  );
};

/** Tombstones a summary, drops its content, and queues the deletion. */
const softDelete = (id: string, userId: string, now: string, tx: DatabaseTransaction): void => {
  tx.executeSync(
    `UPDATE study_summaries
        SET deleted_at = ?, updated_at = ?, sections_json = '[]', key_terms_json = '[]',
            markdown = '', overview = '', warnings_json = '[]'
      WHERE id = ?`,
    [now, now, id],
  );
  syncOutboxStore.enqueueMutation(userId, 'study_summary', id, 'delete', {}, 'account', userId, tx);
};

export interface SaveSummaryInput {
  id: string;
  userId: string;
  title: string;
  sourceName?: string | null;
  sourceKind?: string;
  overview?: string;
  sections: StudyNoteSection[];
  keyTerms: StudyNoteTerm[];
  markdown: string;
  pageCount?: number;
  warnings?: string[];
}

export const studyNoteStore = {
  /** Newest first; the screen opens on the summary at the top. */
  getSummaries: (userId: string): StudySummaryRecord[] => {
    try {
      const result = db.executeSync(
        `SELECT * FROM study_summaries WHERE user_id = ? AND deleted_at IS NULL
          ORDER BY created_at DESC, rowid DESC`,
        [userId],
      );
      return (result.rows ?? []).map(mapSummary);
    } catch (error) {
      console.error('Error loading study notes:', error);
      return [];
    }
  },

  getSummary: (id: string): StudySummaryRecord | null => {
    try {
      const result = db.executeSync(
        'SELECT * FROM study_summaries WHERE id = ? AND deleted_at IS NULL',
        [id],
      );
      const row = result.rows?.[0];
      return row ? mapSummary(row) : null;
    } catch (error) {
      console.error('Error loading study notes:', error);
      return null;
    }
  },

  save: (input: SaveSummaryInput): void => {
    const now = new Date().toISOString();
    db.transactionSync((tx: DatabaseTransaction) => {
      const existing = tx.executeSync('SELECT created_at FROM study_summaries WHERE id = ?', [input.id])
        .rows?.[0];
      tx.executeSync(
        `INSERT OR REPLACE INTO study_summaries (
           id, user_id, title, source_name, source_kind, overview,
           sections_json, key_terms_json, markdown, page_count, warnings_json,
           created_at, updated_at, deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          input.id,
          input.userId,
          input.title.slice(0, 160) || 'Study notes',
          input.sourceName ?? null,
          input.sourceKind ?? 'pdf',
          input.overview ?? '',
          JSON.stringify(input.sections),
          JSON.stringify(input.keyTerms),
          input.markdown,
          input.pageCount ?? 0,
          JSON.stringify(input.warnings ?? []),
          typeof existing?.created_at === 'string' ? existing.created_at : now,
          now,
        ],
      );
      enqueueSummary(input.id, existing ? 'update' : 'create', tx);

      // History is capped rather than allowed to grow forever. Dropping the
      // oldest is a real deletion, so it syncs like one.
      const overflow = tx.executeSync(
        `SELECT id FROM study_summaries
          WHERE user_id = ? AND deleted_at IS NULL
          ORDER BY created_at DESC, rowid DESC
          LIMIT -1 OFFSET ?`,
        [input.userId, MAX_STORED_SUMMARIES],
      ).rows ?? [];
      overflow.forEach((row) => softDelete(String(row.id), input.userId, now, tx));
    });
  },

  remove: (id: string): void => {
    try {
      db.transactionSync((tx: DatabaseTransaction) => {
        const row = tx.executeSync(
          'SELECT user_id FROM study_summaries WHERE id = ? AND deleted_at IS NULL',
          [id],
        ).rows?.[0];
        if (!row) return;
        softDelete(id, String(row.user_id), new Date().toISOString(), tx);
      });
    } catch (error) {
      console.error('Error deleting study notes:', error);
    }
  },
};
