import { generateId } from '../../utils';
import { MeetingSegment } from '../native/meetingRecorder';

export interface RosterMember {
  id: string;
  name: string;
  email: string;
}

export interface ActionCandidate {
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

// Whole-word regex detecting Set, Create, or Schedule
const ACTION_TRIGGER_REGEX = /\b(set|create|schedule|assign|prepare|submit|review|calibrate|finalize)\b/i;

/**
 * Parses meeting transcript segments to extract business action candidates.
 * Strictly operates independently without modifying the core SmolLM2 NLU schema.
 */
export const extractActionCandidates = (
  meetingId: string,
  segments: MeetingSegment[],
  roster: RosterMember[] = []
): ActionCandidate[] => {
  const candidates: ActionCandidate[] = [];
  const now = new Date();

  for (const seg of segments) {
    const text = seg.text.trim();
    if (!ACTION_TRIGGER_REGEX.test(text)) {
      continue;
    }

    // 1. Determine title and instructions
    let title = cleanCandidateTitle(text);
    if (!title || title.length < 5) continue;

    // 2. Match Roster Member (e.g. "for Alice", "assigned to Bob", "Eleanor will prepare")
    let matchedAssignee: RosterMember | null = null;
    for (const member of roster) {
      const firstName = member.name.split(' ')[0].toLowerCase();
      const fullName = member.name.toLowerCase();
      const emailName = member.email.split('@')[0].toLowerCase();

      const regexFirst = new RegExp(`\\b${escapeRegExp(firstName)}\\b`, 'i');
      const regexFull = new RegExp(`\\b${escapeRegExp(fullName)}\\b`, 'i');
      const regexEmail = new RegExp(`\\b${escapeRegExp(emailName)}\\b`, 'i');

      if (regexFull.test(text) || regexFirst.test(text) || regexEmail.test(text)) {
        matchedAssignee = member;
        break;
      }
    }

    // 3. Extract basic due date hints (today, tomorrow, friday, etc.)
    const suggestedDueDate = parseDateHint(text, now);

    candidates.push({
      id: generateId('cand'),
      meeting_id: meetingId,
      title,
      instructions: text,
      suggested_assignee_id: matchedAssignee?.id || null,
      suggested_assignee_name: matchedAssignee?.name || matchedAssignee?.email || null,
      suggested_due_date: suggestedDueDate,
      status: 'pending_review',
      created_task_id: null,
      created_at: now.toISOString(),
    });
  }

  return candidates;
};

const cleanCandidateTitle = (sentence: string): string => {
  let cleaned = sentence
    .replace(/^([A-Za-z0-9_\s]+:\s*)/, '') // remove speaker prefix e.g. "Dr. Vance: "
    .trim();

  // Capitalize first letter
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  // Truncate overly long sentences to reasonable title
  if (cleaned.length > 80) {
    cleaned = cleaned.slice(0, 77) + '...';
  }
  return cleaned;
};

const parseDateHint = (text: string, referenceDate: Date): string | null => {
  const lower = text.toLowerCase();
  const date = new Date(referenceDate);

  if (lower.includes('today')) {
    date.setHours(17, 0, 0, 0);
    return date.toISOString();
  }
  if (lower.includes('tomorrow')) {
    date.setDate(date.getDate() + 1);
    date.setHours(17, 0, 0, 0);
    return date.toISOString();
  }
  if (lower.includes('friday')) {
    const day = date.getDay();
    const diff = (5 - day + 7) % 7 || 7;
    date.setDate(date.getDate() + diff);
    date.setHours(17, 0, 0, 0);
    return date.toISOString();
  }
  if (lower.includes('next week') || lower.includes('monday')) {
    const day = date.getDay();
    const diff = (1 - day + 7) % 7 || 7;
    date.setDate(date.getDate() + diff);
    date.setHours(9, 0, 0, 0);
    return date.toISOString();
  }

  return null;
};

const escapeRegExp = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};
