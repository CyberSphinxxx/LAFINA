/**
 * Sending a PDF to FastAPI and getting a deck of flashcards back.
 *
 * The document never touches DeepSeek directly — the server reads it, falls
 * back to text recognition for scanned pages, and asks the model for cards
 * section by section. This module's job is the trip there and back: encode the
 * file for a JSON-only transport, hold the caller to limits the server would
 * reject anyway, and turn every failure into something a student can act on.
 */

import { cloudClient, CloudResult } from '../cloud/cloudClient';
import type { Flashcard } from '../utils/ankiExport';

/** Matches the server's own ceiling; refusing here saves a pointless upload. */
export const MAX_PDF_BYTES = 15 * 1024 * 1024;
export const MIN_CARDS = 5;
export const MAX_CARDS = 120;
export const DEFAULT_CARDS = 40;

export interface FlashcardDeckResponse {
  requestId: string;
  deckTitle: string;
  cards: Flashcard[];
  totalPages: number;
  pagesRead: number;
  ocrPages: number[];
  chunkCount: number;
  model: string;
  usage: Record<string, number>;
  warnings: string[];
  createdAt: string;
}

/**
 * Encodes bytes for a transport that carries JSON text only.
 *
 * In fixed slices, because `String.fromCharCode(...bytes)` on a whole document
 * passes millions of arguments at once and overflows the call stack.
 */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
};

/** True when the bytes begin with the PDF signature. */
export const looksLikePdf = (bytes: Uint8Array): boolean =>
  bytes.length > 4 &&
  bytes[0] === 0x25 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x44 &&
  bytes[3] === 0x46 &&
  bytes[4] === 0x2d;

/**
 * A document to upload: raw bytes (desktop reads files that way), or base64
 * already (React Native's file APIs return it, and a 15 MB file should not be
 * decoded only to be encoded again).
 */
export type UploadDocument =
  | { filename: string; bytes: Uint8Array; base64?: undefined }
  | { filename: string; base64: string; bytes?: undefined };

/** Size of the data a base64 string encodes. */
export const base64ByteLength = (base64: string): number => {
  const clean = base64.replace(/\s/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
};

/**
 * The first `count` bytes a base64 string encodes, for signature checks.
 * Malformed base64 yields no bytes, so it fails the signature check.
 */
export const base64Prefix = (base64: string, count: number): Uint8Array => {
  const chars = Math.ceil(count / 3) * 4;
  try {
    const binary = atob(base64.replace(/\s/g, '').slice(0, chars));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0)).subarray(0, count);
  } catch {
    return new Uint8Array(0);
  }
};

/** The signature bytes, size and wire encoding of an upload, however it arrived. */
export const describeUpload = (
  document: UploadDocument,
): { head: Uint8Array; size: number; toBase64: () => string } => {
  if (document.bytes) {
    const bytes = document.bytes;
    return { head: bytes.subarray(0, 16), size: bytes.length, toBase64: () => bytesToBase64(bytes) };
  }
  const base64 = document.base64 ?? '';
  const size = base64ByteLength(base64);
  return { head: size > 0 ? base64Prefix(base64, 16) : new Uint8Array(0), size, toBase64: () => base64 };
};

export type FlashcardRequestInput = UploadDocument & { maxCards?: number };

/**
 * Turns a cloud failure into a sentence worth showing.
 *
 * The server's own wording is kept wherever it has some: it is the only thing
 * that separates "that PDF is scanned" from "that PDF is damaged", and a
 * generic message would send the student back to try the same file again.
 */
export const describeFlashcardFailure = (result: CloudResult<unknown>): string => {
  const detail = result.error?.trim();
  switch (result.status) {
    case 'offline':
      return 'You are offline. Flashcards are generated on the LAFINA server, so this needs a connection.';
    case 'auth_required':
      return 'Your cloud session expired. Sign out and sign in again while online.';
    case 'subscription_required':
      return detail || 'Flashcards are a Student Pro feature.';
    case 'account_disabled':
      return detail || 'This account is disabled.';
    case 'rate_limited':
      return detail || 'You have generated a lot of decks today. Try again later.';
    case 'server_unavailable':
      return detail || 'The LAFINA server could not be reached. Try again in a moment.';
    case 'validation_error':
      return detail || 'That document could not be used.';
    case 'server_error':
      return detail || 'The server had trouble with that document.';
    default:
      return detail || 'Flashcards could not be generated.';
  }
};

export const flashcardSkill = {
  /** Uploads one PDF and returns the generated deck. */
  generateFromPdf: async (
    input: FlashcardRequestInput,
  ): Promise<CloudResult<FlashcardDeckResponse>> => {
    const { filename } = input;
    const upload = describeUpload(input);

    if (upload.size === 0) {
      return { status: 'validation_error', error: 'That file is empty.' };
    }
    if (!looksLikePdf(upload.head)) {
      return { status: 'validation_error', error: 'That file is not a PDF.' };
    }
    if (upload.size > MAX_PDF_BYTES) {
      const limit = Math.round(MAX_PDF_BYTES / (1024 * 1024));
      return {
        status: 'validation_error',
        error: `That PDF is larger than ${limit} MB. Split it into sections and try again.`,
      };
    }

    const maxCards = Math.min(
      MAX_CARDS,
      Math.max(MIN_CARDS, Math.round(input.maxCards ?? DEFAULT_CARDS)),
    );

    return await cloudClient.request<FlashcardDeckResponse>(
      '/v1/ai/flashcards',
      {
        method: 'POST',
        body: JSON.stringify({
          filename: filename.slice(0, 255),
          contentBase64: upload.toBase64(),
          maxCards,
        }),
      },
      true,
    );
  },
};
