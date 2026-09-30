/**
 * Asking FastAPI for a file the chat assistant writes.
 *
 * DeepSeek describes the document and the server builds it with ReportLab,
 * python-docx, openpyxl or python-pptx — the desktop app holds no provider key
 * and runs none of that. This module is the trip there and back: send the
 * conversation within the chat allowance, decode the file from a JSON-only
 * transport, and turn failures into something a student can act on.
 */

import { cloudClient, CloudResult } from '../cloud/cloudClient';
import type { ChatMessagePayload } from './onlineChatSkill';

export type DocumentFormat = 'pdf' | 'docx' | 'xlsx' | 'pptx';

export interface DocumentFormatInfo {
  format: DocumentFormat;
  /** What the student calls it: "PDF", "Word", "Excel", "PowerPoint". */
  label: string;
  extension: string;
  mimeType: string;
  /** For the save dialog. */
  filterName: string;
}

export const DOCUMENT_FORMATS: Record<DocumentFormat, DocumentFormatInfo> = {
  pdf: {
    format: 'pdf',
    label: 'PDF',
    extension: 'pdf',
    mimeType: 'application/pdf',
    filterName: 'PDF document',
  },
  docx: {
    format: 'docx',
    label: 'Word',
    extension: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    filterName: 'Word document',
  },
  xlsx: {
    format: 'xlsx',
    label: 'Excel',
    extension: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filterName: 'Excel workbook',
  },
  pptx: {
    format: 'pptx',
    label: 'PowerPoint',
    extension: 'pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    filterName: 'PowerPoint presentation',
  },
};

export const DOCUMENT_FORMAT_ORDER: DocumentFormat[] = ['pdf', 'docx', 'xlsx', 'pptx'];

export const isDocumentFormat = (value: unknown): value is DocumentFormat =>
  typeof value === 'string' && value in DOCUMENT_FORMATS;

export interface DocumentResponse {
  requestId: string;
  format: DocumentFormat;
  title: string;
  summary: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
  model: string;
  usage: Record<string, number>;
  warnings: string[];
  createdAt: string;
}

/** The chat allowance the server holds a file request to. */
export const MAX_DOCUMENT_MESSAGES = 10;
export const MAX_DOCUMENT_CHARS = 8000;
const MAX_MESSAGE_CHARS = 4090;

/**
 * The conversation worth sending: the newest turns that fit the allowance.
 *
 * Oldest turns go first, so a long chat still produces a file instead of
 * being refused outright. The request itself is always kept, and cut down
 * only if it alone is over the limit.
 */
export const trimDocumentHistory = (messages: ChatMessagePayload[]): ChatMessagePayload[] => {
  const recent = messages
    .filter((message) => message.content.trim())
    .slice(-MAX_DOCUMENT_MESSAGES)
    .map((message) => ({ ...message, content: message.content.slice(0, MAX_MESSAGE_CHARS) }));
  let total = recent.reduce((sum, message) => sum + message.content.length, 0);
  while (recent.length > 1 && total > MAX_DOCUMENT_CHARS) {
    total -= recent.shift()!.content.length;
  }
  // The server wants the conversation to start where a chat would, and a
  // leading assistant turn left by the trim adds nothing the model needs.
  while (recent.length > 1 && recent[0].role === 'assistant') {
    total -= recent.shift()!.content.length;
  }
  if (total > MAX_DOCUMENT_CHARS && recent.length === 1) {
    recent[0] = { ...recent[0], content: recent[0].content.slice(0, MAX_DOCUMENT_CHARS) };
  }
  return recent;
};

/** Decodes the file the server sent as base64, the inverse of `bytesToBase64`. */
export const base64ToBytes = (encoded: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

/** "12 KB", "1.4 MB": how big the file is, for the card in the chat. */
export const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Turns a cloud failure into a sentence worth showing.
 *
 * The server's own wording is kept wherever it has some: a refusal says why,
 * and a quota says how long to wait.
 */
export const describeDocumentFailure = (result: CloudResult<unknown>): string => {
  const detail = result.error?.trim();
  switch (result.status) {
    case 'offline':
      return 'You are offline. Files are created on the LAFINA server, so this needs a connection.';
    case 'auth_required':
      return 'Your cloud session expired. Sign in again while online to create files.';
    case 'subscription_required':
      return 'Creating files is exclusive to Student Pro accounts.';
    case 'account_disabled':
      return detail || 'This account is disabled.';
    case 'rate_limited':
      return detail || 'You have created a lot of files today. Try again later.';
    case 'server_unavailable':
      return 'The LAFINA server could not be reached. Try again in a moment.';
    case 'validation_error':
      return detail || 'That request could not be turned into a file.';
    case 'server_error':
      return detail || 'The server had trouble creating that file. Try again.';
    default:
      return detail || 'The file could not be created.';
  }
};

export const documentSkill = {
  /** Asks the server for one file, built from the conversation so far. */
  generate: async (input: {
    format: DocumentFormat;
    messages: ChatMessagePayload[];
  }): Promise<CloudResult<DocumentResponse>> => {
    const messages = trimDocumentHistory(input.messages);
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'user') {
      return { status: 'validation_error', error: 'Say what the file should contain.' };
    }

    return await cloudClient.request<DocumentResponse>(
      '/v1/ai/documents',
      {
        method: 'POST',
        body: JSON.stringify({ format: input.format, messages }),
      },
      true,
    );
  },
};
