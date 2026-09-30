import { cloudClient, CloudResult } from '../cloud/cloudClient';
import { localSettingsStore } from '../storage/localSettingsStore';

export interface ChatMessagePayload {
  role: 'user' | 'assistant';
  content: string;
}

/** A USTP Student Handbook passage the server gave the model for this reply. */
export interface HandbookSource {
  page: string;
  pageEnd: string;
  section: string;
  score: number;
}

export interface OnlineChatResponseData {
  requestId: string;
  reply: string;
  model: string;
  usage: Record<string, any>;
  createdAt: string;
  /** Empty, or absent from an older server, when the handbook was not used. */
  sources?: HandbookSource[];
}

/** "Handbook p. 32" or "Handbook pp. 88–89, 32": the pages a reply drew on. */
export const handbookSourceLabel = (sources?: HandbookSource[] | null): string | null => {
  if (!sources?.length) return null;
  const pages = [
    ...new Set(
      sources
        .filter((source) => source.page)
        .map((source) =>
          source.pageEnd && source.pageEnd !== source.page
            ? `${source.page}–${source.pageEnd}`
            : source.page,
        ),
    ),
  ];
  if (pages.length === 0) return null;
  const several = pages.length > 1 || pages[0].includes('–');
  return `Handbook ${several ? 'pp.' : 'p.'} ${pages.join(', ')}`;
};

/** Whether the Student Handbook is switched on server-side, and working. */
export interface HandbookStatus {
  /** The admin panel's switch. Off means nothing about the handbook is shown. */
  enabled: boolean;
  /** Configured, reachable and indexed: answers will be grounded in it. */
  functional: boolean;
  passages: number;
  detail?: string | null;
}

const HANDBOOK_SETTING = 'handbook';

/**
 * Each student's own switch for handbook answers, kept on this device.
 * On unless they turned it off; the admin panel's switch still has the final say.
 */
export const handbookPreference = {
  read: (userId: string): boolean => localSettingsStore.get(userId, HANDBOOK_SETTING, 'on') !== 'off',
  write: (userId: string, on: boolean): void => {
    localSettingsStore.set(userId, HANDBOOK_SETTING, on ? 'on' : 'off');
  },
};

export const onlineChatSkill = {
  /**
   * Executes explicit Online Assistant chat request via cloud API proxy to DeepSeek-V4 Flash.
   * Core scheduling, NLU, and voice scheduling are strictly excluded from this path.
   */
  sendChatMessage: async (
    messages: ChatMessagePayload[],
    options: { useHandbook?: boolean } = {},
  ): Promise<CloudResult<OnlineChatResponseData>> => {
    // Input capping: max 10 messages, max 8000 total characters
    const pagedMessages = messages.slice(-10);
    const totalChars = pagedMessages.reduce((sum, m) => sum + m.content.length, 0);

    if (totalChars > 8000) {
      return {
        status: 'validation_error',
        error: 'Conversation history exceeds limit of 8,000 characters for Online Assistant.',
      };
    }

    return await cloudClient.request<OnlineChatResponseData>(
      '/v1/ai/chat',
      {
        method: 'POST',
        body: JSON.stringify({
          messages: pagedMessages,
          useHandbook: options.useHandbook ?? true,
        }),
      },
      true
    );
  },

  /** Asks the server whether handbook answers are switched on and working. */
  fetchHandbookStatus: async (): Promise<CloudResult<HandbookStatus>> =>
    cloudClient.request<HandbookStatus>('/v1/ai/handbook/status', { method: 'GET' }, true),
};
