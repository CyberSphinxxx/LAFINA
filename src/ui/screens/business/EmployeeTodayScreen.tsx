import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, Layout, Shadows } from '../../theme';
import type { ThemeColors } from '../../contexts/ThemeContext';
import {
  CheckCircle2,
  Clock,
  MessageSquare,
  Play,
  Send,
  AlertCircle,
  Settings,
} from 'lucide-react-native';
import { SyncStatusIndicator } from '../../components/business/SyncStatusIndicator';

export interface AssignedTaskItem {
  id: string;
  title: string;
  instructions: string;
  managerName: string;
  priority: 'High' | 'Medium' | 'Low';
  dueTime: string;
  status: 'todo' | 'in_progress' | 'pending_review' | 'completed';
  commentsCount: number;
}

interface EmployeeTodayProps {
  businessName?: string;
  tasks?: AssignedTaskItem[];
  onUpdateStatus?: (taskId: string, newStatus: 'in_progress' | 'pending_review') => void;
  onOpenTaskComments?: (taskId: string) => void;
  onOpenProfile: () => void;
  isLeaseActive?: boolean;
}

export const EmployeeTodayScreen: React.FC<EmployeeTodayProps> = ({
  businessName = 'My Business',
  tasks = [
    {
      id: 'demo-1',
      title: 'Review Midterm Course Syllabus',
      instructions: 'Cross-check lab requirements and update room schedule.',
      managerName: 'Prof. Garcia',
      priority: 'High',
      dueTime: '2:00 PM',
      status: 'todo',
      commentsCount: 2,
    },
    {
      id: 'demo-2',
      title: 'Prepare Lab Equipment Checklist',
      instructions: 'Ensure oscilloscope probes are calibrated before 4 PM session.',
      managerName: 'Prof. Garcia',
      priority: 'Medium',
      dueTime: '4:30 PM',
      status: 'in_progress',
      commentsCount: 0,
    },
  ],
  onUpdateStatus,
  onOpenTaskComments,
  onOpenProfile,
  isLeaseActive = true,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'High':
        return '#DC2626';
      case 'Medium':
        return '#D97706';
      case 'Low':
      default:
        return '#2563EB';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'in_progress':
        return { label: 'In Progress', bg: '#FEF3C7', color: '#D97706' };
      case 'pending_review':
        return { label: 'Pending Review', bg: '#EDE9FE', color: '#7C3AED' };
      case 'completed':
        return { label: 'Completed', bg: '#DCFCE7', color: '#16A34A' };
      case 'todo':
      default:
        return { label: 'To Do', bg: '#F3F4F6', color: '#6B7280' };
    }
  };

  return (
    <View style={[styles.screen, themed.screen]}>
      {/* Header */}
      <View style={[styles.header, themed.header]}>
        <View>
          <Text style={[styles.orgName, themed.orgName]}>{businessName}</Text>
          <Text style={[styles.roleBadge, themed.roleBadge]}>Employee Workspace</Text>
        </View>
        <View style={styles.headerRight}>
          <SyncStatusIndicator status={isLeaseActive ? 'synced' : 'locked'} />
          <TouchableOpacity
            style={[styles.avatarButton, themed.avatarButton]}
            onPress={onOpenProfile}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Account and Settings"
          >
            <Settings size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Offline Lease Lock Alert */}
        {!isLeaseActive && (
          <View style={[styles.warningBanner, { backgroundColor: '#FEE2E2', borderColor: '#DC2626' }]}>
            <AlertCircle size={20} color="#DC2626" />
            <Text style={[styles.warningText, { color: '#991B1B' }]}>
              Offline Business lease expired (24h limit). Connect to internet to refresh.
            </Text>
          </View>
        )}

        <Text style={[styles.sectionTitle, themed.sectionTitle]}>Today's Assigned Tasks</Text>

        {tasks.length === 0 ? (
          <View style={[styles.emptyCard, themed.card]}>
            <CheckCircle2 size={40} color={colors.red} />
            <Text style={[styles.emptyTitle, themed.text]}>All caught up!</Text>
            <Text style={[styles.emptySubtitle, themed.mutedText]}>
              No pending assignments for today.
            </Text>
          </View>
        ) : (
          tasks.map((task) => {
            const badge = getStatusBadge(task.status);
            return (
              <View key={task.id} style={[styles.taskCard, themed.card, Shadows.card]}>
                {/* Header row */}
                <View style={styles.taskCardHeader}>
                  <View
                    style={[
                      styles.priorityBadge,
                      { backgroundColor: getPriorityColor(task.priority) },
                    ]}
                  >
                    <Text style={styles.priorityText}>{task.priority}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.statusText, { color: badge.color }]}>{badge.label}</Text>
                  </View>
                </View>

                {/* Title and instructions */}
                <Text style={[styles.taskTitle, themed.text]}>{task.title}</Text>
                <Text style={[styles.taskInstructions, themed.mutedText]}>{task.instructions}</Text>

                {/* Meta info */}
                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <Clock size={14} color={colors.textMuted} />
                    <Text style={[styles.metaText, themed.mutedText]}>Due {task.dueTime}</Text>
                  </View>
                  <Text style={[styles.metaText, themed.mutedText]}>From {task.managerName}</Text>
                </View>

                {/* Actions row */}
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.commentBtn}
                    onPress={() => onOpenTaskComments?.(task.id)}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={`${task.commentsCount} comments on task`}
                  >
                    <MessageSquare size={16} color={colors.textMuted} />
                    <Text style={[styles.commentBtnText, themed.mutedText]}>
                      {task.commentsCount} Comments
                    </Text>
                  </TouchableOpacity>

                  {task.status === 'todo' && (
                    <TouchableOpacity
                      style={[styles.primaryActionBtn, { backgroundColor: colors.blue }]}
                      onPress={() => onUpdateStatus?.(task.id, 'in_progress')}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="Start working on task"
                    >
                      <Play size={14} color="#FFF" />
                      <Text style={styles.btnText}>Start</Text>
                    </TouchableOpacity>
                  )}

                  {task.status === 'in_progress' && (
                    <TouchableOpacity
                      style={[styles.primaryActionBtn, { backgroundColor: colors.red }]}
                      onPress={() => onUpdateStatus?.(task.id, 'pending_review')}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="Submit task for manager review"
                    >
                      <Send size={14} color="#FFF" />
                      <Text style={styles.btnText}>Submit for Review</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
};

const getThemedStyles = (colors: ThemeColors) => ({
  screen: { backgroundColor: colors.background },
  header: { backgroundColor: colors.cardBg, borderBottomColor: colors.border },
  orgName: { color: colors.textPrimary },
  roleBadge: { color: colors.blue },
  card: { backgroundColor: colors.cardBg, borderColor: colors.border },
  sectionTitle: { color: colors.textPrimary },
  text: { color: colors.textPrimary },
  mutedText: { color: colors.textMuted },
  avatarButton: { backgroundColor: colors.background, borderColor: colors.border },
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
  orgName: {
    fontSize: 20,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  roleBadge: {
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: '600',
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
  scrollContent: {
    padding: 20,
    paddingBottom: Layout.navbarHeight + 48,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    gap: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    fontFamily: Fonts.body,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  emptyCard: {
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    fontFamily: Fonts.body,
    marginTop: 4,
  },
  taskCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  taskCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  priorityText: {
    color: '#FFF',
    fontSize: 10,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 11,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  taskTitle: {
    fontSize: 16,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  taskInstructions: {
    fontSize: 13,
    fontFamily: Fonts.body,
    lineHeight: 18,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 10,
    marginBottom: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    fontFamily: Fonts.body,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  commentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 4,
  },
  commentBtnText: {
    fontSize: 12,
    fontFamily: Fonts.body,
  },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    minHeight: 36,
  },
  btnText: {
    color: '#FFF',
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
});
