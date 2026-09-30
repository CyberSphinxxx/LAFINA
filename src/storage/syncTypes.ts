/** Supported synchronization scope namespaces. */
export type SyncScopeType = 'account' | 'business';

/** Entity types supported by the cloud sync API (personal and business). */
export type SyncEntityType =
  | 'profile'
  | 'task'
  | 'event'
  | 'time_block'
  | 'reminder'
  | 'note'
  | 'custom_category'
  | 'pomodoro_settings'
  | 'pomodoro_session'
  | 'flashcard_deck'
  | 'study_summary'
  | 'recorded_meeting'
  | 'business_task'
  | 'business_task_assignment'
  | 'business_work_block';

/** Entity id of the per-account Pomodoro settings row, a sync singleton. */
export const POMODORO_SETTINGS_ENTITY_ID = 'pomodoro_settings';

/** Mutation verbs accepted by the cloud sync API. */
export type SyncOperation = 'create' | 'update' | 'delete';

/** JSON-compatible object sent to the cloud sync API. */
export type SyncPayload = Record<string, unknown>;

/** User-facing synchronization states persisted per account and scope. */
export type PersistedSyncStatus =
  | 'Local only'
  | 'Syncing'
  | 'Synced'
  | 'Offline'
  | 'Sign-in required'
  | 'Attention required';

/** User system authorization role. */
export type SystemRole = 'user' | 'admin';

/** Subscription billing and feature tier. */
export type SubscriptionPlan = 'student' | 'student_pro' | 'business';

/** Role within an organization-owned business workspace. */
export type BusinessMemberRole = 'manager' | 'employee';

/** Status of a user membership in a business workspace. */
export type MembershipStatus = 'invited' | 'active' | 'suspended' | 'removed';

/** Active business lease and capability session payload. */
export interface BusinessSession {
  business_id: string;
  business_name: string;
  member_role: BusinessMemberRole;
  membership_status: MembershipStatus;
  lease_expires_at: string;
  capabilities: string[];
}

/** Business task priorities. */
export type TaskPriority = 'high' | 'medium' | 'low';

/** Lifecycle status of an assigned business task. */
export type TaskAssignmentStatus =
  | 'todo'
  | 'in_progress'
  | 'pending_review'
  | 'completed';

/** Manager review decision status. */
export type ManagerReviewStatus = 'pending' | 'approved' | 'reopened';

/** Business task row in SQLite. */
export interface BusinessTaskRow {
  id: string;
  business_id: string;
  created_by: string;
  title: string;
  instructions: string;
  priority: TaskPriority;
  due_date: string | null;
  scheduled_at: string | null;
  recurrence_rule: string | null;
  reminder_lead_minutes: number;
  is_cancelled: number;
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Business task assignment row in SQLite. */
export interface BusinessTaskAssignmentRow {
  id: string;
  business_task_id: string;
  business_id: string;
  user_id: string;
  status: TaskAssignmentStatus;
  manager_review_status: ManagerReviewStatus;
  reopened_reason: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Business work block row in SQLite. */
export interface BusinessWorkBlockRow {
  id: string;
  business_id: string;
  user_id: string;
  title: string;
  start_time: string;
  end_time: string;
  recurrence_rule: string | null;
  created_by: string;
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Full composite task containing its assignment rows. */
export interface BusinessTaskWithAssignments extends BusinessTaskRow {
  assignments: BusinessTaskAssignmentRow[];
}

/** Local delivery status for outgoing chat messages and comments. */
export type DeliveryStatus = 'pending' | 'sent' | 'failed';

/** Business chat channel row in SQLite. */
export interface BusinessChatChannelRow {
  id: string;
  business_id: string;
  name: string;
  channel_type: string;
  is_archived: number;
  created_at: string;
  updated_at: string;
}

/** Business chat message row in SQLite. */
export interface BusinessChatMessageRow {
  id: string;
  channel_id: string;
  business_id: string;
  sender_id: string;
  sender_name: string | null;
  client_message_id: string;
  content: string;
  task_link_id: string | null;
  task_title: string | null;
  delivery_status: DeliveryStatus;
  created_at: string;
  updated_at: string;
}

/** Business task comment row in SQLite. */
export interface BusinessTaskCommentRow {
  id: string;
  task_id: string;
  business_id: string;
  user_id: string;
  user_name: string | null;
  client_comment_id: string;
  content: string;
  delivery_status: DeliveryStatus;
  created_at: string;
  updated_at: string;
}

/** Local business meeting row in SQLite. */
export interface LocalBusinessMeetingRow {
  id: string;
  business_id: string;
  created_by: string;
  title: string;
  duration_seconds: number;
  full_transcript: string;
  summary_json: string | null; // JSON string
  summary_status: 'not_requested' | 'summary_pending' | 'completed' | 'failed';
  keep_audio: number; // 0 or 1
  created_at: string;
  updated_at: string;
}

/** Meeting transcript segment row in SQLite. */
export interface LocalBusinessMeetingSegmentRow {
  id: string;
  meeting_id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  speaker: string | null;
  created_at: string;
}

/** Action candidate extracted from meeting transcript. */
export interface LocalBusinessActionCandidateRow {
  id: string;
  meeting_id: string;
  title: string;
  instructions: string;
  suggested_assignee_id: string | null;
  suggested_assignee_name: string | null;
  suggested_due_date: string | null;
  status: 'pending_review' | 'confirmed' | 'discarded';
  created_task_id: string | null;
  created_at: string;
}

/** Selective sharing recipient row for a meeting. */
export interface LocalBusinessMeetingRecipientRow {
  id: string;
  meeting_id: string;
  business_id: string;
  user_id: string;
  email?: string;
  created_at: string;
}

/** Local Gmail connection state in SQLite. */
export interface LocalGmailConnectionRow {
  user_id: string;
  email_address: string;
  is_connected: number;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Local Gmail cached thread summary row in SQLite. */
export interface LocalGmailThreadCacheRow {
  user_id: string;
  thread_id: string;
  history_id: string;
  snippet: string;
  subject: string;
  from_address: string;
  to_address: string;
  date: string;
  unread: number;
  message_count: number;
  has_attachments: number;
  created_at: string;
  updated_at: string;
}

/** Attachment metadata for email view without downloading binary payload. */
export interface GmailAttachmentInfo {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
}

/** Local Gmail cached full message body and metadata row in SQLite. */
export interface LocalGmailMessageCacheRow {
  user_id: string;
  message_id: string;
  thread_id: string;
  subject: string;
  from_address: string;
  to_address: string;
  cc_address: string | null;
  bcc_address: string | null;
  date: string;
  snippet: string;
  body_plain: string;
  body_html: string | null;
  attachments_json: string | null; // JSON array of GmailAttachmentInfo
  is_read: number;
  cached_at: string;
}

/** Local Gmail draft row in SQLite. */
export interface LocalGmailDraftRow {
  id: string;
  user_id: string;
  remote_draft_id: string | null;
  thread_id: string | null;
  to_address: string;
  cc_address: string | null;
  bcc_address: string | null;
  subject: string;
  body: string;
  status: 'draft' | 'sending' | 'failed';
  updated_at: string;
  created_at: string;
}
