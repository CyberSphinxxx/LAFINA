import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { errorCodes, isErrorWithCode, pick } from '@react-native-documents/picker';

export const MIME_PDF = 'application/pdf';
export const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export interface PickedDocument {
  name: string;
  /** The file's content, as React Native's file APIs return it. */
  base64: string;
}

export type PickOutcome =
  | { kind: 'picked'; document: PickedDocument }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

/**
 * Lets the student choose one document and reads it for upload. A file over
 * `maxBytes` is refused before it is read, when the picker reports a size.
 */
export const pickDocument = async (types: string[], maxBytes: number): Promise<PickOutcome> => {
  try {
    const [file] = await pick({ type: types });
    if (!file?.uri) return { kind: 'cancelled' };
    if (typeof file.size === 'number' && file.size > maxBytes) {
      const limit = Math.round(maxBytes / (1024 * 1024));
      return {
        kind: 'error',
        message: `That file is larger than ${limit} MB. Split it into sections and try again.`,
      };
    }
    const base64 = await RNFS.readFile(file.uri, 'base64');
    return { kind: 'picked', document: { name: file.name || 'document', base64 } };
  } catch (error) {
    if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) {
      return { kind: 'cancelled' };
    }
    console.error('[Tools] Could not open the chosen file:', error);
    return { kind: 'error', message: 'That file could not be opened.' };
  }
};

export type ShareOutcome = 'shared' | 'cancelled' | 'failed';

/**
 * Writes text to a temporary file and opens the share sheet for it, so it can
 * be saved to Files or Drive, or sent to another app such as AnkiDroid.
 */
export const shareTextFile = async (options: {
  fileName: string;
  contents: string;
  title: string;
  mimeType?: string;
}): Promise<ShareOutcome> => {
  const path = `${RNFS.TemporaryDirectoryPath}/${options.fileName}`;
  try {
    await RNFS.writeFile(path, options.contents, 'utf8');
    await Share.open({
      url: `file://${path}`,
      type: options.mimeType ?? 'text/plain',
      filename: options.fileName,
      title: options.title,
    });
    return 'shared';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (message.includes('User did not share')) return 'cancelled';
    console.error('[Tools] Could not share the file:', error);
    return 'failed';
  } finally {
    RNFS.unlink(path).catch(() => undefined);
  }
};
