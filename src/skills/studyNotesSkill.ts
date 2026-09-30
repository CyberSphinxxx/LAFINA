/**
 * Sending a document to FastAPI and getting revision notes back.
 *
 * Lecture material arrives as a PDF, a Word file or a slide deck, and all
 * three are read on the server — the desktop app holds no provider key. This
 * module is the trip there and back: encode for a JSON-only transport, refuse
 * what the server would refuse anyway, and turn failures into something a
 * student can act on.
 */

import { cloudClient, CloudResult } from '../cloud/cloudClient';
import {
  describeFlashcardFailure,
  describeUpload,
  MAX_PDF_BYTES,
  type UploadDocument,
} from './flashcardSkill';

export const MAX_DOCUMENT_BYTES = MAX_PDF_BYTES;

/** What the file picker offers, and what the server can read. */
export const SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'pptx'] as const;

export interface StudyNoteSection {
  heading: string;
  points: string[];
}

export interface StudyNoteTerm {
  term: string;
  meaning: string;
}

export interface StudyNotesResponse {
  requestId: string;
  title: string;
  overview: string;
  sections: StudyNoteSection[];
  keyTerms: StudyNoteTerm[];
  markdown: string;
  sourceKind: string;
  totalPages: number;
  pagesRead: number;
  ocrPages: number[];
  chunkCount: number;
  model: string;
  usage: Record<string, number>;
  warnings: string[];
  createdAt: string;
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
const ZIP_SIGNATURE = [0x50, 0x4b];

const startsWith = (bytes: Uint8Array, signature: number[]): boolean =>
  bytes.length > signature.length && signature.every((byte, index) => bytes[index] === byte);

/**
 * True for the three formats the server can read.
 *
 * Word and PowerPoint files are zips, so the extension is what separates them
 * from any other archive; the server checks the package contents properly.
 */
export const isSupportedDocument = (filename: string, bytes: Uint8Array): boolean => {
  if (startsWith(bytes, PDF_SIGNATURE)) return true;
  if (!startsWith(bytes, ZIP_SIGNATURE)) return false;
  const name = (filename || '').toLowerCase();
  return name.endsWith('.docx') || name.endsWith('.pptx');
};

/** The same wording the flashcard uploader uses; the failures are the same. */
export const describeStudyNotesFailure = describeFlashcardFailure;

export const studyNotesSkill = {
  /** Uploads one document and returns its summary. */
  summarizeDocument: async (input: UploadDocument): Promise<CloudResult<StudyNotesResponse>> => {
    const { filename } = input;
    const upload = describeUpload(input);

    if (upload.size === 0) {
      return { status: 'validation_error', error: 'That file is empty.' };
    }
    if (!isSupportedDocument(filename, upload.head)) {
      return {
        status: 'validation_error',
        error: 'Study notes are made from PDF, Word (.docx) or PowerPoint (.pptx) files.',
      };
    }
    if (upload.size > MAX_DOCUMENT_BYTES) {
      const limit = Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024));
      return {
        status: 'validation_error',
        error: `That file is larger than ${limit} MB. Split it into sections and try again.`,
      };
    }

    return await cloudClient.request<StudyNotesResponse>(
      '/v1/ai/study-notes',
      {
        method: 'POST',
        body: JSON.stringify({
          filename: filename.slice(0, 255),
          contentBase64: upload.toBase64(),
        }),
      },
      true,
    );
  },
};
