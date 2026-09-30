/**
 * Meeting notes as the app holds them.
 *
 * The shape matches what the server returns, so a response can be stored as
 * it arrived. It is normalised again on the way in regardless: notes are
 * edited by hand and stored locally, and a row written by an older version, or
 * hand-edited into nonsense, must still render.
 */

export interface ActionItem {
  task: string;
  /** Empty unless the meeting explicitly named someone. */
  assignee: string;
  /** Empty unless a deadline was explicitly stated. */
  deadline: string;
  status: 'pending' | 'done';
}

export interface KeyTopic {
  topic: string;
  discussion: string;
}

export interface MeetingNotes {
  title: string;
  summary: string;
  key_topics: KeyTopic[];
  decisions: string[];
  action_items: ActionItem[];
  important_dates: string[];
  issues: string[];
  unresolved_questions: string[];
  key_points: string[];
}

export const emptyNotes = (): MeetingNotes => ({
  title: '',
  summary: '',
  key_topics: [],
  decisions: [],
  action_items: [],
  important_dates: [],
  issues: [],
  unresolved_questions: [],
  key_points: [],
});

const text = (value: unknown, limit = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, limit)
    : '';

const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => text(entry, 600)).filter(Boolean) : [];

/** Reads anything shaped roughly like notes into well-formed notes. */
export const normalizeNotes = (raw: unknown): MeetingNotes => {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    title: text(source.title, 160),
    summary: text(source.summary, 4_000),
    key_topics: Array.isArray(source.key_topics)
      ? source.key_topics
          .map((entry) => {
            const topic = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
            return { topic: text(topic.topic, 200), discussion: text(topic.discussion, 2_000) };
          })
          .filter((topic) => topic.topic || topic.discussion)
      : [],
    decisions: list(source.decisions),
    action_items: Array.isArray(source.action_items)
      ? source.action_items
          .map((entry) => {
            const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
            return {
              task: text(item.task, 600),
              assignee: text(item.assignee, 120),
              deadline: text(item.deadline, 120),
              status: item.status === 'done' ? ('done' as const) : ('pending' as const),
            };
          })
          .filter((item) => item.task)
      : [],
    important_dates: list(source.important_dates),
    issues: list(source.issues),
    unresolved_questions: list(source.unresolved_questions),
    key_points: list(source.key_points),
  };
};

export const isNotesEmpty = (notes: MeetingNotes): boolean =>
  !notes.summary &&
  notes.key_topics.length === 0 &&
  notes.decisions.length === 0 &&
  notes.action_items.length === 0 &&
  notes.important_dates.length === 0 &&
  notes.issues.length === 0 &&
  notes.unresolved_questions.length === 0 &&
  notes.key_points.length === 0;

/** Action items that carry a stated deadline, for the Deadlines section. */
export const deadlinesOf = (notes: MeetingNotes): Array<{ deadline: string; task: string; assignee: string }> =>
  notes.action_items
    .filter((item) => item.deadline)
    .map((item) => ({ deadline: item.deadline, task: item.task, assignee: item.assignee }));

export interface NotesMeta {
  title: string;
  recordedAt: string;
  durationSeconds: number;
}

const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0 ? `${hours} h ${minutes} min` : `${Math.max(1, minutes)} min`;
};

/** The notes as markdown, for export and for saving into LAFINA's Notes. */
export const notesToMarkdown = (notes: MeetingNotes, meta: NotesMeta): string => {
  const lines: string[] = [];
  const recorded = new Date(meta.recordedAt);
  lines.push(`# ${meta.title || notes.title || 'Meeting notes'}`);
  lines.push('');
  lines.push(
    `${Number.isNaN(recorded.getTime()) ? '' : recorded.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${formatDuration(meta.durationSeconds)}`.replace(/^ · /, ''),
  );
  lines.push('');

  const section = (heading: string, body: string[]): void => {
    if (!body.length) return;
    lines.push(`## ${heading}`, '', ...body, '');
  };

  if (notes.summary) section('Summary', [notes.summary]);
  section(
    'Key topics',
    notes.key_topics.flatMap((topic) => [`### ${topic.topic}`, ...(topic.discussion ? [topic.discussion, ''] : [''])]),
  );
  section('Decisions', notes.decisions.map((decision) => `- ${decision}`));
  section(
    'Action items',
    notes.action_items.map((item) => {
      const owner = item.assignee ? `${item.assignee} — ` : '';
      const due = item.deadline ? ` (by ${item.deadline})` : '';
      return `- [${item.status === 'done' ? 'x' : ' '}] ${owner}${item.task}${due}`;
    }),
  );
  section('Deadlines', deadlinesOf(notes).map((entry) => `- ${entry.deadline} — ${entry.task}`));
  section('Important dates', notes.important_dates.map((date) => `- ${date}`));
  section('Issues', notes.issues.map((issue) => `- ${issue}`));
  section('Unresolved questions', notes.unresolved_questions.map((question) => `- ${question}`));
  section('Points to remember', notes.key_points.map((point) => `- ${point}`));

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
};
