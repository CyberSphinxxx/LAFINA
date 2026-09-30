import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, Shadows } from '../../theme';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { Building2, MailCheck, Check, ArrowRight, X } from 'lucide-react-native';
import type { BusinessInvitationData } from '../../../cloud/businessService';

interface BusinessOnboardingProps {
  mode: 'create_workspace' | 'accept_invitation';
  pendingInvitation?: BusinessInvitationData;
  onCreateWorkspace?: (name: string, timezone: string) => Promise<void>;
  onAcceptInvitation?: (invitationId: string) => Promise<void>;
  onDeclineInvitation?: (invitationId: string) => Promise<void>;
  onSkipToPersonal?: () => void;
}

export const BusinessOnboardingScreen: React.FC<BusinessOnboardingProps> = ({
  mode,
  pendingInvitation,
  onCreateWorkspace,
  onAcceptInvitation,
  onDeclineInvitation,
  onSkipToPersonal,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);

  const [workspaceName, setWorkspaceName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Manila');
  const [isLoading, setIsLoading] = useState(false);

  const handleCreate = async () => {
    const trimmed = workspaceName.trim();
    if (!trimmed) {
      Alert.alert('Validation Error', 'Please enter a name for your organization workspace.');
      return;
    }
    try {
      setIsLoading(true);
      await onCreateWorkspace?.(trimmed, timezone);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create workspace.';
      Alert.alert('Error', msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAccept = async () => {
    if (!pendingInvitation) return;
    try {
      setIsLoading(true);
      await onAcceptInvitation?.(pendingInvitation.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to accept invitation.';
      Alert.alert('Error', msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDecline = async () => {
    if (!pendingInvitation) return;
    try {
      setIsLoading(true);
      await onDeclineInvitation?.(pendingInvitation.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to decline invitation.';
      Alert.alert('Error', msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={[styles.screen, themed.screen]}>
      <ScrollView contentContainerStyle={styles.content}>
        {mode === 'create_workspace' ? (
          <View style={styles.section}>
            <View style={[styles.iconContainer, { backgroundColor: '#FEE2E2' }]}>
              <Building2 size={40} color={colors.red} />
            </View>
            <Text style={[styles.title, themed.text]}>Set Up Business Workspace</Text>
            <Text style={[styles.subtitle, themed.mutedText]}>
              Create your organization team workspace. You will have full manager access, seat management, and collaboration features.
            </Text>

            <View style={[styles.card, themed.card, Shadows.card]}>
              <Text style={[styles.inputLabel, themed.text]}>Company / Workspace Name</Text>
              <TextInput
                style={[styles.input, themed.input]}
                placeholder="e.g. Acme Corporation, USTP Lab Team"
                placeholderTextColor={colors.textMuted}
                value={workspaceName}
                onChangeText={setWorkspaceName}
                accessible={true}
                accessibilityLabel="Workspace name input"
              />

              <Text style={[styles.inputLabel, themed.text, { marginTop: 12 }]}>Timezone</Text>
              <TextInput
                style={[styles.input, themed.input]}
                value={timezone}
                onChangeText={setTimezone}
                accessible={true}
                accessibilityLabel="Workspace timezone input"
              />

              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.red }]}
                onPress={handleCreate}
                disabled={isLoading}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Create Business Workspace"
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Text style={styles.primaryBtnText}>Create Workspace</Text>
                    <ArrowRight size={18} color="#FFF" />
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.section}>
            <View style={[styles.iconContainer, { backgroundColor: '#EFF6FF' }]}>
              <MailCheck size={40} color={colors.blue} />
            </View>
            <Text style={[styles.title, themed.text]}>Team Invitation</Text>
            <Text style={[styles.subtitle, themed.mutedText]}>
              You have been invited to join an organization workspace on LAFINA.
            </Text>

            {pendingInvitation && (
              <View style={[styles.card, themed.card, Shadows.card]}>
                <Text style={[styles.invOrgName, themed.text]}>
                  {pendingInvitation.business_name || 'Organization Workspace'}
                </Text>
                <Text style={[styles.invRoleText, themed.mutedText]}>
                  Role: {pendingInvitation.member_role.toUpperCase()}
                </Text>
                <Text style={[styles.invDetail, themed.mutedText]}>
                  Invited by: {pendingInvitation.invited_by}
                </Text>

                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.declineBtn, themed.declineBtn]}
                    onPress={handleDecline}
                    disabled={isLoading}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="Decline team invitation"
                  >
                    <X size={18} color={colors.textMuted} />
                    <Text style={[styles.declineBtnText, themed.mutedText]}>Decline</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.acceptBtn, { backgroundColor: colors.blue }]}
                    onPress={handleAccept}
                    disabled={isLoading}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="Accept team invitation"
                  >
                    {isLoading ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <>
                        <Check size={18} color="#FFF" />
                        <Text style={styles.acceptBtnText}>Join Workspace</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {onSkipToPersonal && (
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={onSkipToPersonal}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Continue to Personal Student account"
          >
            <Text style={[styles.skipText, themed.mutedText]}>
              Continue to Personal Student Mode
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
};

const getThemedStyles = (colors: ThemeColors) => ({
  screen: { backgroundColor: colors.background },
  card: { backgroundColor: colors.cardBg, borderColor: colors.border },
  input: { backgroundColor: colors.background, borderColor: colors.border, color: colors.textPrimary },
  declineBtn: { backgroundColor: colors.background, borderColor: colors.border },
  text: { color: colors.textPrimary },
  mutedText: { color: colors.textMuted },
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    padding: 24,
    justifyContent: 'center',
  },
  section: {
    alignItems: 'center',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: Fonts.body,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    paddingHorizontal: 12,
  },
  card: {
    width: '100%',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
  },
  inputLabel: {
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: Fonts.body,
    minHeight: 44,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 20,
    minHeight: 48,
  },
  primaryBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  invOrgName: {
    fontSize: 18,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  invRoleText: {
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: '600',
    marginBottom: 4,
  },
  invDetail: {
    fontSize: 12,
    fontFamily: Fonts.body,
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  declineBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 44,
  },
  declineBtnText: {
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  acceptBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    minHeight: 44,
  },
  acceptBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  skipBtn: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 16,
    minHeight: 44,
  },
  skipText: {
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
