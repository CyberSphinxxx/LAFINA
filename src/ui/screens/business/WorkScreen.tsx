import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ScrollView,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, Layout, Shadows } from '../../theme';
import type { ThemeColors } from '../../contexts/ThemeContext';
import {
  CheckSquare,
  Calendar as CalendarIcon,
  FileText,
  Eye,
  EyeOff,
  Settings,
  Plus,
  Clock,
  CheckCircle2,
  Play,
  RotateCcw,
  User,
  Mic,
  Sparkles,
} from 'lucide-react-native';
import { SyncStatusIndicator } from '../../components/business/SyncStatusIndicator';
import {
  businessTasksStore,
  businessWorkBlocksStore,
  tasksStore,
  meetingStore,
  businessStore,
} from '../../../storage';
import type { Task } from '../../../storage';
import type {
  BusinessTaskWithAssignments,
  BusinessTaskAssignmentRow,
  BusinessWorkBlockRow,
  TaskAssignmentStatus,
  LocalBusinessMeetingRow,
} from '../../../storage/syncTypes';
import { MeetingRecordModal } from './MeetingRecordModal';
import { MeetingDetailScreen } from './MeetingDetailScreen';
import { fetchMeetingsFromCloud } from '../../../cloud/meetingService';
import { RosterMember } from '../../../ai/meeting/actionCandidateExtractor';

export type WorkSubTab = 'tasks' | 'calendar' | 'notes' | 'meetings';
export type TaskFilter = 'all' | 'due_today' | 'pending_review' | 'needs_assignee';

interface WorkScreenProps {
  userId: string;
  businessId?: string;
  isManager?: boolean;
  onOpenProfile: () => void;
  isLeaseActive?: boolean;
  onNewTaskPress?: () => void;
  onScheduleBlockPress?: () => void;
  onOpenReviewModal?: (task: BusinessTaskWithAssignments, assignment: BusinessTaskAssignmentRow) => void;
}

export const WorkScreen: React.FC<WorkScreenProps> = ({
  userId,
  businessId = 'default_biz',
  isManager = false,
  onOpenProfile,
  isLeaseActive = true,
  onNewTaskPress,
  onScheduleBlockPress,
  onOpenReviewModal,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);

  const [activeSubTab, setActiveSubTab] = useState<WorkSubTab>('tasks');
  const [showPersonalLayer, setShowPersonalLayer] = useState(true);
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all');
  const [refreshKey, setRefreshKey] = useState(0);

  // Meeting states
  const [meetings, setMeetings] = useState<LocalBusinessMeetingRow[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [roster, setRoster] = useState<RosterMember[]>([]);

  const loadMeetings = useCallback(async () => {
    try {
      const localMeetings = meetingStore.getMeetingsForBusiness(businessId);
      setMeetings(localMeetings);
      // Background cloud catch-up
      fetchMeetingsFromCloud(businessId).then((synced) => {
        if (synced && synced.length > 0) {
          setMeetings(synced);
        }
      }).catch(() => {});
    } catch {}
  }, [businessId]);

  const loadRoster = useCallback(() => {
    try {
      const members = businessStore.getMembers(businessId);
      setRoster(
        members.map((m) => ({
          id: m.user_id,
          name: m.email.split('@')[0],
          email: m.email,
        }))
      );
    } catch {}
  }, [businessId]);

  useEffect(() => {
    loadMeetings();
    loadRoster();
  }, [loadMeetings, loadRoster, refreshKey]);

  // Load Business Tasks
  const allTasks = businessTasksStore.getTasksForBusiness(businessId);
  const filteredTasks = allTasks.filter((task) => {
    if (taskFilter === 'needs_assignee') {
      return task.assignments.length === 0 && !task.is_cancelled;
    }
    if (taskFilter === 'pending_review') {
      return task.assignments.some((a) => a.status === 'pending_review');
    }
    if (taskFilter === 'due_today') {
      if (!task.due_date) return false;
      const todayStr = new Date().toISOString().split('T')[0];
      return task.due_date.startsWith(todayStr);
    }
    return true;
  });

  // Load Work Blocks
  const workBlocks: BusinessWorkBlockRow[] = isManager
    ? businessWorkBlocksStore.getWorkBlocksForBusiness(businessId)
    : businessWorkBlocksStore.getWorkBlocksForUser(businessId, userId);

  // Load Personal Items if personal layer enabled
  const personalTasks: Task[] = showPersonalLayer
    ? tasksStore.getAllTasks(userId).filter((t: Task) => !t.isCompleted)
    : [];

  const handleUpdateStatus = (assignmentId: string, status: TaskAssignmentStatus) => {
    businessTasksStore.updateAssignmentStatus(assignmentId, businessId, userId, status);
    setRefreshKey((prev) => prev + 1);
  };

  if (selectedMeetingId) {
    return (
      <MeetingDetailScreen
        meetingId={selectedMeetingId}
        businessId={businessId}
        userId={userId}
        isManager={isManager}
        onBack={() => {
          setSelectedMeetingId(null);
          loadMeetings();
        }}
      />
    );
  }

  return (
    <View style={[styles.screen, themed.screen]} key={refreshKey}>
      {/* Header */}
      <View style={[styles.header, themed.header]}>
        <View>
          <Text style={[styles.headerTitle, themed.text]}>Work Hub</Text>
          <Text style={[styles.headerSubtitle, themed.mutedText]}>
            Team projects, schedule, and notes
          </Text>
        </View>
        <View style={styles.headerRight}>
          <SyncStatusIndicator status={isLeaseActive ? 'synced' : 'locked'} />
          <TouchableOpacity
            style={[styles.avatarButton, themed.avatarButton]}
            onPress={onOpenProfile}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Open profile settings"
          >
            <Settings size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Sub-tab switcher */}
      <View style={[styles.subTabContainer, themed.subTabContainer]}>
        <TouchableOpacity
          style={[
            styles.subTab,
            activeSubTab === 'tasks' && [styles.activeSubTab, { borderBottomColor: colors.red }],
          ]}
          onPress={() => setActiveSubTab('tasks')}
          accessible={true}
          accessibilityRole="tab"
          accessibilityLabel="Tasks subtab"
          accessibilityState={{ selected: activeSubTab === 'tasks' }}
        >
          <CheckSquare
            size={18}
            color={activeSubTab === 'tasks' ? colors.red : colors.textMuted}
          />
          <Text
            style={[
              styles.subTabText,
              activeSubTab === 'tasks'
                ? [styles.activeSubTabText, { color: colors.red }]
                : themed.mutedText,
            ]}
          >
            Tasks
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.subTab,
            activeSubTab === 'calendar' && [styles.activeSubTab, { borderBottomColor: colors.red }],
          ]}
          onPress={() => setActiveSubTab('calendar')}
          accessible={true}
          accessibilityRole="tab"
          accessibilityLabel="Calendar subtab"
          accessibilityState={{ selected: activeSubTab === 'calendar' }}
        >
          <CalendarIcon
            size={18}
            color={activeSubTab === 'calendar' ? colors.red : colors.textMuted}
          />
          <Text
            style={[
              styles.subTabText,
              activeSubTab === 'calendar'
                ? [styles.activeSubTabText, { color: colors.red }]
                : themed.mutedText,
            ]}
          >
            Calendar
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.subTab,
            activeSubTab === 'notes' && [styles.activeSubTab, { borderBottomColor: colors.red }],
          ]}
          onPress={() => setActiveSubTab('notes')}
          accessible={true}
          accessibilityRole="tab"
          accessibilityLabel="Notes subtab"
          accessibilityState={{ selected: activeSubTab === 'notes' }}
        >
          <FileText
            size={18}
            color={activeSubTab === 'notes' ? colors.red : colors.textMuted}
          />
          <Text
            style={[
              styles.subTabText,
              activeSubTab === 'notes'
                ? [styles.activeSubTabText, { color: colors.red }]
                : themed.mutedText,
            ]}
          >
            Notes
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.subTab,
            activeSubTab === 'meetings' && [styles.activeSubTab, { borderBottomColor: colors.red }],
          ]}
          onPress={() => setActiveSubTab('meetings')}
          accessible={true}
          accessibilityRole="tab"
          accessibilityLabel="Meetings subtab"
          accessibilityState={{ selected: activeSubTab === 'meetings' }}
        >
          <Mic
            size={18}
            color={activeSubTab === 'meetings' ? colors.red : colors.textMuted}
          />
          <Text
            style={[
              styles.subTabText,
              activeSubTab === 'meetings'
                ? [styles.activeSubTabText, { color: colors.red }]
                : themed.mutedText,
            ]}
          >
            Meetings
          </Text>
        </TouchableOpacity>
      </View>

      {/* Personal Layer Toggle Bar */}
      <View style={[styles.layerToggleBar, themed.layerToggleBar]}>
        <View style={styles.layerInfoRow}>
          {showPersonalLayer ? (
            <Eye size={16} color={colors.blue} />
          ) : (
            <EyeOff size={16} color={colors.textMuted} />
          )}
          <Text style={[styles.layerText, themed.text]}>Personal Private Layer</Text>
        </View>
        <Switch
          value={showPersonalLayer}
          onValueChange={setShowPersonalLayer}
          trackColor={{ false: '#D1D5DB', true: colors.blue }}
          thumbColor="#FFF"
          accessibilityRole="switch"
          accessibilityLabel="Toggle private personal layer visibility"
        />
      </View>

      {/* Main Content Area */}
      <ScrollView
        contentContainerStyle={styles.contentScroll}
        showsVerticalScrollIndicator={false}
      >
        {/* TASKS SUBTAB */}
        {activeSubTab === 'tasks' && (
          <View style={styles.tabContentWrapper}>
            {/* Header + Action */}
            <View style={styles.tabHeaderRow}>
              <Text style={[styles.tabSectionTitle, themed.text]}>Shared Business Tasks</Text>
              {isManager && (
                <TouchableOpacity
                  style={[styles.addTaskBtn, { backgroundColor: colors.red }]}
                  onPress={onNewTaskPress}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="Create New Business Task"
                >
                  <Plus size={16} color="#FFF" />
                  <Text style={styles.addTaskText}>Assign Task</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Filter Chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
              {(['all', 'due_today', 'pending_review', 'needs_assignee'] as TaskFilter[]).map((f) => {
                const isSelected = taskFilter === f;
                const labels: Record<TaskFilter, string> = {
                  all: 'All',
                  due_today: 'Due Today',
                  pending_review: 'Pending Review',
                  needs_assignee: 'Needs Assignee',
                };
                return (
                  <TouchableOpacity
                    key={f}
                    style={[
                      styles.filterChip,
                      isSelected && { backgroundColor: colors.red, borderColor: colors.red },
                    ]}
                    onPress={() => setTaskFilter(f)}
                    accessibilityRole="button"
                    accessibilityLabel={`Filter ${labels[f]}`}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        themed.text,
                        isSelected && { color: '#FFF', fontWeight: 'bold' },
                      ]}
                    >
                      {labels[f]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Tasks List */}
            {filteredTasks.length === 0 ? (
              <View style={[styles.placeholderCard, themed.card, Shadows.card]}>
                <CheckSquare size={36} color={colors.red} />
                <Text style={[styles.cardHeadline, themed.text]}>No Tasks Found</Text>
                <Text style={[styles.cardDescription, themed.mutedText]}>
                  {taskFilter === 'all'
                    ? 'No collaborative tasks have been assigned yet.'
                    : `No tasks match the filter: ${taskFilter}`}
                </Text>
              </View>
            ) : (
              filteredTasks.map((task) => {
                const myAssignment = task.assignments.find((a) => a.user_id === userId);
                return (
                  <View key={task.id} style={[styles.taskCard, themed.card, Shadows.card]}>
                    <View style={styles.taskCardHeader}>
                      <View style={styles.taskTitleRow}>
                        <Text style={[styles.taskCardTitle, themed.text]}>{task.title}</Text>
                        <View
                          style={[
                            styles.priorityTag,
                            {
                              backgroundColor:
                                task.priority === 'high'
                                  ? '#FEE2E2'
                                  : task.priority === 'medium'
                                  ? '#FEF3C7'
                                  : '#EFF6FF',
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.priorityTagText,
                              {
                                color:
                                  task.priority === 'high'
                                    ? '#DC2626'
                                    : task.priority === 'medium'
                                    ? '#D97706'
                                    : '#2563EB',
                              },
                            ]}
                          >
                            {task.priority.toUpperCase()}
                          </Text>
                        </View>
                      </View>

                      {task.instructions ? (
                        <Text style={[styles.taskCardInstructions, themed.mutedText]}>
                          {task.instructions}
                        </Text>
                      ) : null}

                      {task.due_date ? (
                        <View style={styles.dueRow}>
                          <Clock size={13} color={colors.textMuted} />
                          <Text style={[styles.dueText, themed.mutedText]}>
                            Due: {new Date(task.due_date).toLocaleDateString()}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {/* Assignees & Status Progression */}
                    <View style={[styles.assigneesSection, themed.borderTop]}>
                      <Text style={[styles.assigneesSectionTitle, themed.mutedText]}>
                        ASSIGNEES ({task.assignments.length}):
                      </Text>
                      {task.assignments.length === 0 ? (
                        <Text style={[styles.needsAssigneeAlert, { color: '#DC2626' }]}>
                          ⚠️ Needs Assignee
                        </Text>
                      ) : (
                        task.assignments.map((assignment) => (
                          <View key={assignment.id} style={styles.assigneeRow}>
                            <View style={styles.assigneeUserCol}>
                              <User size={14} color={colors.textSecondary} />
                              <Text style={[styles.assigneeUserId, themed.text]}>
                                {assignment.user_id === userId ? 'You' : assignment.user_id.slice(0, 8)}
                              </Text>
                            </View>

                            <View style={styles.assigneeStatusCol}>
                              <View
                                style={[
                                  styles.statusBadge,
                                  {
                                    backgroundColor:
                                      assignment.status === 'completed'
                                        ? '#DCFCE7'
                                        : assignment.status === 'pending_review'
                                        ? '#FEF3C7'
                                        : assignment.status === 'in_progress'
                                        ? '#EFF6FF'
                                        : '#F3F4F6',
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.statusBadgeText,
                                    {
                                      color:
                                        assignment.status === 'completed'
                                          ? '#16A34A'
                                          : assignment.status === 'pending_review'
                                          ? '#D97706'
                                          : assignment.status === 'in_progress'
                                          ? '#2563EB'
                                          : '#4B5563',
                                    },
                                  ]}
                                >
                                  {assignment.status.replace('_', ' ').toUpperCase()}
                                </Text>
                              </View>

                              {/* Manager Review Action */}
                              {isManager && assignment.status === 'pending_review' && onOpenReviewModal && (
                                <TouchableOpacity
                                  style={[styles.actionBtn, { backgroundColor: colors.blue }]}
                                  onPress={() => onOpenReviewModal(task, assignment)}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Review assignment for ${assignment.user_id}`}
                                >
                                  <Text style={styles.actionBtnText}>Review</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          </View>
                        ))
                      )}

                      {/* Employee Self Actions */}
                      {!isManager && myAssignment && myAssignment.status !== 'completed' && (
                        <View style={styles.employeeActionRow}>
                          {myAssignment.status === 'todo' && (
                            <TouchableOpacity
                              style={[styles.selfActionBtn, { backgroundColor: colors.blue }]}
                              onPress={() => handleUpdateStatus(myAssignment.id, 'in_progress')}
                              accessibilityRole="button"
                              accessibilityLabel="Start working on task"
                            >
                              <Play size={14} color="#FFF" />
                              <Text style={styles.selfActionBtnText}>Start Working</Text>
                            </TouchableOpacity>
                          )}
                          {myAssignment.status === 'in_progress' && (
                            <TouchableOpacity
                              style={[styles.selfActionBtn, { backgroundColor: colors.success }]}
                              onPress={() => handleUpdateStatus(myAssignment.id, 'pending_review')}
                              accessibilityRole="button"
                              accessibilityLabel="Submit task for review"
                            >
                              <CheckCircle2 size={14} color="#FFF" />
                              <Text style={styles.selfActionBtnText}>Submit for Review</Text>
                            </TouchableOpacity>
                          )}
                          {myAssignment.manager_review_status === 'reopened' && myAssignment.reopened_reason && (
                            <View style={[styles.reopenedFeedbackBox, { backgroundColor: '#FEE2E2' }]}>
                              <RotateCcw size={14} color="#DC2626" />
                              <Text style={[styles.reopenedFeedbackText, { color: '#991B1B' }]}>
                                {`Manager Feedback: ${myAssignment.reopened_reason}`}
                              </Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* CALENDAR SUBTAB */}
        {activeSubTab === 'calendar' && (
          <View style={styles.tabContentWrapper}>
            <View style={styles.tabHeaderRow}>
              <Text style={[styles.tabSectionTitle, themed.text]}>Team Schedule & Work Blocks</Text>
              {isManager && onScheduleBlockPress && (
                <TouchableOpacity
                  style={[styles.addTaskBtn, { backgroundColor: colors.blue }]}
                  onPress={onScheduleBlockPress}
                  accessibilityRole="button"
                  accessibilityLabel="Schedule Work Block"
                >
                  <Plus size={16} color="#FFF" />
                  <Text style={styles.addTaskText}>Schedule Block</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Work Blocks List */}
            {workBlocks.length === 0 ? (
              <View style={[styles.placeholderCard, themed.card, Shadows.card]}>
                <CalendarIcon size={36} color={colors.blue} />
                <Text style={[styles.cardHeadline, themed.text]}>No Work Blocks</Text>
                <Text style={[styles.cardDescription, themed.mutedText]}>
                  No scheduled work shifts or lab blocks found.
                </Text>
              </View>
            ) : (
              workBlocks.map((block) => (
                <View key={block.id} style={[styles.blockCard, themed.card, Shadows.card]}>
                  <View style={[styles.blockColorStrip, { backgroundColor: colors.blue }]} />
                  <View style={styles.blockBody}>
                    <Text style={[styles.blockTitle, themed.text]}>{block.title}</Text>
                    <Text style={[styles.blockTime, themed.mutedText]}>
                      {`${new Date(block.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(block.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                    </Text>
                    {block.recurrence_rule ? (
                      <Text style={[styles.recurrenceText, { color: colors.blue }]}>
                        🔄 {block.recurrence_rule}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))
            )}

            {/* Personal Layer Items */}
            {showPersonalLayer && personalTasks.length > 0 && (
              <View style={styles.personalLayerSection}>
                <Text style={[styles.layerSectionHeader, themed.text]}>
                  Private Personal Layer (7 Days)
                </Text>
                {personalTasks.map((pt) => (
                  <View key={pt.id} style={[styles.personalCard, themed.card, Shadows.card]}>
                    <View style={[styles.blockColorStrip, { backgroundColor: colors.yellow }]} />
                    <View style={styles.blockBody}>
                      <Text style={[styles.blockTitle, themed.text]}>{pt.title}</Text>
                      <Text style={[styles.blockTime, themed.mutedText]}>
                        Personal Due: {pt.dueDate || 'Unscheduled'}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* NOTES SUBTAB */}
        {activeSubTab === 'notes' && (
          <View style={styles.tabContentWrapper}>
            <Text style={[styles.tabSectionTitle, themed.text]}>
              Linked Task To-Dos in Notes
            </Text>
            <Text style={[styles.notesExplainer, themed.mutedText]}>
              Assigned tasks render as interactive to-do components backed directly by assignment rows without duplicating note bodies.
            </Text>

            {filteredTasks.length === 0 ? (
              <View style={[styles.placeholderCard, themed.card, Shadows.card]}>
                <FileText size={36} color="#8B5CF6" />
                <Text style={[styles.cardHeadline, themed.text]}>No Linked To-Dos</Text>
                <Text style={[styles.cardDescription, themed.mutedText]}>
                  Create or assign tasks to view them as interactive checkboxes in notes.
                </Text>
              </View>
            ) : (
              filteredTasks.map((task) => {
                const myAssign = task.assignments.find((a) => a.user_id === userId);
                const isCompleted = myAssign?.status === 'completed';
                return (
                  <View key={task.id} style={[styles.noteTodoRow, themed.card, Shadows.card]}>
                    <TouchableOpacity
                      style={[
                        styles.todoCheckbox,
                        isCompleted && { backgroundColor: colors.success, borderColor: colors.success },
                      ]}
                      onPress={() => {
                        if (myAssign) {
                          handleUpdateStatus(
                            myAssign.id,
                            isCompleted ? 'in_progress' : 'completed'
                          );
                        }
                      }}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isCompleted }}
                      accessibilityLabel={`Toggle ${task.title}`}
                    >
                      {isCompleted && <Text style={styles.checkmark}>✓</Text>}
                    </TouchableOpacity>
                    <View style={styles.todoTextContainer}>
                      <Text
                        style={[
                          styles.todoTitle,
                          themed.text,
                          isCompleted && styles.completedTodoTitle,
                        ]}
                      >
                        {task.title}
                      </Text>
                      <Text style={[styles.todoMeta, themed.mutedText]}>
                        Priority: {task.priority.toUpperCase()} • Assignees: {task.assignments.length}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* MEETINGS SUBTAB */}
        {activeSubTab === 'meetings' && (
          <View style={styles.tabContentWrapper}>
            <View style={styles.tabHeaderRow}>
              <View>
                <Text style={[styles.tabSectionTitle, themed.text]}>Meeting Transcriptions</Text>
                <Text style={[styles.notesExplainer, themed.mutedText]}>
                  Offline Whisper.cpp recording up to 60m with spoken action extraction.
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.addTaskBtn, { backgroundColor: colors.red }]}
                onPress={() => setShowRecordModal(true)}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Record New Meeting"
              >
                <Mic size={16} color="#FFF" />
                <Text style={styles.addTaskText}>Record</Text>
              </TouchableOpacity>
            </View>

            {meetings.length === 0 ? (
              <View style={[styles.placeholderCard, themed.card, Shadows.card]}>
                <Mic size={36} color={colors.red} />
                <Text style={[styles.cardHeadline, themed.text]}>No Meetings Recorded</Text>
                <Text style={[styles.cardDescription, themed.mutedText]}>
                  Record 1-hour team meetings with offline speech-to-text, timestamps, and action extraction.
                </Text>
              </View>
            ) : (
              meetings.map((m) => {
                const durationMins = Math.floor(m.duration_seconds / 60);
                const hasSummary = m.summary_status === 'completed';
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.meetingCard, themed.card, Shadows.card]}
                    onPress={() => setSelectedMeetingId(m.id)}
                  >
                    <View style={styles.meetingCardHeader}>
                      <Text style={[styles.meetingCardTitle, themed.text]} numberOfLines={1}>
                        {m.title}
                      </Text>
                      {hasSummary ? (
                        <View style={[styles.summaryBadge, { backgroundColor: colors.blue + '20' }]}>
                          <Sparkles size={11} color={colors.blue} />
                          <Text style={[styles.summaryBadgeText, { color: colors.blue }]}>
                            AI Summary
                          </Text>
                        </View>
                      ) : (
                        <View style={[styles.summaryBadge, { backgroundColor: '#9CA3AF20' }]}>
                          <Text style={[styles.summaryBadgeText, { color: '#6B7280' }]}>
                            Transcript
                          </Text>
                        </View>
                      )}
                    </View>

                    {m.full_transcript ? (
                      <Text style={[styles.meetingExcerpt, themed.mutedText]} numberOfLines={2}>
                        "{m.full_transcript}"
                      </Text>
                    ) : null}

                    <View style={styles.meetingCardMeta}>
                      <View style={styles.metaBadge}>
                        <Clock size={12} color={colors.textMuted} />
                        <Text style={[styles.metaBadgeText, themed.mutedText]}>
                          {durationMins}m
                        </Text>
                      </View>
                      <View style={styles.metaBadge}>
                        <CalendarIcon size={12} color={colors.textMuted} />
                        <Text style={[styles.metaBadgeText, themed.mutedText]}>
                          {new Date(m.created_at).toLocaleDateString()}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        )}
      </ScrollView>

      {/* Meeting Recording Modal */}
      <MeetingRecordModal
        visible={showRecordModal}
        businessId={businessId}
        userId={userId}
        roster={roster}
        onClose={() => {
          setShowRecordModal(false);
          loadMeetings();
        }}
        onMeetingRecorded={(newMeetingId) => {
          setShowRecordModal(false);
          loadMeetings();
          setSelectedMeetingId(newMeetingId);
        }}
      />
    </View>
  );
};

const getThemedStyles = (colors: ThemeColors) => ({
  screen: { backgroundColor: colors.background },
  header: { backgroundColor: colors.cardBg, borderBottomColor: colors.border },
  subTabContainer: { backgroundColor: colors.cardBg, borderBottomColor: colors.border },
  layerToggleBar: { backgroundColor: colors.cardBg, borderColor: colors.border },
  card: { backgroundColor: colors.cardBg, borderColor: colors.border },
  text: { color: colors.textPrimary },
  mutedText: { color: colors.textMuted },
  avatarButton: { backgroundColor: colors.background, borderColor: colors.border },
  borderTop: { borderTopColor: colors.border },
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    fontSize: 12,
    fontFamily: Fonts.body,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatarButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subTabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  subTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    minHeight: 44,
  },
  activeSubTab: {},
  subTabText: {
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  activeSubTabText: {
    fontWeight: 'bold',
  },
  layerToggleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  layerInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  layerText: {
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  contentScroll: {
    padding: 16,
    paddingBottom: Layout.navbarHeight + 48,
  },
  tabContentWrapper: {
    gap: 12,
  },
  tabHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tabSectionTitle: {
    fontSize: 16,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  addTaskBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    minHeight: 32,
  },
  addTaskText: {
    color: '#FFF',
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  filterScroll: {
    marginBottom: 4,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DDDDDD',
    marginRight: 8,
  },
  filterChipText: {
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  taskCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  taskCardHeader: {
    gap: 6,
  },
  taskTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  taskCardTitle: {
    fontSize: 15,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    flex: 1,
  },
  priorityTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  priorityTagText: {
    fontSize: 10,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  taskCardInstructions: {
    fontSize: 13,
    fontFamily: Fonts.body,
    lineHeight: 18,
  },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  dueText: {
    fontSize: 12,
    fontFamily: Fonts.body,
    fontWeight: '500',
  },
  assigneesSection: {
    paddingTop: 10,
    borderTopWidth: 1,
    gap: 8,
  },
  assigneesSectionTitle: {
    fontSize: 11,
    fontFamily: Fonts.heading,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  needsAssigneeAlert: {
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  assigneeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  assigneeUserCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  assigneeUserId: {
    fontSize: 13,
    fontFamily: Fonts.body,
    fontWeight: '500',
  },
  assigneeStatusCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 10,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  actionBtnText: {
    color: '#FFF',
    fontSize: 11,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  employeeActionRow: {
    marginTop: 8,
    gap: 8,
  },
  selfActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
  },
  selfActionBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  reopenedFeedbackBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderRadius: 6,
  },
  reopenedFeedbackText: {
    fontSize: 12,
    fontFamily: Fonts.body,
    fontWeight: '500',
    flex: 1,
  },
  blockCard: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  blockColorStrip: {
    width: 6,
  },
  blockBody: {
    flex: 1,
    padding: 14,
    gap: 4,
  },
  blockTitle: {
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  blockTime: {
    fontSize: 12,
    fontFamily: Fonts.body,
  },
  recurrenceText: {
    fontSize: 11,
    fontFamily: Fonts.body,
    fontWeight: '500',
    marginTop: 2,
  },
  personalLayerSection: {
    marginTop: 16,
    gap: 8,
  },
  layerSectionHeader: {
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  personalCard: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  notesExplainer: {
    fontSize: 13,
    fontFamily: Fonts.body,
    lineHeight: 18,
  },
  noteTodoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    gap: 12,
  },
  todoCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#AAAAAA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  todoTextContainer: {
    flex: 1,
  },
  todoTitle: {
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  completedTodoTitle: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
  todoMeta: {
    fontSize: 11,
    fontFamily: Fonts.body,
    marginTop: 2,
  },
  placeholderCard: {
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    gap: 8,
  },
  cardHeadline: {
    fontSize: 16,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  cardDescription: {
    fontSize: 13,
    fontFamily: Fonts.body,
    textAlign: 'center',
    lineHeight: 18,
  },
  meetingCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    marginBottom: 12,
  },
  meetingCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  meetingCardTitle: {
    fontSize: 15,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    flex: 1,
    marginRight: 8,
  },
  summaryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  summaryBadgeText: {
    fontSize: 10,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  meetingExcerpt: {
    fontSize: 12,
    fontFamily: Fonts.body,
    fontStyle: 'italic',
    lineHeight: 16,
  },
  meetingCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaBadgeText: {
    fontSize: 11,
    fontFamily: Fonts.body,
    fontWeight: '500',
  },
});
