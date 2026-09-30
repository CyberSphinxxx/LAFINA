import { cloudClient } from './cloudClient';
import { meetingStore } from '../storage';
import { LocalBusinessMeetingRow } from '../storage/syncTypes';

export interface ActionItemSummary {
  task: string;
  assignee: string;
  due?: string | null;
  context?: string | null;
}

export interface MeetingSummaryData {
  key_points: string[];
  decisions: string[];
  open_questions: string[];
  action_items: ActionItemSummary[];
}

export interface MeetingSummaryResponse {
  requestId: string;
  summary: MeetingSummaryData;
  model: string;
  createdAt: string;
}

export interface ServerMeetingRecipient {
  user_id: string;
  email?: string;
  username?: string;
}

export interface ServerMeeting {
  id: string;
  business_id: string;
  created_by: string;
  creator_email?: string;
  title: string;
  duration_seconds: number;
  full_transcript: string;
  summary_json?: MeetingSummaryData | null;
  summary_status: 'not_requested' | 'summary_pending' | 'completed' | 'failed';
  recipients: ServerMeetingRecipient[];
  created_at: string;
  updated_at: string;
}

/**
 * Requests structured AI meeting summary from backend using DeepSeek-V4 Flash.
 * Explicit user consent required before calling this function.
 * Zero audio is ever uploaded — only transcript text.
 */
export const requestMeetingSummary = async (
  transcript: string,
  meetingTitle: string = 'Meeting Sync',
  businessId?: string
): Promise<MeetingSummaryData | null> => {
  if (!transcript || !transcript.trim()) {
    throw new Error('Cannot summarize an empty transcript.');
  }

  const response = await cloudClient.request<MeetingSummaryResponse>('/v1/meetings/summary', {
    method: 'POST',
    body: JSON.stringify({
      transcript: transcript.trim(),
      meetingTitle,
      businessId,
    }),
  });

  if (response.status === 'success' && response.data) {
    return response.data.summary;
  }

  const message = response.error || 'Failed to generate meeting summary.';
  console.warn('[MeetingService] Summarization request failed:', message);
  throw new Error(message);
};

/**
 * Syncs a meeting and its selective sharing recipients to the cloud.
 */
export const syncMeetingToCloud = async (
  businessId: string,
  meeting: LocalBusinessMeetingRow,
  recipientUserIds: string[] = []
): Promise<ServerMeeting | null> => {
  try {
    const summaryParsed = meeting.summary_json ? JSON.parse(meeting.summary_json) : null;
    const response = await cloudClient.request<ServerMeeting>(`/v1/businesses/${businessId}/meetings`, {
      method: 'POST',
      body: JSON.stringify({
        id: meeting.id,
        title: meeting.title,
        duration_seconds: meeting.duration_seconds,
        full_transcript: meeting.full_transcript,
        summary_json: summaryParsed,
        summary_status: meeting.summary_status,
        recipient_user_ids: recipientUserIds,
      }),
    });

    return response.data || null;
  } catch (error: unknown) {
    console.warn('[MeetingService] Failed to sync meeting to cloud:', error);
    return null;
  }
};

/**
 * Fetches authorized meetings for the current business from the cloud.
 * Automatically reconciles local storage and purges meetings that were revoked.
 */
export const fetchMeetingsFromCloud = async (
  businessId: string
): Promise<LocalBusinessMeetingRow[]> => {
  try {
    const response = await cloudClient.request<ServerMeeting[]>(`/v1/businesses/${businessId}/meetings`, {
      method: 'GET',
    });
    const serverMeetings = response.data || [];

    // Reconcile into local storage
    for (const sm of serverMeetings) {
      const summaryStr = sm.summary_json ? JSON.stringify(sm.summary_json) : null;
      const localRow: LocalBusinessMeetingRow = {
        id: sm.id,
        business_id: sm.business_id,
        created_by: sm.created_by,
        title: sm.title,
        duration_seconds: sm.duration_seconds,
        full_transcript: sm.full_transcript,
        summary_json: summaryStr,
        summary_status: sm.summary_status,
        keep_audio: 0,
        created_at: sm.created_at,
        updated_at: sm.updated_at,
      };

      const recipientIds = sm.recipients?.map((r: ServerMeetingRecipient) => r.user_id) || [];
      meetingStore.saveMeeting(localRow, [], [], recipientIds);
    }

    return meetingStore.getMeetingsForBusiness(businessId);
  } catch (error: unknown) {
    console.warn('[MeetingService] Failed to fetch meetings from cloud:', error);
    // Offline fallback to local meetings
    return meetingStore.getMeetingsForBusiness(businessId);
  }
};

/**
 * Revokes access to a meeting for a recipient.
 */
export const revokeMeetingRecipient = async (
  businessId: string,
  meetingId: string,
  userId: string
): Promise<boolean> => {
  try {
    const response = await cloudClient.request(`/v1/businesses/${businessId}/meetings/${meetingId}/recipients/${userId}`, {
      method: 'DELETE',
    });
    return response.status === 'success';
  } catch (error: unknown) {
    console.warn('[MeetingService] Failed to revoke meeting recipient:', error);
    return false;
  }
};
