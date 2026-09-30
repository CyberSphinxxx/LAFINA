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

import { CustomTabBar } from '../../src/ui/components/CustomTabBar';
import { SyncStatusIndicator } from '../../src/ui/components/business/SyncStatusIndicator';
import { ManagerOverviewScreen } from '../../src/ui/screens/business/ManagerOverviewScreen';
import { EmployeeTodayScreen } from '../../src/ui/screens/business/EmployeeTodayScreen';
import { WorkScreen } from '../../src/ui/screens/business/WorkScreen';
import { TeamManagementModal } from '../../src/ui/screens/business/TeamManagementModal';
import { BusinessOnboardingScreen } from '../../src/ui/screens/business/BusinessOnboardingScreen';
import { initDatabase } from '../../src/storage/dbInit';

describe('Business UI Shells & Components', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  describe('CustomTabBar', () => {
    it('renders student shell tabs with chat, calendar, notes, and profile', () => {
      const onTabPress = jest.fn();
      const onMicPress = jest.fn();
      let tree: ReactTestRenderer.ReactTestRenderer;
      act(() => {
        tree = ReactTestRenderer.create(
          <CustomTabBar
            activeTab="calendar"
            onTabPress={onTabPress}
            onMicPress={onMicPress}
            mode="student"
          />
        );
      });

      expect(tree!.root.find((n) => n.props.accessibilityLabel === 'Chat tab')).toBeDefined();
      expect(tree!.root.find((n) => n.props.accessibilityLabel === 'Calendar tab')).toBeDefined();
      expect(tree!.root.find((n) => n.props.accessibilityLabel === 'Notes tab')).toBeDefined();
      expect(tree!.root.find((n) => n.props.accessibilityLabel === 'Profile tab')).toBeDefined();
    });

    it('renders manager shell tabs with overview, work, chat, and inbox', () => {
      const onTabPress = jest.fn();
      let tree: ReactTestRenderer.ReactTestRenderer;
      act(() => {
        tree = ReactTestRenderer.create(
          <CustomTabBar
            activeTab="overview"
            onTabPress={onTabPress}
            onMicPress={jest.fn()}
            mode="manager"
          />
        );
      });

      expect(tree!.root.find((n) => n.props.accessibilityLabel === 'Overview tab')).toBeDefined();
      expect(tree!.root.find((n) => n.props.accessibilityLabel === 'Work tab')).toBeDefined();
      expect(tree!.root.find((n) => n.props.accessibilityLabel === 'Chat tab')).toBeDefined();
      expect(tree!.root.find((n) => n.props.accessibilityLabel === 'Inbox tab')).toBeDefined();
    });

    it('renders employee shell tabs with today, work, chat, and inbox', () => {
      const onTabPress = jest.fn();
      let tree: ReactTestRenderer.ReactTestRenderer;
      act(() => {
        tree = ReactTestRenderer.create(
          <CustomTabBar
            activeTab="today"
            onTabPress={onTabPress}
            onMicPress={jest.fn()}
            mode="employee"
          />
        );
      });

      expect(tree!.root.find((n) => n.props.accessibilityLabel === 'Today tab')).toBeDefined();
      expect(tree!.root.find((n) => n.props.accessibilityLabel === 'Work tab')).toBeDefined();
      expect(tree!.root.find((n) => n.props.accessibilityLabel === 'Chat tab')).toBeDefined();
      expect(tree!.root.find((n) => n.props.accessibilityLabel === 'Inbox tab')).toBeDefined();
    });
  });

  describe('SyncStatusIndicator', () => {
    it('renders synced, pending, failed, and locked states', () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      act(() => {
        tree = ReactTestRenderer.create(
          <SyncStatusIndicator status="synced" />
        );
      });
      expect(JSON.stringify(tree!.toJSON())).toContain('Synced');

      act(() => {
        tree.update(<SyncStatusIndicator status="pending" pendingCount={3} />);
      });
      expect(JSON.stringify(tree!.toJSON())).toContain('3 pending');

      act(() => {
        tree.update(<SyncStatusIndicator status="locked" />);
      });
      expect(JSON.stringify(tree!.toJSON())).toContain('Lease expired');
    });
  });

  describe('ManagerOverviewScreen', () => {
    it('renders seat allocation and handles quick actions', () => {
      const onOpenTeamManagement = jest.fn();
      const onOpenProfile = jest.fn();
      const onActionPress = jest.fn();
      let tree: ReactTestRenderer.ReactTestRenderer;

      act(() => {
        tree = ReactTestRenderer.create(
          <ManagerOverviewScreen
            businessName="Acme Labs"
            activeSeats={3}
            seatLimit={10}
            onOpenTeamManagement={onOpenTeamManagement}
            onOpenProfile={onOpenProfile}
            onActionPress={onActionPress}
            isLeaseActive={true}
          />
        );
      });

      expect(JSON.stringify(tree!.toJSON())).toContain('Acme Labs');
      expect(JSON.stringify(tree!.toJSON())).toContain('3 / 10 Seats Allocated');

      // Click quick action
      const assignTaskBtn = tree!.root.find(
        (node) => node.props.accessibilityLabel === 'Assign Task to Employee'
      );
      act(() => {
        assignTaskBtn.props.onPress();
      });
      expect(onActionPress).toHaveBeenCalledWith('assign_task');
    });
  });

  describe('EmployeeTodayScreen', () => {
    it('renders assigned tasks and triggers status updates', () => {
      const onUpdateStatus = jest.fn();
      let tree: ReactTestRenderer.ReactTestRenderer;

      act(() => {
        tree = ReactTestRenderer.create(
          <EmployeeTodayScreen
            businessName="Acme Labs"
            tasks={[
              {
                id: 'task_1',
                title: 'Check server racks',
                instructions: 'Verify temperature and cooling.',
                managerName: 'Alice',
                priority: 'High',
                dueTime: '3:00 PM',
                status: 'todo',
                commentsCount: 1,
              },
            ]}
            onUpdateStatus={onUpdateStatus}
            onOpenProfile={jest.fn()}
          />
        );
      });

      expect(JSON.stringify(tree!.toJSON())).toContain('Check server racks');
      expect(JSON.stringify(tree!.toJSON())).toContain('High');

      const startBtn = tree!.root.find(
        (node) => node.props.accessibilityLabel === 'Start working on task'
      );
      act(() => {
        startBtn.props.onPress();
      });
      expect(onUpdateStatus).toHaveBeenCalledWith('task_1', 'in_progress');
    });
  });

  describe('WorkScreen', () => {
    it('renders subtabs and toggles personal private layer', () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      act(() => {
        tree = ReactTestRenderer.create(
          <WorkScreen
            userId="user_1"
            isManager={true}
            onOpenProfile={jest.fn()}
          />
        );
      });

      expect(JSON.stringify(tree!.toJSON())).toContain('Work Hub');
      const switchNode = tree!.root.find((node) => node.props.accessibilityRole === 'switch');
      expect(switchNode.props.value).toBe(true);

      act(() => {
        switchNode.props.onValueChange(false);
      });
      expect(switchNode.props.value).toBe(false);
    });
  });

  describe('TeamManagementModal', () => {
    it('renders team roster and opens invite form', () => {
      const onInviteMember = jest.fn();
      let tree: ReactTestRenderer.ReactTestRenderer;

      act(() => {
        tree = ReactTestRenderer.create(
          <TeamManagementModal
            visible={true}
            onClose={jest.fn()}
            businessId="biz_1"
            isOwner={true}
            activeSeats={2}
            seatLimit={5}
            members={[
              {
                user_id: 'emp_1',
                email: 'emp1@lafina.app',
                member_role: 'employee',
                membership_status: 'active',
                joined_at: new Date().toISOString(),
              },
            ]}
            invitations={[]}
            onInviteMember={onInviteMember}
            onUpdateRole={jest.fn()}
            onUpdateStatus={jest.fn()}
            onCancelInvitation={jest.fn()}
          />
        );
      });

      expect(JSON.stringify(tree!.toJSON())).toContain('emp1@lafina.app');
      expect(JSON.stringify(tree!.toJSON())).toContain('2 of 5 Seats Used');
    });
  });

  describe('BusinessOnboardingScreen', () => {
    it('renders create workspace mode and accept invitation mode', () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      act(() => {
        tree = ReactTestRenderer.create(
          <BusinessOnboardingScreen
            mode="create_workspace"
            onCreateWorkspace={jest.fn()}
          />
        );
      });
      expect(JSON.stringify(tree!.toJSON())).toContain('Set Up Business Workspace');

      act(() => {
        tree.update(
          <BusinessOnboardingScreen
            mode="accept_invitation"
            pendingInvitation={{
              id: 'inv_1',
              business_id: 'biz_1',
              business_name: 'Tech University',
              invited_by: 'admin@lafina.app',
              email: 'me@lafina.app',
              member_role: 'employee',
              status: 'pending',
              expires_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
            }}
            onAcceptInvitation={jest.fn()}
          />
        );
      });
      expect(JSON.stringify(tree!.toJSON())).toContain('Tech University');
      expect(JSON.stringify(tree!.toJSON())).toContain('Join Workspace');
    });
  });
});
