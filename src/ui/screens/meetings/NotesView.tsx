import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CheckSquare, Pencil, Plus, Square, Trash2 } from 'lucide-react-native';
import { deadlinesOf, normalizeNotes } from '../../../meetings';
import type { ActionItem, KeyTopic, MeetingNotes } from '../../../meetings';
import { ToolSheet } from '../../components/tools';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Spacing } from '../../theme';
import { getMeetingThemedStyles, meetingStyles } from './meetingStyles';

type ListKey = 'decisions' | 'important_dates' | 'issues' | 'unresolved_questions' | 'key_points';

const LIST_SECTIONS: Array<{ key: ListKey; heading: string; placeholder: string }> = [
  { key: 'decisions', heading: 'Decisions', placeholder: 'A decision that was confirmed' },
  { key: 'important_dates', heading: 'Important dates', placeholder: 'A date that was mentioned' },
  { key: 'issues', heading: 'Issues', placeholder: 'A problem that was raised' },
  { key: 'unresolved_questions', heading: 'Unresolved questions', placeholder: 'A question left open' },
  { key: 'key_points', heading: 'Points to remember', placeholder: 'Something worth remembering' },
];

const Section: React.FC<{ heading: string; children: React.ReactNode }> = ({ heading, children }) => {
  const themed = useThemedStyles(getMeetingThemedStyles);
  return (
    <View style={[meetingStyles.card, themed.card]}>
      <Text style={[meetingStyles.cardTitle, themed.textPrimary]} accessibilityRole="header">
        {heading}
      </Text>
      {children}
    </View>
  );
};

const Bullets: React.FC<{ items: string[] }> = ({ items }) => {
  const themed = useThemedStyles(getMeetingThemedStyles);
  return (
    <>
      {items.map((entry, index) => (
        <View key={index} style={styles.bulletRow}>
          <Text style={[meetingStyles.body, styles.bullet, themed.accent]}>•</Text>
          <Text style={[meetingStyles.body, styles.flex, themed.textPrimary]}>{entry}</Text>
        </View>
      ))}
    </>
  );
};

/**
 * The meeting notes, read first and edited on request.
 *
 * Ticking off an action item saves at once; anything else goes through Edit,
 * so a stray tap cannot rewrite the record of a meeting.
 */
export const NotesView: React.FC<{
  notes: MeetingNotes;
  edited: boolean;
  onSave: (notes: MeetingNotes) => void;
}> = ({ notes, edited, onSave }) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getMeetingThemedStyles);
  const [editing, setEditing] = useState(false);
  const deadlines = deadlinesOf(notes);

  const toggleItem = (index: number): void => {
    onSave(
      normalizeNotes({
        ...notes,
        action_items: notes.action_items.map((item, position) =>
          position === index ? { ...item, status: item.status === 'done' ? 'pending' : 'done' } : item,
        ),
      }),
    );
  };

  return (
    <View>
      <View style={[meetingStyles.spread, styles.bar]}>
        <Text style={[meetingStyles.small, themed.textMuted]}>{edited ? 'Edited by you' : ''}</Text>
        <TouchableOpacity
          style={[meetingStyles.secondaryButton, themed.secondaryButton]}
          onPress={() => setEditing(true)}
          accessibilityRole="button"
        >
          <Pencil size={14} color={colors.textPrimary} />
          <Text style={[meetingStyles.secondaryLabel, themed.textPrimary]}>Edit notes</Text>
        </TouchableOpacity>
      </View>

      {notes.summary ? (
        <Section heading="Summary">
          <Text style={[meetingStyles.body, themed.textPrimary]}>{notes.summary}</Text>
        </Section>
      ) : null}

      {notes.key_topics.length > 0 && (
        <Section heading="Key topics">
          {notes.key_topics.map((topic, index) => (
            <View key={`${topic.topic}-${index}`} style={styles.topic}>
              <Text style={[meetingStyles.body, meetingStyles.strong, themed.textPrimary]}>{topic.topic}</Text>
              {topic.discussion ? (
                <Text style={[meetingStyles.body, themed.textSecondary]}>{topic.discussion}</Text>
              ) : null}
            </View>
          ))}
        </Section>
      )}

      {notes.decisions.length > 0 && (
        <Section heading="Decisions">
          <Bullets items={notes.decisions} />
        </Section>
      )}

      {notes.action_items.length > 0 && (
        <Section heading="Action items">
          {notes.action_items.map((item, index) => {
            const done = item.status === 'done';
            return (
              <TouchableOpacity
                key={`${item.task}-${index}`}
                style={styles.actionRow}
                onPress={() => toggleItem(index)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
              >
                {done ? (
                  <CheckSquare size={20} color={colors.success} />
                ) : (
                  <Square size={20} color={colors.textSecondary} />
                )}
                <Text style={[meetingStyles.body, styles.flex, styles.actionText, themed.textPrimary, done && styles.done]}>
                  {item.assignee ? <Text style={meetingStyles.strong}>{item.assignee} — </Text> : null}
                  {item.task}
                  {item.deadline ? <Text style={themed.accent}> by {item.deadline}</Text> : null}
                </Text>
              </TouchableOpacity>
            );
          })}
        </Section>
      )}

      {deadlines.length > 0 && (
        <Section heading="Deadlines">
          <Bullets items={deadlines.map((entry) => `${entry.deadline} — ${entry.task}`)} />
        </Section>
      )}

      {LIST_SECTIONS.filter((section) => section.key !== 'decisions' && notes[section.key].length > 0).map(
        (section) => (
          <Section heading={section.heading} key={section.key}>
            <Bullets items={notes[section.key]} />
          </Section>
        ),
      )}

      {/* Mounted per edit, so the draft starts from the notes as they are now. */}
      {editing && (
        <NotesEditorSheet
          notes={notes}
          onClose={() => setEditing(false)}
          onSave={(next) => {
            onSave(next);
            setEditing(false);
          }}
        />
      )}
    </View>
  );
};

const NotesEditorSheet: React.FC<{
  notes: MeetingNotes;
  onClose: () => void;
  onSave: (notes: MeetingNotes) => void;
}> = ({ notes, onClose, onSave }) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getMeetingThemedStyles);
  const [draft, setDraft] = useState<MeetingNotes>(notes);

  const setList = (key: ListKey, values: string[]): void => setDraft({ ...draft, [key]: values });
  const setTopics = (topics: KeyTopic[]): void => setDraft({ ...draft, key_topics: topics });
  const setItems = (items: ActionItem[]): void => setDraft({ ...draft, action_items: items });

  const input = (
    value: string,
    onChangeText: (value: string) => void,
    placeholder: string,
    multiline = false,
  ): React.ReactElement => (
    <TextInput
      // Multiline fields stand alone; single-line ones share a row with a button or each other.
      style={[meetingStyles.input, themed.input, multiline ? meetingStyles.multiline : styles.flex]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.placeholder}
      multiline={multiline}
      accessibilityLabel={placeholder}
    />
  );

  const removeButton = (label: string, onPress: () => void): React.ReactElement => (
    <TouchableOpacity style={styles.remove} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      <Trash2 size={18} color={colors.error} />
    </TouchableOpacity>
  );

  const addButton = (label: string, onPress: () => void): React.ReactElement => (
    <TouchableOpacity style={styles.add} onPress={onPress} accessibilityRole="button">
      <Plus size={16} color={colors.red} />
      <Text style={[meetingStyles.small, meetingStyles.strong, themed.accent]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <ToolSheet
      visible
      title="Edit notes"
      onClose={onClose}
      footer={
        <View style={meetingStyles.buttonRow}>
          <TouchableOpacity
            style={[meetingStyles.secondaryButton, themed.secondaryButton]}
            onPress={onClose}
            accessibilityRole="button"
          >
            <Text style={[meetingStyles.secondaryLabel, themed.textPrimary]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[meetingStyles.primaryButton, themed.primaryButton]}
            // Blank rows left from "Add" are dropped on the way out.
            onPress={() => onSave(normalizeNotes(draft))}
            accessibilityRole="button"
          >
            <Text style={[meetingStyles.primaryLabel, themed.onAccent]}>Save notes</Text>
          </TouchableOpacity>
        </View>
      }
    >
      <Text style={[meetingStyles.cardTitle, themed.textPrimary]}>Summary</Text>
      {input(draft.summary, (summary) => setDraft({ ...draft, summary }), 'Summary', true)}

      <Text style={[meetingStyles.cardTitle, styles.heading, themed.textPrimary]}>Key topics</Text>
      {draft.key_topics.map((topic, index) => (
        <View key={index} style={[styles.group, themed.divider]}>
          <View style={meetingStyles.row}>
            {input(
              topic.topic,
              (value) => setTopics(draft.key_topics.map((t, i) => (i === index ? { ...t, topic: value } : t))),
              'Topic',
            )}
            {removeButton('Remove topic', () => setTopics(draft.key_topics.filter((_, i) => i !== index)))}
          </View>
          {input(
            topic.discussion,
            (value) => setTopics(draft.key_topics.map((t, i) => (i === index ? { ...t, discussion: value } : t))),
            'What was discussed',
            true,
          )}
        </View>
      ))}
      {addButton('Add a topic', () => setTopics([...draft.key_topics, { topic: '', discussion: '' }]))}

      <Text style={[meetingStyles.cardTitle, styles.heading, themed.textPrimary]}>Action items</Text>
      {draft.action_items.map((item, index) => {
        const change = (patch: Partial<ActionItem>): void =>
          setItems(draft.action_items.map((a, i) => (i === index ? { ...a, ...patch } : a)));
        return (
          <View key={index} style={[styles.group, themed.divider]}>
            <View style={meetingStyles.row}>
              {input(item.task, (task) => change({ task }), 'Task')}
              {removeButton('Remove action item', () => setItems(draft.action_items.filter((_, i) => i !== index)))}
            </View>
            <View style={[meetingStyles.row, styles.pair]}>
              {input(item.assignee, (assignee) => change({ assignee }), 'Who (if stated)')}
              {input(item.deadline, (deadline) => change({ deadline }), 'Deadline (if stated)')}
            </View>
          </View>
        );
      })}
      {addButton('Add an action item', () =>
        setItems([...draft.action_items, { task: '', assignee: '', deadline: '', status: 'pending' }]),
      )}

      {LIST_SECTIONS.map((section) => (
        <View key={section.key}>
          <Text style={[meetingStyles.cardTitle, styles.heading, themed.textPrimary]}>{section.heading}</Text>
          {draft[section.key].map((entry, index) => (
            <View key={index} style={meetingStyles.row}>
              {input(
                entry,
                (value) => setList(section.key, draft[section.key].map((v, i) => (i === index ? value : v))),
                section.placeholder,
              )}
              {removeButton('Remove', () => setList(section.key, draft[section.key].filter((_, i) => i !== index)))}
            </View>
          ))}
          {addButton('Add', () => setList(section.key, [...draft[section.key], '']))}
        </View>
      ))}
    </ToolSheet>
  );
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  bar: {
    marginBottom: Spacing.md,
  },
  bulletRow: {
    flexDirection: 'row',
    marginBottom: Spacing.xs,
  },
  bullet: {
    width: 16,
  },
  topic: {
    marginBottom: Spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: Spacing.xs,
  },
  actionText: {
    marginLeft: Spacing.sm,
  },
  done: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
  heading: {
    marginTop: Spacing.lg,
  },
  group: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  pair: {
    gap: Spacing.sm,
  },
  remove: {
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
});
