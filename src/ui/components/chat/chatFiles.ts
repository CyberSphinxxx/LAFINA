import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import type { ChatAttachment } from '../../../storage';
import { generateId } from '../../../utils';

/** Generated files live with the app's data, so a chat still offers them after a restart. */
export const ATTACHMENTS_DIR = `${RNFS.DocumentDirectoryPath}/attachments`;

/** Writes a file the server sent as base64, and returns where it is. */
export const saveGeneratedFile = async (contentBase64: string, extension: string): Promise<string> => {
  await RNFS.mkdir(ATTACHMENTS_DIR);
  const path = `${ATTACHMENTS_DIR}/${generateId('file')}.${extension}`;
  await RNFS.writeFile(path, contentBase64, 'base64');
  return path;
};

export type AttachmentShareOutcome = 'shared' | 'cancelled' | 'missing' | 'failed';

/**
 * Opens the share sheet for a generated file, from which it can be opened in
 * an app, saved to Files or Drive, or sent on. The copy handed over sits in
 * the cache, which the share sheet can read, under the file's real name.
 */
export const shareAttachment = async (attachment: ChatAttachment): Promise<AttachmentShareOutcome> => {
  const source = attachment.uri.replace(/^file:\/\//, '');
  const copy = `${RNFS.TemporaryDirectoryPath}/${attachment.fileName.replace(/[/\\]/g, ' ')}`;
  try {
    if (!(await RNFS.exists(source))) return 'missing';
    await RNFS.copyFile(source, copy);
    await Share.open({
      url: `file://${copy}`,
      type: attachment.mimeType || undefined,
      filename: attachment.fileName,
      title: attachment.fileName,
    });
    return 'shared';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (message.includes('User did not share')) return 'cancelled';
    console.error('[Chat] Could not share the generated file:', error);
    return 'failed';
  } finally {
    RNFS.unlink(copy).catch(() => undefined);
  }
};

/** Deletes generated files; copies already shared elsewhere are untouched. */
export const removeAttachmentFiles = (uris: string[]): void => {
  uris.forEach((uri) => {
    RNFS.unlink(uri.replace(/^file:\/\//, '')).catch((error: unknown) =>
      console.warn('[Chat] Could not delete a generated file:', error),
    );
  });
};
