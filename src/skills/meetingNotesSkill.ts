/**
 * The two calls that turn a transcript into notes, through LAFINA's server.
 *
 * Only transcript text goes out — never audio — and it goes to LAFINA's own
 * API over HTTPS, which holds the DeepSeek key and makes the DeepSeek call. The
 * desktop app never has the key, so it cannot leak it.
 */

import { cloudClient, type CloudResult } from '../cloud/cloudClient';
import type { MeetingNotes } from '../meetings/meetingNotes';

export interface NotesResponse {
  requestId: string;
  notes: MeetingNotes;
  model: string;
  usage: Record<string, number>;
  createdAt: string;
}

export interface SectionInput {
  content: string;
  index: number;
  count: number;
  material: 'transcript' | 'notes';
}

export interface GenerateInput {
  content: string;
  source: 'transcript' | 'sections';
  titleHint?: string;
  recordedAt?: string;
}

export interface MeetingNotesSkill {
  section: (input: SectionInput) => Promise<CloudResult<NotesResponse>>;
  generate: (input: GenerateInput) => Promise<CloudResult<NotesResponse>>;
}

export const meetingNotesSkill: MeetingNotesSkill = {
  section: (input) =>
    cloudClient.request<NotesResponse>(
      '/v1/ai/meeting-notes/section',
      { method: 'POST', body: JSON.stringify(input) },
      true,
    ),
  generate: (input) =>
    cloudClient.request<NotesResponse>(
      '/v1/ai/meeting-notes/generate',
      {
        method: 'POST',
        body: JSON.stringify({
          content: input.content,
          source: input.source,
          titleHint: (input.titleHint ?? '').slice(0, 160),
          recordedAt: (input.recordedAt ?? '').slice(0, 64),
        }),
      },
      true,
    ),
};
