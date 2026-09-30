import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, Shadows } from '../../theme';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { X, Calendar, AlertTriangle, AlertCircle } from 'lucide-react-native';
import type { BusinessMemberData } from '../../../cloud/businessService';
import { businessWorkBlocksStore } from '../../../storage';
import type { BusinessWorkBlockRow } from '../../../storage/syncTypes';

interface ScheduleBlockModalProps {
  visible: boolean;
  onClose: () => void;
  businessId: string;
  teamMembers: BusinessMemberData[];
  onScheduleBlock: (params: {
    userId: string;
    title: string;
    startTime: string;
    endTime: string;
    recurrenceRule?: string | null;
  }) => Promise<void>;
}

export const ScheduleBlockModal: React.FC<ScheduleBlockModalProps> = ({
  visible,
  onClose,
  businessId,
  teamMembers,
  onScheduleBlock,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);

  const [selectedUserId, setSelectedUserId] = useState(
    teamMembers.length > 0 ? teamMembers[0].user_id : ''
  );
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [recurrenceRule, setRecurrenceRule] = useState('');
  const [conflicts, setConflicts] = useState<BusinessWorkBlockRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const checkConflicts = (userId: string, start: string, end: string) => {
    if (!userId || !start || !end) {
      setConflicts([]);
      return;
    }
    const result = businessWorkBlocksStore.checkWorkBlockConflict(
      businessId,
      userId,
      start,
      end
    );
    setConflicts(result.conflictingBlocks);
  };

  const handleStartTimeChange = (text: string) => {
    setStartTime(text);
    checkConflicts(selectedUserId, text, endTime);
  };

  const handleEndTimeChange = (text: string) => {
    setEndTime(text);
    checkConflicts(selectedUserId, startTime, text);
  };

  const handleUserChange = (userId: string) => {
    setSelectedUserId(userId);
    checkConflicts(userId, startTime, endTime);
  };

  const handleSubmit = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setErrorMessage('Please enter a title for the work block.');
      return;
    }
    if (!selectedUserId) {
      setErrorMessage('Please select a team member.');
      return;
    }
    if (!startTime.trim() || !endTime.trim()) {
      setErrorMessage('Please specify start and end time.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await onScheduleBlock({
        userId: selectedUserId,
        title: trimmedTitle,
        startTime: startTime.trim(),
        endTime: endTime.trim(),
        recurrenceRule: recurrenceRule.trim() || null,
      });

      // Reset
      setTitle('');
      setStartTime('');
      setEndTime('');
      setRecurrenceRule('');
      setConflicts([]);
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to schedule work block.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={[styles.modalOverlay, themed.overlay]}>
        <View style={[styles.modalCard, themed.card, Shadows.card]}>
          {/* Header */}
          <View style={[styles.modalHeader, themed.borderBottom]}>
            <View style={styles.headerLeft}>
              <Calendar size={22} color={colors.blue} />
              <Text style={[styles.modalTitle, themed.text]}>Schedule Work Block</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close schedule modal"
            >
              <X size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent}>
            {errorMessage ? (
              <View style={[styles.errorBanner, { backgroundColor: '#FEE2E2', borderColor: '#DC2626' }]}>
                <AlertCircle size={18} color="#DC2626" />
                <Text style={[styles.errorBannerText, { color: '#991B1B' }]}>{errorMessage}</Text>
              </View>
            ) : null}

            {/* Conflict Warning */}
            {conflicts.length > 0 ? (
              <View style={[styles.conflictBanner, { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' }]}>
                <AlertTriangle size={20} color="#D97706" />
                <View style={styles.conflictInfo}>
                  <Text style={[styles.conflictTitle, { color: '#92400E' }]}>
                    Overlap Conflict Detected
                  </Text>
                  <Text style={[styles.conflictDesc, { color: '#B45309' }]}>
                    {`Employee has ${conflicts.length} overlapping block(s) scheduled during this time window. You may confirm to schedule anyway.`}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Team Member Selector */}
            <Text style={[styles.inputLabel, themed.text]}>Assignee / Employee *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.memberChipsScroll}>
              <View style={styles.memberChipsRow}>
                {teamMembers.map((m) => {
                  const isSelected = selectedUserId === m.user_id;
                  return (
                    <TouchableOpacity
                      key={m.user_id}
                      style={[
                        styles.memberChip,
                        isSelected && { backgroundColor: colors.blue, borderColor: colors.blue },
                      ]}
                      onPress={() => handleUserChange(m.user_id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${m.email}`}
                    >
                      <Text
                        style={[
                          styles.memberChipText,
                          themed.text,
                          isSelected && { color: '#FFF', fontWeight: 'bold' },
                        ]}
                      >
                        {m.email}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            {/* Block Title */}
            <Text style={[styles.inputLabel, themed.text]}>Shift / Block Title *</Text>
            <TextInput
              style={[styles.input, themed.input, themed.text]}
              placeholder="e.g. Morning Shift - IT Support Desk"
              placeholderTextColor={colors.placeholder}
              value={title}
              onChangeText={setTitle}
              accessibilityLabel="Work block title input"
            />

            {/* Start Time */}
            <Text style={[styles.inputLabel, themed.text]}>Start Time (ISO Format) *</Text>
            <TextInput
              style={[styles.input, themed.input, themed.text]}
              placeholder="e.g. 2026-08-30T09:00:00Z"
              placeholderTextColor={colors.placeholder}
              value={startTime}
              onChangeText={handleStartTimeChange}
              accessibilityLabel="Start time input"
            />

            {/* End Time */}
            <Text style={[styles.inputLabel, themed.text]}>End Time (ISO Format) *</Text>
            <TextInput
              style={[styles.input, themed.input, themed.text]}
              placeholder="e.g. 2026-08-30T17:00:00Z"
              placeholderTextColor={colors.placeholder}
              value={endTime}
              onChangeText={handleEndTimeChange}
              accessibilityLabel="End time input"
            />

            {/* Recurrence Rule */}
            <Text style={[styles.inputLabel, themed.text]}>Recurrence (Optional RRULE)</Text>
            <TextInput
              style={[styles.input, themed.input, themed.text]}
              placeholder="e.g. FREQ=WEEKLY;BYDAY=MO,WE,FR"
              placeholderTextColor={colors.placeholder}
              value={recurrenceRule}
              onChangeText={setRecurrenceRule}
              accessibilityLabel="Recurrence rule input"
            />
          </ScrollView>

          {/* Footer */}
          <View style={[styles.footer, themed.borderTop]}>
            <TouchableOpacity
              style={[styles.cancelBtn, themed.buttonSecondary]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Cancel schedule"
            >
              <Text style={[styles.cancelBtnText, themed.buttonSecondaryText]}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.submitBtn,
                { backgroundColor: conflicts.length > 0 ? '#D97706' : colors.blue },
              ]}
              onPress={handleSubmit}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityLabel="Confirm schedule block"
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.submitBtnText}>
                  {conflicts.length > 0 ? 'Schedule Anyway' : 'Confirm Schedule'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const getThemedStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: { backgroundColor: colors.cardBg },
    overlay: { backgroundColor: 'rgba(0,0,0,0.6)' },
    text: { color: colors.textPrimary },
    textSecondary: { color: colors.textSecondary },
    input: {
      backgroundColor: colors.inputBg,
      borderColor: colors.border,
    },
    border: { borderColor: colors.border },
    borderBottom: { borderBottomColor: colors.border },
    borderTop: { borderTopColor: colors.border },
    buttonSecondary: {
      backgroundColor: colors.inputBg,
      borderColor: colors.border,
    },
    buttonSecondaryText: { color: colors.textPrimary },
  });

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
  },
  scrollContent: {
    padding: 20,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  errorBannerText: {
    fontSize: 13,
    fontFamily: Fonts.body,
    fontWeight: '500',
    flex: 1,
  },
  conflictBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  conflictInfo: {
    flex: 1,
  },
  conflictTitle: {
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  conflictDesc: {
    fontSize: 12,
    fontFamily: Fonts.body,
    lineHeight: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: Fonts.body,
  },
  memberChipsScroll: {
    marginBottom: 4,
  },
  memberChipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  memberChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DDDDDD',
  },
  memberChipText: {
    fontSize: 13,
    fontFamily: Fonts.body,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
    borderTopWidth: 1,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  submitBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
});
