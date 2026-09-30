import RNFS from 'react-native-fs';
import { pick, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { generateId } from '../../../utils';

/**
 * Profile photos live with the app's data rather than where the picker left
 * them. A picked file arrives as a `content://` URI or a path in the cache,
 * both of which the system is free to drop; a copy under the documents
 * directory is still there after a restart.
 */
export const AVATARS_DIR = `${RNFS.DocumentDirectoryPath}/avatars`;

const extensionOf = (name: string | null | undefined, fallback = 'jpg'): string => {
  const match = /\.([a-zA-Z0-9]{1,5})$/.exec(name ?? '');
  return match ? match[1].toLowerCase() : fallback;
};

/** True when the user backed out of the picker rather than hitting a problem. */
const isCancellation = (error: unknown): boolean =>
  isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED;

export type PickAvatarResult =
  | { status: 'picked'; uri: string }
  | { status: 'cancelled' }
  | { status: 'failed' };

/**
 * Asks for an image and returns where the stored copy lives.
 *
 * The copy is given a fresh name every time, so a replaced photo never shows
 * the old one from a cached path.
 */
export const pickAvatarImage = async (): Promise<PickAvatarResult> => {
  let source: string;
  let fileName: string | null;
  try {
    const picked = await pick({ type: ['image/*'] });
    const file = picked?.[0];
    if (!file?.uri) return { status: 'cancelled' };
    source = file.uri;
    fileName = file.name ?? null;
  } catch (error) {
    if (isCancellation(error)) return { status: 'cancelled' };
    console.error('[Profile] Could not open the image picker:', error);
    return { status: 'failed' };
  }

  try {
    await RNFS.mkdir(AVATARS_DIR);
    const destination = `${AVATARS_DIR}/${generateId('avatar')}.${extensionOf(fileName)}`;
    await RNFS.copyFile(source, destination);
    return { status: 'picked', uri: destination };
  } catch (error) {
    console.error('[Profile] Could not store the chosen photo:', error);
    return { status: 'failed' };
  }
};

/**
 * Deletes a stored photo. Only paths this module wrote are touched, so a
 * bundled placeholder or a URI from somewhere else is left alone.
 */
export const removeAvatarImage = async (uri: string | null): Promise<void> => {
  if (!uri) return;
  const path = uri.replace(/^file:\/\//, '');
  if (!path.startsWith(AVATARS_DIR)) return;
  try {
    if (await RNFS.exists(path)) await RNFS.unlink(path);
  } catch (error) {
    console.warn('[Profile] Could not delete the previous photo:', error);
  }
};

/** A stored path as an `Image` source; null when there is no photo. */
export const avatarSource = (uri: string | null): { uri: string } | null =>
  uri ? { uri: uri.startsWith('/') ? `file://${uri}` : uri } : null;
