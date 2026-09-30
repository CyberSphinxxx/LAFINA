import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, Shadows } from '../../theme';
import type { ThemeColors } from '../../contexts/ThemeContext';
import {
  X,
  UserPlus,
  Shield,
  UserCheck,
  UserX,
  Trash2,
} from 'lucide-react-native';
import type { BusinessMemberData, BusinessInvitationData } from '../../../cloud/businessService';
import type { BusinessMemberRole, MembershipStatus } from '../../../storage/syncTypes';

interface TeamManagementModalProps {
  visible: boolean;
  onClose: () => void;
  businessId?: string;
  isOwner?: boolean;
  activeSeats?: number;
  seatLimit?: number;
  members: BusinessMemberData[];
  invitations: BusinessInvitationData[];
  onInviteMember: (email: string, role: BusinessMemberRole) => Promise<void>;
  onUpdateRole: (userId: string, role: BusinessMemberRole) => Promise<void>;
  onUpdateStatus: (userId: string, status: MembershipStatus) => Promise<void>;
  onCancelInvitation: (invitationId: string) => Promise<void>;
}

export const TeamManagementModal: React.FC<TeamManagementModalProps> = ({
  visible,
  onClose,
  businessId: _businessId,
  isOwner = false,
  activeSeats = 1,
  seatLimit = 5,
  members,
  invitations,
  onInviteMember,
  onUpdateRole,
  onUpdateStatus,
  onCancelInvitation,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<BusinessMemberRole>('employee');
  const [isInviting, setIsInviting] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);

  const handleSendInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) {
      Alert.alert('Validation Error', 'Please enter a valid email address.');
      return;
    }
    if (activeSeats >= seatLimit) {
      Alert.alert(
        'Seat Limit Reached',
        `Your organization has reached the ${seatLimit} seat limit. Upgrade seats to invite more members.`
      );
      return;
    }

    try {
      setIsInviting(true);
      await onInviteMember(email, inviteRole);
      setInviteEmail('');
      setShowInviteForm(false);
      Alert.alert('Invitation Sent', `Invitation sent to ${email} (expires in 7 days).`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to send invitation.';
      Alert.alert('Error', errorMsg);
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContainer, themed.modalContainer]}>
          {/* Header */}
          <View style={[styles.header, themed.header]}>
            <Text style={[styles.title, themed.text]}>Team Management</Text>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Close team management dialog"
            >
              <X size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent}>
            {/* Seat Limit Progress */}
            <View style={[styles.seatBanner, themed.card, Shadows.card]}>
              <View style={styles.seatHeader}>
                <Text style={[styles.seatTitle, themed.text]}>Seat Capacity</Text>
                <Text style={[styles.seatCount, themed.text]}>
                  {`${activeSeats} of ${seatLimit} Seats Used`}
                </Text>
              </View>
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${Math.min(100, (activeSeats / Math.max(1, seatLimit)) * 100)}%`,
                      backgroundColor: activeSeats >= seatLimit ? '#DC2626' : colors.red,
                    },
                  ]}
                />
              </View>
            </View>

            {/* Invite Form or Button */}
            {showInviteForm ? (
              <View style={[styles.inviteCard, themed.card]}>
                <Text style={[styles.sectionSubtitle, themed.text]}>Invite Team Member</Text>
                <TextInput
                  style={[styles.input, themed.input]}
                  placeholder="Normalized user email..."
                  placeholderTextColor={colors.textMuted}
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  accessible={true}
                  accessibilityLabel="Team member email to invite"
                />

                <View style={styles.rolePickerRow}>
                  <TouchableOpacity
                    style={[
                      styles.roleOption,
                      inviteRole === 'employee' && [styles.activeRoleOption, { backgroundColor: colors.blue }],
                    ]}
                    onPress={() => setInviteRole('employee')}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="Invite as Employee"
                  >
                    <Text
                      style={[
                        styles.roleOptionText,
                        inviteRole === 'employee' ? styles.activeRoleText : themed.mutedText,
                      ]}
                    >
                      Employee
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.roleOption,
                      inviteRole === 'manager' && [styles.activeRoleOption, { backgroundColor: colors.red }],
                    ]}
                    onPress={() => setInviteRole('manager')}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="Invite as Manager"
                  >
                    <Text
                      style={[
                        styles.roleOptionText,
                        inviteRole === 'manager' ? styles.activeRoleText : themed.mutedText,
                      ]}
                    >
                      Manager
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.formBtnRow}>
                  <TouchableOpacity
                    style={[styles.cancelBtn, themed.cancelBtn]}
                    onPress={() => setShowInviteForm(false)}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel invitation form"
                  >
                    <Text style={[styles.cancelBtnText, themed.text]}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.sendBtn, { backgroundColor: colors.red }]}
                    onPress={handleSendInvite}
                    disabled={isInviting}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="Send invitation email"
                  >
                    {isInviting ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Text style={styles.sendBtnText}>Send Invite</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.inviteToggleBtn, { backgroundColor: colors.red }]}
                onPress={() => setShowInviteForm(true)}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Open invite member form"
              >
                <UserPlus size={18} color="#FFF" />
                <Text style={styles.inviteToggleText}>Invite Employee / Manager</Text>
              </TouchableOpacity>
            )}

            {/* Members Roster */}
            <Text style={[styles.sectionTitle, themed.text]}>Team Members ({members.length})</Text>
            {members.map((member) => (
              <View key={member.user_id} style={[styles.memberRow, themed.card]}>
                <View style={styles.memberInfo}>
                  <Text style={[styles.memberEmail, themed.text]}>{member.email}</Text>
                  <View style={styles.badgeRow}>
                    <View
                      style={[
                        styles.roleBadge,
                        {
                          backgroundColor:
                            member.member_role === 'manager' ? '#FEE2E2' : '#EFF6FF',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.roleBadgeText,
                          {
                            color: member.member_role === 'manager' ? '#DC2626' : '#2563EB',
                          },
                        ]}
                      >
                        {member.member_role.toUpperCase()}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor:
                            member.membership_status === 'active' ? '#DCFCE7' : '#FEF3C7',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusBadgeText,
                          {
                            color:
                              member.membership_status === 'active' ? '#16A34A' : '#D97706',
                          },
                        ]}
                      >
                        {member.membership_status}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Owner controls */}
                <View style={styles.memberActionGroup}>
                  {isOwner && member.member_role === 'employee' && (
                    <TouchableOpacity
                      style={styles.actionIconBtn}
                      onPress={() => onUpdateRole(member.user_id, 'manager')}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel={`Promote ${member.email} to Manager`}
                    >
                      <Shield size={16} color={colors.red} />
                    </TouchableOpacity>
                  )}

                  {isOwner && member.member_role === 'manager' && (
                    <TouchableOpacity
                      style={styles.actionIconBtn}
                      onPress={() => onUpdateRole(member.user_id, 'employee')}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel={`Demote ${member.email} to Employee`}
                    >
                      <UserCheck size={16} color={colors.blue} />
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={styles.actionIconBtn}
                    onPress={() => {
                      const next = member.membership_status === 'active' ? 'suspended' : 'active';
                      onUpdateStatus(member.user_id, next);
                    }}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={`Toggle active or suspended status for ${member.email}`}
                  >
                    <UserX size={16} color="#D97706" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.actionIconBtn}
                    onPress={() => {
                      Alert.alert(
                        'Remove Member',
                        `Are you sure you want to remove ${member.email}? Their assigned tasks will be marked Needs Assignee.`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Remove',
                            style: 'destructive',
                            onPress: () => onUpdateStatus(member.user_id, 'removed'),
                          },
                        ]
                      );
                    }}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${member.email} from organization`}
                  >
                    <Trash2 size={16} color="#DC2626" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            {/* Pending Invitations */}
            {invitations.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, themed.text, { marginTop: 24 }]}>
                  Pending Invitations ({invitations.length})
                </Text>
                {invitations.map((inv) => (
                  <View key={inv.id} style={[styles.memberRow, themed.card]}>
                    <View style={styles.memberInfo}>
                      <Text style={[styles.memberEmail, themed.text]}>{inv.email}</Text>
                      <Text style={[styles.invExpText, themed.mutedText]}>
                        Role: {inv.member_role} • Expires {new Date(inv.expires_at).toLocaleDateString()}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.actionIconBtn}
                      onPress={() => onCancelInvitation(inv.id)}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel={`Cancel invitation for ${inv.email}`}
                    >
                      <X size={18} color="#DC2626" />
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const getThemedStyles = (colors: ThemeColors) => ({
  modalContainer: { backgroundColor: colors.cardBg },
  header: { borderBottomColor: colors.border },
  card: { backgroundColor: colors.background, borderColor: colors.border },
  input: { backgroundColor: colors.cardBg, borderColor: colors.border, color: colors.textPrimary },
  cancelBtn: { backgroundColor: colors.cardBg, borderColor: colors.border },
  text: { color: colors.textPrimary },
  mutedText: { color: colors.textMuted },
});

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    height: '85%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 18,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 48,
  },
  seatBanner: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  seatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  seatTitle: {
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  seatCount: {
    fontSize: 13,
    fontFamily: Fonts.body,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  inviteToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    minHeight: 44,
    marginBottom: 20,
  },
  inviteToggleText: {
    color: '#FFF',
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  inviteCard: {
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  sectionSubtitle: {
    fontSize: 15,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: Fonts.body,
    marginBottom: 12,
    minHeight: 44,
  },
  rolePickerRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  roleOption: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  activeRoleOption: {
    borderColor: 'transparent',
  },
  roleOptionText: {
    fontSize: 13,
    fontFamily: Fonts.heading,
  },
  activeRoleText: {
    color: '#FFF',
    fontWeight: 'bold',
  },
  formBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 13,
    fontFamily: Fonts.heading,
  },
  sendBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  sendBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  memberInfo: {
    flex: 1,
  },
  memberEmail: {
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: '600',
    marginBottom: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  roleBadgeText: {
    fontSize: 10,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadgeText: {
    fontSize: 10,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  invExpText: {
    fontSize: 11,
    fontFamily: Fonts.body,
  },
  memberActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
  },
});
