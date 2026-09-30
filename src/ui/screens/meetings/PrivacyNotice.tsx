import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Cloud, HardDrive, Lock } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Spacing } from '../../theme';
import { getMeetingThemedStyles, meetingStyles } from './meetingStyles';

/**
 * Where each part of a meeting goes.
 *
 * Worded to be exact rather than reassuring: the audio and the transcription
 * stay on this phone, but the transcript text is sent to DeepSeek to write the
 * notes, and that is said plainly instead of implied away.
 */
export const PrivacyNotice: React.FC = () => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getMeetingThemedStyles);
  const rows = [
    {
      icon: HardDrive,
      color: colors.textSecondary,
      lead: 'Audio is recorded on this phone',
      rest: ' and stays here until you delete it. It is never uploaded, and it does not sync to your other devices.',
    },
    {
      icon: Lock,
      color: colors.textSecondary,
      lead: 'Transcription runs on this phone',
      rest: ' with Whisper, so it works without a connection.',
    },
    {
      icon: Cloud,
      color: colors.warning,
      lead: 'The transcript is sent to DeepSeek',
      rest: ', an external AI service, through LAFINA’s server over HTTPS to write the notes. The transcript and notes then sync to your other devices. Treat what is said in the meeting as shared with that service.',
    },
  ];
  return (
    <View>
      {rows.map(({ icon: Icon, color, lead, rest }) => (
        <View key={lead} style={styles.row}>
          <Icon size={18} color={color} />
          <Text style={[meetingStyles.body, styles.text, themed.textPrimary]}>
            <Text style={meetingStyles.strong}>{lead}</Text>
            {rest}
          </Text>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: Spacing.md,
  },
  text: {
    flex: 1,
    marginLeft: Spacing.md,
  },
});
