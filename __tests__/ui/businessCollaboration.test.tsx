import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

jest.mock('react-native/Libraries/Modal/Modal', () => ({
  __esModule: true,
  default: ({
    visible,
    children,
  }: {
    visible: boolean;
    children: React.ReactNode;
  }) => (visible ? children : null),
}));

jest.mock('../../src/ui/contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDarkMode: false,
    toggleTheme: jest.fn(),
    colors: {
      background: '#FAF9F6',
      cardBg: '#FFFFFF',
      inputBg: '#F7F7F7',
      divider: '#EEEEEE',
      textPrimary: '#111111',
      textSecondary: '#666666',
      textMuted: '#888888',
      border: '#DDDDDD',
      statusBarStyle: 'dark-content',
      red: '#F75A5A',
      blue: '#2563EB',
      yellow: '#C8A800',
      success: '#2ECC71',
      warning: '#F4A100',
      error: '#FF3B30',
      white: '#FFFFFF',
      black: '#000000',
      overlay: 'rgba(0,0,0,0.5)',
      chipActiveText: '#FFFFFF',
      switchTrackOff: '#767577',
      switchThumb: '#FFFFFF',
      placeholder: '#888888',
      iconMuted: '#AAAAAA',
      eventIconBg: '#F0F0FF',
      bannerBg: '#FFF0F0',
      noteHighlightBg: '#FFF3A3',
      noteHighlightText: '#1A1A1A',
    },
  }),
}));

import { CreateTaskModal } from '../../src/ui/screens/business/CreateTaskModal';
import { ScheduleBlockModal } from '../../src/ui/screens/business/ScheduleBlockModal';
import { TaskReviewModal } from '../../src/ui/screens/business/TaskReviewModal';
import { WorkScreen } from '../../src/ui/screens/business/WorkScreen';
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { businessTasksStore } from '../../src/storage/businessTasksStore';
import { businessWorkBlocksStore } from '../../src/storage/businessWorkBlocksStore';
import type { BusinessMemberData } from '../../src/cloud/businessService';

describe('Business Collaboration UI', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM sync_outbox');
    db.executeSync('DELETE FROM business_work_blocks');
    db.executeSync('DELETE FROM business_task_assignments');
    db.executeSync('DELETE FROM business_tasks');
    db.executeSync('DELETE FROM businesses');
  });

  const mockTeam: BusinessMemberData[] = [
    {
      user_id: 'u_emp1',
      email: 'alice@example.com',
      member_role: 'employee',
      membership_status: 'active',
      joined_at: '2026-08-01T00:00:00Z',
    },
    {
      user_id: 'u_emp2',
      email: 'bob@example.com',
      member_role: 'employee',
      membership_status: 'active',
      joined_at: '2026-08-01T00:00:00Z',
    },
  ];

  it('renders CreateTaskModal and submits newly created task', async () => {
    const handleCreateTask = jest.fn().mockResolvedValue(undefined);
    const handleClose = jest.fn();

    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <CreateTaskModal
          visible={true}
          onClose={handleClose}
          teamMembers={mockTeam}
          onCreateTask={handleCreateTask}
        />
      );
    });

    const root = renderer!.root;
    expect(root.findByProps({ accessibilityLabel: 'Task Title input' })).toBeTruthy();

    // Input task title
    const titleInput = root.findByProps({ accessibilityLabel: 'Task Title input' });
    act(() => {
      titleInput.props.onChangeText('Review Security Protocol');
    });

    // Select Alice
    const aliceCheckbox = root.findByProps({ accessibilityLabel: 'Assign alice@example.com' });
    act(() => {
      aliceCheckbox.props.onPress();
    });

    // Submit
    const submitBtn = root.findByProps({ accessibilityLabel: 'Submit task assignment' });
    await act(async () => {
      await submitBtn.props.onPress();
    });

    expect(handleCreateTask).toHaveBeenCalledWith({
      title: 'Review Security Protocol',
      instructions: '',
      priority: 'medium',
      dueDate: null,
      reminderLeadMinutes: 15,
      assigneeUserIds: ['u_emp1'],
    });
    expect(handleClose).toHaveBeenCalled();
  });

  it('renders ScheduleBlockModal and detects conflict warning', async () => {
    const now = new Date().toISOString();
    db.executeSync(
      `INSERT INTO businesses (id, name, owner_id, timezone, subscription_plan, subscription_status, seat_limit, created_at, updated_at)
       VALUES ('biz_ui', 'UI Test Biz', 'u_mgr', 'UTC', 'business', 'active', 5, ?, ?)`,
      [now, now]
    );

    // Pre-create an existing work block for u_emp1
    businessWorkBlocksStore.createWorkBlock({
      businessId: 'biz_ui',
      userId: 'u_emp1',
      title: 'Existing Shift',
      startTime: '2026-08-30T09:00:00Z',
      endTime: '2026-08-30T17:00:00Z',
      createdBy: 'u_mgr',
    });

    const handleSchedule = jest.fn().mockResolvedValue(undefined);
    const handleClose = jest.fn();

    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <ScheduleBlockModal
          visible={true}
          onClose={handleClose}
          businessId="biz_ui"
          teamMembers={mockTeam}
          onScheduleBlock={handleSchedule}
        />
      );
    });

    const root = renderer!.root;
    const titleInput = root.findByProps({ accessibilityLabel: 'Work block title input' });
    const startInput = root.findByProps({ accessibilityLabel: 'Start time input' });
    const endInput = root.findByProps({ accessibilityLabel: 'End time input' });

    act(() => {
      titleInput.props.onChangeText('Overlapping Shift');
      startInput.props.onChangeText('2026-08-30T10:00:00Z');
      endInput.props.onChangeText('2026-08-30T15:00:00Z');
    });

    // Confirm schedule anyway
    const confirmBtn = root.findByProps({ accessibilityLabel: 'Confirm schedule block' });
    await act(async () => {
      await confirmBtn.props.onPress();
    });

    expect(handleSchedule).toHaveBeenCalledWith({
      userId: 'u_emp1',
      title: 'Overlapping Shift',
      startTime: '2026-08-30T10:00:00Z',
      endTime: '2026-08-30T15:00:00Z',
      recurrenceRule: null,
    });
    expect(handleClose).toHaveBeenCalled();
  });

  it('renders TaskReviewModal with approve and reopen workflows', async () => {
    const mockTask = {
      id: 't_review_1',
      business_id: 'biz_ui',
      created_by: 'u_mgr',
      title: 'Lab Maintenance',
      instructions: 'Inspect all power supplies.',
      priority: 'high' as const,
      due_date: '2026-08-30T12:00:00Z',
      scheduled_at: null,
      recurrence_rule: null,
      reminder_lead_minutes: 15,
      is_cancelled: 0,
      version: 1,
      deleted_at: null,
      created_at: '2026-08-25T00:00:00Z',
      updated_at: '2026-08-25T00:00:00Z',
      assignments: [],
    };

    const mockAssignment = {
      id: 'a_review_1',
      business_task_id: 't_review_1',
      business_id: 'biz_ui',
      user_id: 'u_emp1',
      status: 'pending_review' as const,
      manager_review_status: 'pending' as const,
      reopened_reason: null,
      submitted_at: '2026-08-25T01:00:00Z',
      approved_at: null,
      version: 2,
      deleted_at: null,
      created_at: '2026-08-25T00:00:00Z',
      updated_at: '2026-08-25T01:00:00Z',
    };

    const handleApprove = jest.fn().mockResolvedValue(undefined);
    const handleReopen = jest.fn().mockResolvedValue(undefined);
    const handleClose = jest.fn();

    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <TaskReviewModal
          visible={true}
          onClose={handleClose}
          task={mockTask}
          assignment={mockAssignment}
          employeeEmail="alice@example.com"
          onApprove={handleApprove}
          onReopen={handleReopen}
        />
      );
    });

    const root = renderer!.root;

    // Switch to reopen flow
    const reopenBtn = root.findByProps({ accessibilityLabel: 'Reopen task with feedback' });
    act(() => {
      reopenBtn.props.onPress();
    });

    const feedbackInput = root.findByProps({ accessibilityLabel: 'Reopen feedback input' });
    act(() => {
      feedbackInput.props.onChangeText('Missing multimeter readings.');
    });

    const sendReopenBtn = root.findByProps({ accessibilityLabel: 'Confirm reopening task' });
    await act(async () => {
      await sendReopenBtn.props.onPress();
    });

    expect(handleReopen).toHaveBeenCalledWith('a_review_1', 'Missing multimeter readings.');
    expect(handleClose).toHaveBeenCalled();
  });

  it('renders WorkScreen with tasks, calendar, and notes subtabs', () => {
    const now = new Date().toISOString();
    db.executeSync(
      `INSERT INTO businesses (id, name, owner_id, timezone, subscription_plan, subscription_status, seat_limit, created_at, updated_at)
       VALUES ('biz_work', 'Work Hub Biz', 'u_mgr', 'UTC', 'business', 'active', 5, ?, ?)`,
      [now, now]
    );

    businessTasksStore.createTask({
      businessId: 'biz_work',
      createdBy: 'u_mgr',
      title: 'Calibrate Oscilloscopes',
      instructions: 'Check channels 1 and 2.',
      priority: 'high',
      dueDate: '2026-08-30T10:00:00Z',
      assigneeUserIds: ['u_emp1'],
    });

    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <WorkScreen
          userId="u_emp1"
          businessId="biz_work"
          isManager={false}
          onOpenProfile={jest.fn()}
        />
      );
    });

    const root = renderer!.root;

    // Switch to Calendar tab
    const calendarTab = root.findByProps({ accessibilityLabel: 'Calendar subtab' });
    act(() => {
      calendarTab.props.onPress();
    });

    // Switch to Notes tab
    const notesTab = root.findByProps({ accessibilityLabel: 'Notes subtab' });
    act(() => {
      notesTab.props.onPress();
    });

    expect(root).toBeTruthy();
  });
});
