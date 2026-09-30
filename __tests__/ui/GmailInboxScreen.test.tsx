import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { GmailInboxScreen } from '../../src/ui/screens/business/GmailInboxScreen';
import { gmailService } from '../../src/cloud/gmailService';
import { gmailStore } from '../../src/storage/gmailStore';
import { initDatabase, seedLocalDemoAccounts, DEMO_IDS } from '../../src/storage';
import { Linking } from 'react-native';

jest.mock('../../src/ui/contexts/ThemeContext', () => ({
  useTheme: jest.fn(() => ({
    colors: {
      background: '#F8FAFC',
      cardBg: '#FFFFFF',
      textPrimary: '#0F172A',
      textSecondary: '#475569',
      textMuted: '#64748B',
      border: '#E2E8F0',
      placeholder: '#94A3B8',
    },
    isDarkMode: false,
    toggleTheme: jest.fn(),
  })),
}));

jest.mock('../../src/cloud/gmailService', () => ({
  gmailService: {
    startConnect: jest.fn(),
    getConnectionStatus: jest.fn(),
    disconnect: jest.fn(),
    fetchThreads: jest.fn(),
    fetchThreadDetail: jest.fn(),
    createDraft: jest.fn(),
    updateDraft: jest.fn(),
    sendDraft: jest.fn(),
  },
}));

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

describe('GmailInboxScreen UI', () => {
  const userId = DEMO_IDS.MANAGER_ID;

  beforeEach(async () => {
    await initDatabase();
    await seedLocalDemoAccounts();
    gmailStore.clearCache(userId);
    gmailStore.deleteConnection(userId);
    jest.clearAllMocks();
  });

  it('renders Connect Gmail card when account is not connected', async () => {
    (gmailService.getConnectionStatus as jest.Mock).mockResolvedValue({
      connected: false,
    });
    (gmailService.fetchThreads as jest.Mock).mockResolvedValue({
      threads: [],
      isOffline: false,
    });

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<GmailInboxScreen userId={userId} />);
      await new Promise((r) => setTimeout(r, 50));
    });

    const root = renderer!.root;
    const connectButtons = root.findAllByProps({ accessibilityLabel: 'Connect Gmail Account' });
    expect(connectButtons.length).toBeGreaterThan(0);
  });

  it('triggers startConnect and opens URL when Connect Gmail is pressed', async () => {
    (gmailService.getConnectionStatus as jest.Mock).mockResolvedValue({
      connected: false,
    });
    (gmailService.startConnect as jest.Mock).mockResolvedValue({
      auth_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=123',
      state: '123',
    });
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<GmailInboxScreen userId={userId} />);
      await new Promise((r) => setTimeout(r, 50));
    });

    const root = renderer!.root;
    const connectBtn = root.findByProps({ accessibilityLabel: 'Connect Gmail Account' });

    await act(async () => {
      connectBtn.props.onPress();
    });

    expect(gmailService.startConnect).toHaveBeenCalled();
    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/v2/auth?state=123'
    );
  });

  it('renders thread list with sender and subject when connected', async () => {
    const mockThreads = [
      {
        user_id: userId,
        thread_id: 't_mock_1',
        history_id: 'h_1',
        snippet: 'Here is the meeting notes from yesterday.',
        subject: 'Meeting Follow-up',
        from_address: 'colleague@company.com',
        to_address: 'manager@gmail.com',
        date: '2026-08-25T14:30:00Z',
        unread: 1,
        message_count: 2,
        has_attachments: 1,
        created_at: '2026-08-25T14:30:00Z',
        updated_at: '2026-08-25T14:30:00Z',
      },
    ];

    (gmailService.getConnectionStatus as jest.Mock).mockResolvedValue({
      connected: true,
      email_address: 'manager_linked@gmail.com',
    });
    (gmailService.fetchThreads as jest.Mock).mockResolvedValue({
      threads: mockThreads,
      isOffline: false,
    });

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<GmailInboxScreen userId={userId} />);
      await new Promise((r) => setTimeout(r, 50));
    });

    const root = renderer!.root;
    const textNodes = root.findAllByType('Text' as any);
    const textContents = textNodes.map((n) => n.props.children);

    expect(textContents).toContain('manager_linked@gmail.com');
    expect(textContents).toContain('colleague@company.com');
    expect(textContents).toContain('Meeting Follow-up');
  });

  it('switches to Local Drafts tab and shows saved drafts', async () => {
    gmailStore.saveLocalDraft({
      user_id: userId,
      to_address: 'supplier@hardware.com',
      subject: 'Parts Order Draft',
      body: 'Need 50x microcontroller boards.',
    });

    (gmailService.getConnectionStatus as jest.Mock).mockResolvedValue({
      connected: true,
      email_address: 'manager@gmail.com',
    });
    (gmailService.fetchThreads as jest.Mock).mockResolvedValue({
      threads: [],
      isOffline: false,
    });

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<GmailInboxScreen userId={userId} />);
      await new Promise((r) => setTimeout(r, 50));
    });

    const root = renderer!.root;
    const draftsTab = root.findByProps({ testID: 'tab-drafts' });

    // Switch to Local Drafts tab
    await act(async () => {
      draftsTab.props.onPress();
      await new Promise((r) => setTimeout(r, 50));
    });

    const textNodes = root.findAllByType('Text' as any);
    const textContents = textNodes.map((n) => n.props.children);
    expect(textContents).toContain('Parts Order Draft');
  });
});
