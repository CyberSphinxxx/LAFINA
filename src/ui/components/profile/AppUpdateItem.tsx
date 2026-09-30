import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Fonts, useThemedStyles } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { appUpdater } from '../../../updates';
import type { UpdateService, UpdateState } from '../../../updates';
import { meetingRecorder } from '../../../ai';

/** Release notes are shown in a dialog; a long changelog is cut to its opening. */
const NOTES_PREVIEW_CHARS = 600;

/** Follows the update service, whose state outlives any one screen. */
const useUpdateState = (service: UpdateService): UpdateState => {
  const [state, setState] = useState(service.getState);
  useEffect(() => {
    setState(service.getState());
    return service.subscribe(setState);
  }, [service]);
  return state;
};

const notesPreview = (notes: string | null): string => {
  const text = (notes ?? '').trim();
  if (!text) return '';
  return text.length > NOTES_PREVIEW_CHARS ? `${text.slice(0, NOTES_PREVIEW_CHARS).trimEnd()}…` : text;
};

/** An Alert with a confirm and a cancel button, as a promise. */
const ask = (title: string, message: string, confirmLabel: string, cancelLabel: string): Promise<boolean> =>
  new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });

/** "642 MB", for the dialogs. */
const sizeLabel = (bytes: number | null): string =>
  bytes ? `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB` : '';

const labelFor = (state: UpdateState): string => {
  switch (state.phase) {
    case 'checking':
      return 'Checking for updates…';
    case 'up-to-date':
      return 'Up to date';
    case 'available':
      return `Update to ${state.version}`;
    case 'needs-install':
      return `${state.version} needs a new install`;
    case 'downloading':
      return `Downloading ${state.percent ?? 0}%`;
    case 'ready':
      return state.kind === 'apk' ? 'Install update' : 'Restart to update';
    case 'error':
      return 'Update failed — tap to retry';
    default:
      return 'Check for Updates';
  }
};

interface AppUpdateItemProps {
  /** For tests; the app's own service otherwise. */
  service?: UpdateService;
}

/**
 * The Profile screen's update control. One row walks through the whole flow —
 * check, download, then restart (a JS update) or install (a new APK, confirmed
 * in Android's installer) — and is highlighted when there is something to do.
 */
export const AppUpdateItem: React.FC<AppUpdateItemProps> = ({ service = appUpdater }) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);
  const state = useUpdateState(service);
  const { phase } = state;
  const attention = phase === 'available' || phase === 'ready' || phase === 'needs-install';

  const offerRestart = async (ready: UpdateState): Promise<void> => {
    const restart = await ask(
      `Restart to update to ${ready.version}?`,
      'LAFINA closes and opens again on the new version. This takes a moment.\n\n' +
        'If you choose Later, the update is used the next time LAFINA starts.',
      'Restart now',
      'Later',
    );
    if (!restart) return;
    // Restarting ends the app's process, and a recording with it.
    const recording = await meetingRecorder.isRecording().catch(() => false);
    if (recording) {
      Alert.alert('A meeting is being recorded', 'Stop the recording first, then restart to update.');
      return;
    }
    const after = await service.restart();
    if (after.message) Alert.alert('Update not applied yet', after.message);
  };

  /** A new APK: Android's installer takes it from here, after asking the person. */
  const offerInstall = async (ready: UpdateState): Promise<void> => {
    const go = await ask(
      `Install LAFINA ${ready.version}?`,
      'Android asks you to confirm the update. LAFINA closes while it installs; your data stays on this phone.',
      'Install',
      'Later',
    );
    if (!go) return;
    // Installing replaces the app, which ends a recording.
    const recording = await meetingRecorder.isRecording().catch(() => false);
    if (recording) {
      Alert.alert('A meeting is being recorded', 'Stop the recording first, then install the update.');
      return;
    }
    const outcome = await service.install();
    if (outcome === 'needs-permission') {
      const open = await ask(
        'Allow LAFINA to install its updates',
        'Android asks this once for apps that update themselves. Turn on "Allow from this source" for LAFINA, ' +
          'then come back and tap Install update.',
        'Open settings',
        'Not now',
      );
      if (open) await service.openInstallPermissionSettings();
    } else if (outcome === 'failed') {
      Alert.alert('The update was not installed', service.getState().message ?? 'Try again.');
    }
  };

  const offerReady = (ready: UpdateState): Promise<void> =>
    ready.kind === 'apk' ? offerInstall(ready) : offerRestart(ready);

  const handlePress = async (): Promise<void> => {
    switch (phase) {
      case 'unsupported':
        Alert.alert('Updates', state.message ?? 'Updates are not available for this build.');
        return;
      case 'checking':
        return;
      case 'available':
      case 'needs-install':
        await offerFound(state);
        return;
      case 'downloading': {
        const stop = await ask('Downloading the update', `${state.percent ?? 0}% done.`, 'Cancel download', 'Keep going');
        if (stop) service.cancel();
        return;
      }
      case 'ready':
        await offerReady(state);
        return;
      case 'error': {
        const retry = await ask(
          'The update did not finish',
          state.message ?? 'Something went wrong while updating.',
          'Try again',
          'Close',
        );
        if (retry) await service.check();
        return;
      }
      default: {
        const result = await service.check();
        if (result.phase === 'up-to-date') {
          Alert.alert('Up to date', result.message ?? `LAFINA ${result.currentVersion} is the latest version.`);
        } else if (result.phase === 'error') {
          Alert.alert('Could not check for updates', result.message ?? '');
        } else if (result.phase === 'available' || result.phase === 'needs-install') {
          // Found one: say so in the same tap rather than making the person tap again.
          await offerFound(result);
        }
      }
    }
  };

  const offerFound = async (found: UpdateState): Promise<void> => {
    const notes = notesPreview(found.notes);
    if (found.phase === 'needs-install') {
      const open = await ask(
        `LAFINA ${found.version} is available`,
        `${notes ? `${notes}\n\n` : ''}This version changes the app itself, so it cannot be applied from ` +
          'inside the app. Download and install the new APK from the release page.',
        'Open release page',
        'Close',
      );
      if (open) await Linking.openURL(found.releaseUrl).catch(() => undefined);
      return;
    }
    const download = await ask(
      `LAFINA ${found.version} is available`,
      found.kind === 'apk'
        ? `${notes ? `${notes}\n\n` : ''}You have ${found.currentVersion}. This version updates the app itself, ` +
            `so it comes as a new app package (${sizeLabel(found.size)}). LAFINA downloads it and checks it, then ` +
            'Android asks you to confirm the update. Wi-Fi is best for a download this size.'
        : `${notes ? `${notes}\n\n` : ''}You have ${found.currentVersion}. The update is downloaded and its ` +
            'signature checked before it is used.',
      'Download',
      'Later',
    );
    if (!download) return;
    const result = await service.download();
    if (result.phase === 'ready') await offerReady(result);
    else if (result.phase === 'error') Alert.alert('The update did not finish', result.message ?? '');
  };

  const busy = phase === 'checking' || phase === 'downloading';

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => void handlePress()}
      disabled={phase === 'checking'}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={labelFor(state)}
      accessibilityState={{ busy }}
      testID="app-update-item"
    >
      <View style={styles.textColumn}>
        <Text style={[styles.label, themed.label, attention && [styles.attention, { color: colors.red }]]}>
          {labelFor(state)}
        </Text>
        {phase === 'downloading' && (
          <View style={[styles.track, themed.track]}>
            <View style={[styles.fill, { width: `${state.percent ?? 0}%`, backgroundColor: colors.red }]} />
          </View>
        )}
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={colors.textMuted} />
      ) : (
        attention && <View style={[styles.dot, { backgroundColor: colors.red }]} />
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  textColumn: {
    flex: 1,
    marginRight: 8,
  },
  label: {
    fontSize: 14,
    fontFamily: Fonts.body,
  },
  attention: {
    fontWeight: 'bold',
  },
  track: {
    height: 3,
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  fill: {
    height: 3,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

const getThemedStyles = (colors: ThemeColors) => ({
  label: { color: colors.textPrimary },
  track: { backgroundColor: colors.divider },
});
