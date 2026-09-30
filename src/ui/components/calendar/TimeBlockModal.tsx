import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, TextInput, TouchableOpacity, Platform } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Colors, Fonts, Shadows, useThemedStyles } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { TimeBlock } from '../../../storage/timeBlocksStore';

interface TimeBlockModalProps {
  visible: boolean;
  editingBlock: TimeBlock | null;
  title: string;
  setTitle: (val: string) => void;
  startTime: string;
  setStartTime: (val: string) => void;
  endTime: string;
  setEndTime: (val: string) => void;
  category: string;
  setCategory: (val: string) => void;
  color: string;
  setColor: (val: string) => void;
  notes: string;
  setNotes: (val: string) => void;
  onSave: (recurrenceRule: string | null) => void;
  onDelete: (id: string) => void;
  onCancel: () => void;
  timeFormat24h: boolean;
}

const timeStringToDate = (timeStr: string): Date => {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date();
  d.setHours(isNaN(h) ? 0 : h, isNaN(m) ? 0 : m, 0, 0);
  return d;
};

const dateToTimeString = (d: Date): string => {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
};

const formatTimeForDisplay = (timeStr: string, is24Hour: boolean): string => {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return timeStr;

  if (is24Hour) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  } else {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayHour = h % 12 === 0 ? 12 : h % 12;
    const displayMin = m.toString().padStart(2, '0');
    return `${displayHour.toString().padStart(2, '0')}:${displayMin} ${ampm}`;
  }
};

import { parseRrule } from '../../../storage/rruleHelper';

export const TimeBlockModal: React.FC<TimeBlockModalProps> = ({
  visible,
  editingBlock,
  title,
  setTitle,
  startTime,
  setStartTime,
  endTime,
  setEndTime,
  category,
  setCategory,
  color,
  setColor,
  notes,
  setNotes,
  onSave,
  onDelete,
  onCancel,
  timeFormat24h,
}) => {
  const { isDarkMode } = useTheme();
  const themed = useThemedStyles(getThemedStyles);

  // Local state for native time picker visibility
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // Local recurrence form states
  const [repeatFreq, setRepeatFreq] = useState<'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'>('NONE');
  const [repeatInterval, setRepeatInterval] = useState('1');
  const [repeatWeekDays, setRepeatWeekDays] = useState<string[]>([]);
  const [repeatEndType, setRepeatEndType] = useState<'NEVER' | 'UNTIL' | 'COUNT'>('NEVER');
  const [repeatUntil, setRepeatUntil] = useState(''); // YYYY-MM-DD
  const [repeatCount, setRepeatCount] = useState('10');
  const [showUntilDatePicker, setShowUntilDatePicker] = useState(false);

  // Sync parent block values to local state
  React.useEffect(() => {
    if (visible) {
      if (editingBlock && editingBlock.recurrenceRule) {
        const rule = parseRrule(editingBlock.recurrenceRule);
        if (rule) {
          setRepeatFreq(rule.freq);
          setRepeatInterval(String(rule.interval || 1));
          setRepeatWeekDays(rule.byday || []);
          if (rule.until) {
            setRepeatEndType('UNTIL');
            setRepeatUntil(rule.until);
          } else if (rule.count) {
            setRepeatEndType('COUNT');
            setRepeatCount(String(rule.count));
          } else {
            setRepeatEndType('NEVER');
          }
          return;
        }
      }
      // Reset
      setRepeatFreq('NONE');
      setRepeatInterval('1');
      setRepeatWeekDays([]);
      setRepeatEndType('NEVER');
      setRepeatUntil('');
      setRepeatCount('10');
    }
  }, [visible, editingBlock]);

  const handleSaveLocal = () => {
    let ruleStr: string | null = null;
    if (repeatFreq !== 'NONE') {
      const parts = [`FREQ=${repeatFreq}`];
      const parsedInterval = parseInt(repeatInterval, 10);
      if (!isNaN(parsedInterval) && parsedInterval > 0) {
        parts.push(`INTERVAL=${parsedInterval}`);
      }
      if (repeatFreq === 'WEEKLY' && repeatWeekDays.length > 0) {
        parts.push(`BYDAY=${repeatWeekDays.join(',')}`);
      }
      if (repeatEndType === 'UNTIL' && repeatUntil) {
        const cleanUntil = repeatUntil.replace(/-/g, '');
        parts.push(`UNTIL=${cleanUntil}T235959Z`);
      } else if (repeatEndType === 'COUNT' && repeatCount) {
        const parsedCount = parseInt(repeatCount, 10);
        if (!isNaN(parsedCount) && parsedCount > 0) {
          parts.push(`COUNT=${parsedCount}`);
        }
      }
      ruleStr = parts.join(';');
    }
    onSave(ruleStr);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, themed.modalContent]}>
          <Text style={[styles.modalHeaderTitle, themed.modalHeaderTitle]}>
            {editingBlock ? 'Edit Time Block' : 'Create Time Block'}
          </Text>
          
          <TextInput
            style={[styles.modalInput, themed.modalInput]}
            placeholder="Deep Work, Study, Lunch..."
            placeholderTextColor={isDarkMode ? '#666' : '#888'}
            value={title}
            onChangeText={setTitle}
          />

          <View style={styles.modalTimeRow}>
            <View style={styles.timeInputCol}>
              <Text style={[styles.timeInputLabel, themed.timeInputLabel]}>Start Time</Text>
              <TouchableOpacity
                style={[styles.timePickerBtn, themed.timePickerBtn]}
                onPress={() => setShowStartPicker(true)}
                activeOpacity={0.7}
              >
                <Text style={[styles.timePickerBtnText, themed.timePickerBtnText]}>
                  {formatTimeForDisplay(startTime, timeFormat24h)}
                </Text>
              </TouchableOpacity>
              {showStartPicker && (
                <DateTimePicker
                  value={timeStringToDate(startTime)}
                  mode="time"
                  is24Hour={timeFormat24h}
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_event: DateTimePickerEvent, date?: Date) => {
                    setShowStartPicker(false);
                    if (date) setStartTime(dateToTimeString(date));
                  }}
                />
              )}
            </View>
            <View style={styles.timeInputCol}>
              <Text style={[styles.timeInputLabel, themed.timeInputLabel]}>End Time</Text>
              <TouchableOpacity
                style={[styles.timePickerBtn, themed.timePickerBtn]}
                onPress={() => setShowEndPicker(true)}
                activeOpacity={0.7}
              >
                <Text style={[styles.timePickerBtnText, themed.timePickerBtnText]}>
                  {formatTimeForDisplay(endTime, timeFormat24h)}
                </Text>
              </TouchableOpacity>
              {showEndPicker && (
                <DateTimePicker
                  value={timeStringToDate(endTime)}
                  mode="time"
                  is24Hour={timeFormat24h}
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_event: DateTimePickerEvent, date?: Date) => {
                    setShowEndPicker(false);
                    if (date) setEndTime(dateToTimeString(date));
                  }}
                />
              )}
            </View>
          </View>

          <View style={styles.categoryRow}>
            {['Work', 'Personal', 'Health', 'Learning'].map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[
                  styles.categoryChip,
                  themed.categoryChip,
                  category === cat && styles.categoryChipActive,
                  category === cat && themed.categoryChipActive,
                ]}
                onPress={() => setCategory(cat)}
              >
                <Text style={[
                  styles.categoryChipText,
                  themed.categoryChipText,
                  category === cat && styles.categoryChipTextActive,
                  category === cat && themed.categoryChipTextActive,
                ]}>
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.colorRow}>
            {[Colors.blue, Colors.red, Colors.yellow, Colors.success, '#9B59B6'].map((c) => (
              <TouchableOpacity
                key={c}
                style={[
                  styles.colorBubble,
                  themed.colorBubble,
                  { backgroundColor: c },
                  color === c && styles.colorBubbleActive,
                  color === c && themed.colorBubbleActive,
                ]}
                onPress={() => setColor(c)}
              />
            ))}
          </View>

          {/* Recurrence Section */}
          <Text style={[styles.sectionLabel, themed.sectionLabel]}>Recurrence</Text>
          <View style={styles.recurrenceContainer}>
            <View style={styles.freqRow}>
              {(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const).map((freq) => (
                <TouchableOpacity
                  key={freq}
                  style={[
                    styles.freqBtn,
                    themed.freqBtn,
                    repeatFreq === freq && styles.freqBtnActive,
                    repeatFreq === freq && themed.freqBtnActive,
                  ]}
                  onPress={() => setRepeatFreq(freq)}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.freqBtnText,
                    themed.freqBtnText,
                    repeatFreq === freq && styles.freqBtnTextActive,
                    repeatFreq === freq && themed.freqBtnTextActive,
                  ]}>
                    {freq === 'NONE' ? 'None' : freq.charAt(0) + freq.slice(1).toLowerCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {repeatFreq !== 'NONE' && (
              <View style={[styles.recurrenceDetails, themed.recurrenceDetails]}>
                {/* Interval */}
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, themed.detailLabel]}>Repeat every</Text>
                  <TextInput
                    style={[styles.detailNumberInput, themed.detailInput]}
                    keyboardType="numeric"
                    value={repeatInterval}
                    onChangeText={setRepeatInterval}
                  />
                  <Text style={[styles.detailLabel, themed.detailLabel]}>
                    {repeatFreq === 'DAILY' ? 'days' : repeatFreq === 'WEEKLY' ? 'weeks' : repeatFreq === 'MONTHLY' ? 'months' : 'years'}
                  </Text>
                </View>

                {/* Weekly Days */}
                {repeatFreq === 'WEEKLY' && (
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, themed.detailLabel]}>On days</Text>
                    <View style={styles.weekDaysGrid}>
                      {(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const).map((day) => {
                        const active = repeatWeekDays.includes(day);
                        return (
                          <TouchableOpacity
                            key={day}
                            style={[
                              styles.dayBubble,
                              themed.dayBubble,
                              active && styles.dayBubbleActive,
                            ]}
                            onPress={() => {
                              if (active) {
                                setRepeatWeekDays(repeatWeekDays.filter(d => d !== day));
                              } else {
                                setRepeatWeekDays([...repeatWeekDays, day]);
                              }
                            }}
                          >
                            <Text style={[
                              styles.dayBubbleText,
                              themed.dayBubbleText,
                              active && styles.dayBubbleTextActive,
                            ]}>
                              {day[0]}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}

                {/* End Condition */}
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, themed.detailLabel]}>Ends</Text>
                  <View style={styles.endTypeRow}>
                    {(['NEVER', 'UNTIL', 'COUNT'] as const).map((type) => (
                      <TouchableOpacity
                        key={type}
                        style={[
                          styles.endTypeBtn,
                          themed.endTypeBtn,
                          repeatEndType === type && styles.endTypeBtnActive,
                        ]}
                        onPress={() => setRepeatEndType(type)}
                      >
                        <Text style={[
                          styles.endTypeBtnText,
                          themed.endTypeBtnText,
                          repeatEndType === type && styles.endTypeBtnTextActive,
                        ]}>
                          {type === 'NEVER' ? 'Never' : type === 'UNTIL' ? 'On Date' : 'After'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* End Details */}
                {repeatEndType === 'UNTIL' && (
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, themed.detailLabel]}>Until date</Text>
                    <TouchableOpacity
                      style={[styles.dateSelectorBtn, themed.detailInput]}
                      onPress={() => setShowUntilDatePicker(true)}
                    >
                      <Text style={[styles.dateSelectorBtnText, themed.dateSelectorBtnText]}>
                        {repeatUntil || 'Select Date'}
                      </Text>
                    </TouchableOpacity>
                    {showUntilDatePicker && (
                      <DateTimePicker
                        value={repeatUntil ? new Date(repeatUntil) : new Date()}
                        mode="date"
                        display="default"
                        onChange={(_event, date) => {
                          setShowUntilDatePicker(false);
                          if (date) {
                            setRepeatUntil(date.toISOString().split('T')[0]);
                          }
                        }}
                      />
                    )}
                  </View>
                )}

                {repeatEndType === 'COUNT' && (
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, themed.detailLabel]}>End after</Text>
                    <TextInput
                      style={[styles.detailNumberInput, themed.detailInput]}
                      keyboardType="numeric"
                      value={repeatCount}
                      onChangeText={setRepeatCount}
                    />
                    <Text style={[styles.detailLabel, themed.detailLabel]}>occurrences</Text>
                  </View>
                )}
              </View>
            )}
          </View>

          <TextInput
            style={[styles.modalInput, themed.modalInput, styles.textArea]}
            placeholder="Add optional notes..."
            placeholderTextColor={isDarkMode ? '#666' : '#888'}
            multiline
            numberOfLines={3}
            value={notes}
            onChangeText={setNotes}
          />

          <View style={styles.actionRow}>
            {editingBlock && (
              <TouchableOpacity
                style={[styles.modalBtn, styles.deleteBtn]}
                onPress={() => onDelete(editingBlock.id)}
              >
                <Text style={styles.modalBtnText}>Delete</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.modalBtn, themed.modalBtn, styles.cancelBtn, themed.cancelBtn]}
              onPress={onCancel}
            >
              <Text style={[styles.modalBtnTextDark, themed.modalBtnTextDark]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.saveBtn]}
              onPress={handleSaveLocal}
            >
              <Text style={styles.modalBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    borderRadius: 16,
    padding: 24,
    width: '100%',
    ...Shadows.card,
  },
  modalHeaderTitle: {
    fontFamily: Fonts.heading,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    marginBottom: 16,
  },
  modalTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  timeInputCol: {
    width: '48%',
  },
  timeInputLabel: {
    fontSize: 11,
    fontFamily: Fonts.body,
    marginBottom: 6,
  },
  timePickerBtn: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  timePickerBtnText: {
    fontSize: 14,
    fontFamily: Fonts.body,
  },
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  categoryChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    marginHorizontal: 2,
  },
  categoryChipActive: {
    backgroundColor: Colors.red,
    borderColor: Colors.red,
  },
  categoryChipText: {
    fontSize: 11,
    fontFamily: Fonts.body,
  },
  categoryChipTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  colorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  colorBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorBubbleActive: {
    borderColor: '#FFFFFF',
  },
  textArea: {
    height: 60,
    textAlignVertical: 'top',
  },
  sectionLabel: {
    fontFamily: Fonts.heading,
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  recurrenceContainer: {
    marginBottom: 16,
  },
  freqRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  freqBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    marginHorizontal: 1,
  },
  freqBtnActive: {
    backgroundColor: Colors.red,
    borderColor: Colors.red,
  },
  freqBtnText: {
    fontSize: 10,
    fontFamily: Fonts.body,
  },
  freqBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  recurrenceDetails: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    marginTop: 4,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 6,
  },
  detailLabel: {
    fontSize: 12,
    fontFamily: Fonts.body,
    marginRight: 8,
  },
  detailNumberInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    width: 50,
    textAlign: 'center',
    marginRight: 8,
    fontSize: 12,
  },
  weekDaysGrid: {
    flexDirection: 'row',
    flex: 1,
    justifyContent: 'space-between',
  },
  dayBubble: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayBubbleActive: {
    backgroundColor: Colors.red,
    borderColor: Colors.red,
  },
  dayBubbleText: {
    fontSize: 9,
    fontFamily: Fonts.body,
    fontWeight: '600',
  },
  dayBubbleTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  endTypeRow: {
    flexDirection: 'row',
    flex: 1,
    justifyContent: 'space-between',
  },
  endTypeBtn: {
    flex: 1,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    marginHorizontal: 2,
  },
  endTypeBtnActive: {
    backgroundColor: Colors.red,
    borderColor: Colors.red,
  },
  endTypeBtnText: {
    fontSize: 10,
    fontFamily: Fonts.body,
  },
  endTypeBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  dateSelectorBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 6,
    alignItems: 'center',
  },
  dateSelectorBtnText: {
    fontSize: 12,
    fontFamily: Fonts.body,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  modalBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginLeft: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  saveBtn: {
    backgroundColor: Colors.red,
  },
  cancelBtn: {
    borderWidth: 1,
  },
  deleteBtn: {
    backgroundColor: Colors.error,
    marginRight: 'auto',
    marginLeft: 0,
  },
  modalBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontFamily: Fonts.body,
  },
  modalBtnTextDark: {
    fontFamily: Fonts.body,
    fontWeight: 'bold',
  },
});

const getThemedStyles = (colors: ThemeColors, isDarkMode: boolean) => ({
  modalContent: {
    backgroundColor: colors.cardBg,
  },
  modalHeaderTitle: {
    color: colors.textPrimary,
  },
  modalInput: {
    borderColor: colors.border,
    color: colors.textPrimary,
    backgroundColor: colors.inputBg,
  },
  timeInputLabel: {
    color: colors.textSecondary,
  },
  timePickerBtn: {
    borderColor: colors.border,
    backgroundColor: colors.inputBg,
  },
  timePickerBtnText: {
    color: colors.textPrimary,
  },
  categoryChip: {
    borderColor: colors.border,
    backgroundColor: colors.inputBg,
  },
  categoryChipActive: {
    backgroundColor: Colors.red,
    borderColor: Colors.red,
  },
  categoryChipText: {
    color: colors.textSecondary,
  },
  categoryChipTextActive: {
    color: colors.white,
  },
  colorBubble: {
    borderColor: isDarkMode ? '#121212' : '#E0E0E0',
  },
  colorBubbleActive: {
    borderColor: colors.textPrimary,
  },
  modalBtn: {
    backgroundColor: colors.inputBg,
  },
  cancelBtn: {
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  modalBtnTextDark: {
    color: colors.textPrimary,
  },
  sectionLabel: {
    color: colors.textSecondary,
  },
  freqBtn: {
    borderColor: colors.border,
    backgroundColor: colors.inputBg,
  },
  freqBtnActive: {
    backgroundColor: Colors.red,
    borderColor: Colors.red,
  },
  freqBtnText: {
    color: colors.textSecondary,
  },
  freqBtnTextActive: {
    color: colors.white,
  },
  recurrenceDetails: {
    borderColor: colors.border,
    backgroundColor: colors.cardBg,
  },
  detailLabel: {
    color: colors.textPrimary,
  },
  detailInput: {
    borderColor: colors.border,
    color: colors.textPrimary,
    backgroundColor: colors.inputBg,
  },
  dayBubble: {
    borderColor: colors.border,
    backgroundColor: colors.inputBg,
  },
  dayBubbleText: {
    color: colors.textSecondary,
  },
  dayBubbleTextActive: {
    color: colors.white,
  },
  endTypeBtn: {
    borderColor: colors.border,
    backgroundColor: colors.inputBg,
  },
  endTypeBtnText: {
    color: colors.textSecondary,
  },
  endTypeBtnTextActive: {
    color: colors.white,
  },
  dateSelectorBtnText: {
    color: colors.textPrimary,
  },
});
