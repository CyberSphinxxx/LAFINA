import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, Shadows } from '../../theme';
import type { ThemeColors } from '../../contexts/ThemeContext';
import {
  CheckCircle,
  X,
  Trash2,
  Calendar,
  User,
  Sparkles,
  Check,
} from 'lucide-react-native';
import {
  ActionCandidate,
  RosterMember,
} from '../../../ai/meeting/actionCandidateExtractor';
import {
  businessTasksStore,
  tasksStore,
  meetingStore,
} from '../../../storage';
import { generateId } from '../../../utils';

interface ActionCandidatesModalProps {
  visible: boolean;
  meetingId: string;
  candidates: ActionCandidate[];
  roster?: RosterMember[];
  isManager?: boolean;
  businessId?: string;
  userId: string;
  onClose: () => void;
  onCandidateProcessed?: () => void;
}

export const ActionCandidatesModal: React.FC<ActionCandidatesModalProps> = ({
  visible,
  meetingId: _meetingId,
  candidates,
  roster = [],
  isManager = false,
  businessId = 'default_biz',
  userId,
  onClose,
  onCandidateProcessed,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);

  const [items, setItems] = useState<ActionCandidate[]>(candidates);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedInstructions, setEditedInstructions] = useState('');
  const [editedAssigneeId, setEditedAssigneeId] = useState<string | null>(null);

  React.useEffect(() => {
    setItems(candidates);
  }, [candidates]);

  const handleStartEdit = (cand: ActionCandidate) => {
    setEditingId(cand.id);
    setEditedTitle(cand.title);
    setEditedInstructions(cand.instructions);
    setEditedAssigneeId(cand.suggested_assignee_id);
  };

  const handleSaveEdit = (candId: string) => {
    const matched = roster.find((m) => m.id === editedAssigneeId);
    const updates = {
      title: editedTitle.trim() || 'Untitled Action Item',
      instructions: editedInstructions.trim(),
      suggested_assignee_id: editedAssigneeId,
      suggested_assignee_name: matched ? matched.name : null,
    };

    meetingStore.updateActionCandidate(candId, updates);
    setItems((prev) =>
      prev.map((c) => (c.id === candId ? { ...c, ...updates } : c))
    );
    setEditingId(null);
  };

  const handleConfirmCandidate = (cand: ActionCandidate) => {
    try {
      if (isManager) {
        // Managers create shared business tasks
        const createdTask = businessTasksStore.createTask({
          businessId,
          createdBy: userId,
          title: cand.title,
          instructions: cand.instructions,
          priority: 'medium',
          dueDate: cand.suggested_due_date || new Date(Date.now() + 86400000).toISOString(),
          assigneeUserIds: cand.suggested_assignee_id ? [cand.suggested_assignee_id] : [],
        });

        meetingStore.updateActionCandidate(cand.id, {
          status: 'confirmed',
          created_task_id: createdTask.id,
        });
      } else {
        // Employees create private personal tasks
        const taskId = generateId('task');
        const dueDate = cand.suggested_due_date || new Date(Date.now() + 86400000).toISOString();
        tasksStore.insertTask({
          id: taskId,
          userId,
          title: cand.title,
          priority: 'Medium',
          category: 'general',
          dueDate,
          isCompleted: false,
        });

        meetingStore.updateActionCandidate(cand.id, {
          status: 'confirmed',
          created_task_id: taskId,
        });
      }

      setItems((prev) =>
        prev.map((c) => (c.id === cand.id ? { ...c, status: 'confirmed' } : c))
      );

      Alert.alert(
        'Action Created',
        isManager
          ? 'Business task assigned successfully.'
          : 'Personal task added to your schedule.'
      );

      if (onCandidateProcessed) onCandidateProcessed();
    } catch (err) {
      console.warn('[ActionCandidatesModal] Failed to confirm task:', err);
      Alert.alert('Error', 'Failed to create task from action candidate.');
    }
  };

  const handleDiscardCandidate = (candId: string) => {
    meetingStore.updateActionCandidate(candId, { status: 'discarded' });
    setItems((prev) =>
      prev.map((c) => (c.id === candId ? { ...c, status: 'discarded' } : c))
    );
    if (onCandidateProcessed) onCandidateProcessed();
  };

  const pendingCount = items.filter((c) => c.status === 'pending_review').length;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.modalContainer, themed.modalContainer]}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.titleRow}>
              <Sparkles size={20} color={colors.yellow} />
              <Text style={[styles.modalTitle, themed.text]}>Review Action Candidates</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.subtitle, themed.mutedText]}>
            Extracted from spoken commands (Set, Create, Schedule). These items are never auto-executed.
          </Text>

          {/* List of candidates */}
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {items.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyText, themed.mutedText]}>
                  No action commands detected in this meeting.
                </Text>
              </View>
            ) : (
              items.map((cand) => {
                const isEditing = editingId === cand.id;
                const isPending = cand.status === 'pending_review';
                const isConfirmed = cand.status === 'confirmed';

                return (
                  <View
                    key={cand.id}
                    style={[
                      styles.card,
                      themed.card,
                      isConfirmed && styles.confirmedCard,
                    ]}
                  >
                    {isEditing ? (
                      <View style={styles.editSection}>
                        <Text style={[styles.inputLabel, themed.mutedText]}>Task Title</Text>
                        <TextInput
                          style={[styles.input, themed.input]}
                          value={editedTitle}
                          onChangeText={setEditedTitle}
                          placeholder="Action title..."
                          placeholderTextColor={colors.textMuted}
                        />

                        <Text style={[styles.inputLabel, themed.mutedText]}>Instructions / Context</Text>
                        <TextInput
                          style={[styles.input, styles.multilineInput, themed.input]}
                          value={editedInstructions}
                          onChangeText={setEditedInstructions}
                          multiline
                          placeholder="Instructions..."
                          placeholderTextColor={colors.textMuted}
                        />

                        {isManager && roster.length > 0 && (
                          <View style={styles.assigneePicker}>
                            <Text style={[styles.inputLabel, themed.mutedText]}>Assignee</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                              {roster.map((m) => {
                                const selected = editedAssigneeId === m.id;
                                return (
                                  <TouchableOpacity
                                    key={m.id}
                                    style={[
                                      styles.rosterChip,
                                      selected && { backgroundColor: colors.blue },
                                    ]}
                                    onPress={() =>
                                      setEditedAssigneeId(selected ? null : m.id)
                                    }
                                  >
                                    <Text
                                      style={[
                                        styles.rosterChipText,
                                        selected && { color: '#FFF' },
                                      ]}
                                    >
                                      {m.name || m.email}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </ScrollView>
                          </View>
                        )}

                        <View style={styles.editActions}>
                          <TouchableOpacity
                            style={[styles.saveBtn, { backgroundColor: colors.success }]}
                            onPress={() => handleSaveEdit(cand.id)}
                          >
                            <Check size={16} color="#FFF" />
                            <Text style={styles.btnText}>Save</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.cancelBtn, themed.cancelBtn]}
                            onPress={() => setEditingId(null)}
                          >
                            <Text style={[styles.cancelBtnText, themed.text]}>Cancel</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <View>
                        <View style={styles.cardHeader}>
                          <Text style={[styles.candTitle, themed.text]}>{cand.title}</Text>
                          <View
                            style={[
                              styles.statusPill,
                              cand.status === 'confirmed'
                                ? { backgroundColor: colors.success + '20' }
                                : cand.status === 'discarded'
                                ? { backgroundColor: '#9CA3AF20' }
                                : { backgroundColor: colors.yellow + '20' },
                            ]}
                          >
                            <Text
                              style={[
                                styles.statusPillText,
                                cand.status === 'confirmed'
                                  ? { color: colors.success }
                                  : cand.status === 'discarded'
                                  ? { color: '#6B7280' }
                                  : { color: colors.yellow },
                              ]}
                            >
                              {cand.status === 'confirmed'
                                ? 'Confirmed'
                                : cand.status === 'discarded'
                                ? 'Discarded'
                                : 'Pending Review'}
                            </Text>
                          </View>
                        </View>

                        <Text style={[styles.candInstructions, themed.mutedText]}>
                          "{cand.instructions}"
                        </Text>

                        <View style={styles.metaRow}>
                          {cand.suggested_assignee_name && (
                            <View style={styles.metaItem}>
                              <User size={13} color={colors.blue} />
                              <Text style={[styles.metaText, { color: colors.blue }]}>
                                {cand.suggested_assignee_name}
                              </Text>
                            </View>
                          )}
                          {cand.suggested_due_date && (
                            <View style={styles.metaItem}>
                              <Calendar size={13} color={colors.textMuted} />
                              <Text style={[styles.metaText, themed.mutedText]}>
                                {new Date(cand.suggested_due_date).toLocaleDateString()}
                              </Text>
                            </View>
                          )}
                        </View>

                        {isPending && (
                          <View style={styles.actionRow}>
                            <TouchableOpacity
                              style={[styles.editBtn, themed.outlineBtn]}
                              onPress={() => handleStartEdit(cand)}
                            >
                              <Text style={[styles.editBtnText, themed.text]}>Edit</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[
                                styles.confirmBtn,
                                {
                                  backgroundColor: isManager
                                    ? colors.red
                                    : colors.blue,
                                },
                              ]}
                              onPress={() => handleConfirmCandidate(cand)}
                            >
                              <CheckCircle size={15} color="#FFF" />
                              <Text style={styles.confirmBtnText}>
                                {isManager
                                  ? 'Create Business Task'
                                  : 'Create Personal Task'}
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={styles.discardBtn}
                              onPress={() => handleDiscardCandidate(cand.id)}
                            >
                              <Trash2 size={16} color="#EF4444" />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footerRow}>
            <Text style={[styles.footerStatus, themed.mutedText]}>
              {pendingCount} candidate{pendingCount === 1 ? '' : 's'} remaining
            </Text>
            <TouchableOpacity style={[styles.doneBtn, { backgroundColor: colors.blue }]} onPress={onClose}>
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const getThemedStyles = (colors: ThemeColors) => ({
  modalContainer: {
    backgroundColor: colors.cardBg,
  },
  card: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  input: {
    backgroundColor: colors.inputBg,
    color: colors.textPrimary,
    borderColor: colors.border,
  },
  text: {
    color: colors.textPrimary,
  },
  mutedText: {
    color: colors.textMuted,
  },
  outlineBtn: {
    borderColor: colors.border,
  },
  cancelBtn: {
    borderColor: colors.border,
  },
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    maxHeight: '85%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    ...Shadows.card,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modalTitle: {
    fontSize: 17,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  closeBtn: {
    padding: 6,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: Fonts.body,
    marginBottom: 12,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    fontFamily: Fonts.body,
  },
  card: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  confirmedCard: {
    opacity: 0.7,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  candTitle: {
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    flex: 1,
    marginRight: 6,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  statusPillText: {
    fontSize: 10,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  candInstructions: {
    fontSize: 12,
    fontFamily: Fonts.body,
    fontStyle: 'italic',
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 11,
    fontFamily: Fonts.body,
    fontWeight: '500',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  editBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
  },
  editBtnText: {
    fontSize: 12,
    fontFamily: Fonts.body,
    fontWeight: '500',
  },
  confirmBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  confirmBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  discardBtn: {
    padding: 6,
  },
  editSection: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 11,
    fontFamily: Fonts.heading,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    fontFamily: Fonts.body,
  },
  multilineInput: {
    minHeight: 50,
    textAlignVertical: 'top',
  },
  assigneePicker: {
    marginTop: 4,
  },
  rosterChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    marginRight: 6,
  },
  rosterChipText: {
    fontSize: 11,
    fontFamily: Fonts.body,
    fontWeight: '500',
    color: '#374151',
  },
  editActions: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  cancelBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
  },
  btnText: {
    color: '#FFF',
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  cancelBtnText: {
    fontSize: 12,
    fontFamily: Fonts.body,
    fontWeight: '500',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 10,
    marginTop: 6,
  },
  footerStatus: {
    fontSize: 12,
    fontFamily: Fonts.body,
    fontWeight: '500',
  },
  doneBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  doneBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
});
