import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Fonts, Layout, Shadows, useThemedStyles } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { BookOpen, Clock, Activity, Award } from 'lucide-react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { LongestClassGap, SnoozeTendency, StudyPeakHour, WeeklyClassCount } from '../../../storage';

interface OnboardingStepProps {
  step: number;
  wakeTime: string;
  setWakeTime: (val: string) => void;
  sleepTime: string;
  setSleepTime: (val: string) => void;
  studyPeak: StudyPeakHour[];
  toggleStudyPeak: (val: StudyPeakHour) => void;
  busiestDay: string;
  setBusiestDay: (val: string) => void;
  reminderLead: string;
  setReminderLead: (val: string) => void;
  snoozeTendency: SnoozeTendency;
  setSnoozeTendency: (val: SnoozeTendency) => void;
  classCount: WeeklyClassCount;
  setClassCount: (val: WeeklyClassCount) => void;
  longestGap: LongestClassGap;
  setLongestGap: (val: LongestClassGap) => void;
}

const studyPeakOptions: { label: string; value: StudyPeakHour }[] = [
  { label: 'Morning (6-10 AM)', value: 'morning' },
  { label: 'Late Morning (10 AM-12 PM)', value: 'late_morning' },
  { label: 'Afternoon (12-4 PM)', value: 'afternoon' },
  { label: 'Evening (4-8 PM)', value: 'evening' },
  { label: 'Night (8 PM-12 AM)', value: 'night' },
];

const busiestDayOptions = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const reminderLeadOptions = [
  { label: 'On the dot', value: '0' },
  { label: '15 min before', value: '15' },
  { label: '30 min before', value: '30' },
  { label: '1 hour before', value: '60' },
];

const snoozeTendencyOptions: { label: string; value: SnoozeTendency }[] = [
  { label: 'Do it right away', value: 'immediate' },
  { label: 'Snooze once', value: 'snooze_once' },
  { label: 'Snooze multiple times', value: 'snooze_multiple' },
  { label: 'Often ignore', value: 'ignore' },
];

const classCountOptions: WeeklyClassCount[] = ['1-3', '4-6', '7+'];
const longestGapOptions: LongestClassGap[] = ['None', '30 min', '1 hour', '2+ hours'];

const wakeTimeOptions = ['05:00', '06:00', '07:00', '08:00', '09:00'];
const sleepTimeOptions = ['21:00', '22:00', '23:00', '00:00', '01:00'];

export const OnboardingStep: React.FC<OnboardingStepProps> = ({
  step,
  wakeTime,
  setWakeTime,
  sleepTime,
  setSleepTime,
  studyPeak,
  toggleStudyPeak,
  busiestDay,
  setBusiestDay,
  reminderLead,
  setReminderLead,
  snoozeTendency,
  setSnoozeTendency,
  classCount,
  setClassCount,
  longestGap,
  setLongestGap,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);

  const [showWakePicker, setShowWakePicker] = useState(false);
  const [showSleepPicker, setShowSleepPicker] = useState(false);

  const formatTo12Hour = (time24: string): string => {
    if (!time24) return '';
    const parts = time24.split(':');
    if (parts.length < 2) return time24;
    const hour = parseInt(parts[0], 10);
    const minStr = parts[1];
    if (isNaN(hour)) return time24;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    return `${displayHour}:${minStr} ${ampm}`;
  };

  const getTimeDate = (timeStr: string): Date => {
    const [hours, minutes] = timeStr.split(':').map((s) => parseInt(s, 10));
    const d = new Date();
    d.setHours(hours);
    d.setMinutes(minutes);
    d.setSeconds(0);
    return d;
  };

  const isWakeCustom = !wakeTimeOptions.includes(wakeTime);
  const isSleepCustom = !sleepTimeOptions.includes(sleepTime);

  switch (step) {
    case 1:
      return (
        <View>
          <View style={styles.iconHeaderContainer}>
            <Clock size={40} color={Colors.blue} />
          </View>
          <Text style={[styles.stepTitle, themed.stepTitle]}>Daily Routine</Text>
          <Text style={[styles.stepDesc, themed.stepDesc]}>When does your day usually begin and end?</Text>

          <Text style={[styles.inputLabel, themed.inputLabel]}>Typical Wake-Up Time</Text>
          <View style={styles.chipContainer}>
            {wakeTimeOptions.map((time) => (
              <TouchableOpacity
                key={time}
                style={[
                  styles.chip,
                  themed.chip,
                  wakeTime === time && styles.activeChip,
                ]}
                onPress={() => setWakeTime(time)}
              >
                <Text style={[styles.chipText, themed.chipText, wakeTime === time && styles.activeChipText]}>
                  {formatTo12Hour(time)}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[
                styles.chip,
                themed.chip,
                isWakeCustom && styles.activeChip,
              ]}
              onPress={() => setShowWakePicker(true)}
            >
              <Text style={[styles.chipText, themed.chipText, isWakeCustom && styles.activeChipText]}>
                {isWakeCustom ? `Custom: ${formatTo12Hour(wakeTime)}` : 'Custom...'}
              </Text>
            </TouchableOpacity>
          </View>

          {showWakePicker && (
            <DateTimePicker
              value={getTimeDate(wakeTime)}
              mode="time"
              display="default"
              is24Hour={false}
              onChange={(_event: DateTimePickerEvent, date?: Date) => {
                setShowWakePicker(false);
                if (date) {
                  const hours = date.getHours().toString().padStart(2, '0');
                  const minutes = date.getMinutes().toString().padStart(2, '0');
                  setWakeTime(`${hours}:${minutes}`);
                }
              }}
            />
          )}

          <Text style={[styles.inputLabel, themed.inputLabel]}>Typical Sleep Time</Text>
          <View style={styles.chipContainer}>
            {sleepTimeOptions.map((time) => (
              <TouchableOpacity
                key={time}
                style={[
                  styles.chip,
                  themed.chip,
                  sleepTime === time && styles.activeChip,
                ]}
                onPress={() => setSleepTime(time)}
              >
                <Text style={[styles.chipText, themed.chipText, sleepTime === time && styles.activeChipText]}>
                  {formatTo12Hour(time)}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[
                styles.chip,
                themed.chip,
                isSleepCustom && styles.activeChip,
              ]}
              onPress={() => setShowSleepPicker(true)}
            >
              <Text style={[styles.chipText, themed.chipText, isSleepCustom && styles.activeChipText]}>
                {isSleepCustom ? `Custom: ${formatTo12Hour(sleepTime)}` : 'Custom...'}
              </Text>
            </TouchableOpacity>
          </View>

          {showSleepPicker && (
            <DateTimePicker
              value={getTimeDate(sleepTime)}
              mode="time"
              display="default"
              is24Hour={false}
              onChange={(_event: DateTimePickerEvent, date?: Date) => {
                setShowSleepPicker(false);
                if (date) {
                  const hours = date.getHours().toString().padStart(2, '0');
                  const minutes = date.getMinutes().toString().padStart(2, '0');
                  setSleepTime(`${hours}:${minutes}`);
                }
              }}
            />
          )}
        </View>
      );
    case 2:
      return (
        <View>
          <View style={styles.iconHeaderContainer}>
            <BookOpen size={40} color={Colors.blue} />
          </View>
          <Text style={[styles.stepTitle, themed.stepTitle]}>Study Habits</Text>
          <Text style={[styles.stepDesc, themed.stepDesc]}>Tell us when you feel most productive studying.</Text>

          <Text style={[styles.inputLabel, themed.inputLabel]}>Peak Study Hours (Select multiple)</Text>
          <View style={styles.chipContainer}>
            {studyPeakOptions.map((option) => {
              const isSelected = studyPeak.includes(option.value);
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.chip,
                    themed.chip,
                    isSelected && styles.activeChip,
                  ]}
                  onPress={() => toggleStudyPeak(option.value)}
                >
                  <Text style={[styles.chipText, themed.chipText, isSelected && styles.activeChipText]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.inputLabel, themed.inputLabel]}>Your Busiest Weekday</Text>
          <View style={styles.chipContainer}>
            {busiestDayOptions.map((day) => (
              <TouchableOpacity
                key={day}
                style={[
                  styles.chip,
                  themed.chip,
                  busiestDay === day && styles.activeChip,
                ]}
                onPress={() => setBusiestDay(day)}
              >
                <Text style={[styles.chipText, themed.chipText, busiestDay === day && styles.activeChipText]}>
                  {day}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
    case 3:
      return (
        <View>
          <View style={styles.iconHeaderContainer}>
            <Activity size={40} color={Colors.blue} />
          </View>
          <Text style={[styles.stepTitle, themed.stepTitle]}>Task Reminders</Text>
          <Text style={[styles.stepDesc, themed.stepDesc]}>How do you react to task notifications?</Text>

          <Text style={[styles.inputLabel, themed.inputLabel]}>Reminder Lead Time</Text>
          <View style={styles.chipContainer}>
            {reminderLeadOptions.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.chip,
                  themed.chip,
                  reminderLead === opt.value && styles.activeChip,
                ]}
                onPress={() => setReminderLead(opt.value)}
              >
                <Text style={[styles.chipText, themed.chipText, reminderLead === opt.value && styles.activeChipText]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.inputLabel, themed.inputLabel]}>How do you handle call alarms?</Text>
          <View style={styles.chipContainer}>
            {snoozeTendencyOptions.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.chip,
                  themed.chip,
                  snoozeTendency === opt.value && styles.activeChip,
                ]}
                onPress={() => setSnoozeTendency(opt.value)}
              >
                <Text style={[styles.chipText, themed.chipText, snoozeTendency === opt.value && styles.activeChipText]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
    case 4:
      return (
        <View>
          <View style={styles.iconHeaderContainer}>
            <Award size={40} color={Colors.blue} />
          </View>
          <Text style={[styles.stepTitle, themed.stepTitle]}>Academic Load</Text>
          <Text style={[styles.stepDesc, themed.stepDesc]}>Help us optimize schedule gaps for task creation.</Text>

          <Text style={[styles.inputLabel, themed.inputLabel]}>Weekly Class Load</Text>
          <View style={styles.chipContainer}>
            {classCountOptions.map((load) => (
              <TouchableOpacity
                key={load}
                style={[
                  styles.chip,
                  themed.chip,
                  classCount === load && styles.activeChip,
                ]}
                onPress={() => setClassCount(load)}
              >
                <Text style={[styles.chipText, themed.chipText, classCount === load && styles.activeChipText]}>
                  {load} Classes
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.inputLabel, themed.inputLabel]}>Longest Class Gap</Text>
          <View style={styles.chipContainer}>
            {longestGapOptions.map((gap) => (
              <TouchableOpacity
                key={gap}
                style={[
                  styles.chip,
                  themed.chip,
                  longestGap === gap && styles.activeChip,
                ]}
                onPress={() => setLongestGap(gap)}
              >
                <Text style={[styles.chipText, themed.chipText, longestGap === gap && styles.activeChipText]}>
                  {gap}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
    case 5:
      return (
        <View style={styles.finishContainer}>
          <View style={[styles.iconCircle, themed.iconCircle, Shadows.card]}>
            <Award size={50} color={colors.success} />
          </View>
          <Text style={[styles.stepTitle, themed.stepTitle]}>Ready to Sync</Text>
          <Text style={[styles.stepDesc, themed.stepDesc]}>
            We've created a baseline configuration. LAFINA will now learn from your daily schedule choices, phone call reminder responses, and voice scheduler tasks to offer adaptive scheduling.
          </Text>

          <View style={[styles.summaryCard, themed.summaryCard]}>
            <Text style={[styles.summaryTitle, themed.summaryTitle]}>Configuration Baseline</Text>
            <Text style={[styles.summaryItem, themed.summaryItem]}>• Sleep Cycle: {formatTo12Hour(wakeTime)} - {formatTo12Hour(sleepTime)}</Text>
            <Text style={[styles.summaryItem, themed.summaryItem]}>• Study Preference: {studyPeak.length > 0 ? studyPeak.join(', ') : 'Flexible'}</Text>
            <Text style={[styles.summaryItem, themed.summaryItem]}>• Reminder Lead: {reminderLead} minutes</Text>
            <Text style={[styles.summaryItem, themed.summaryItem]}>• Class Gap Slots: {longestGap}</Text>
          </View>
        </View>
      );
    default:
      return null;
  }
};

const styles = StyleSheet.create({
  iconHeaderContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  stepTitle: {
    fontFamily: Fonts.heading,
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  stepDesc: {
    fontFamily: Fonts.body,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 24,
    lineHeight: 20,
  },
  inputLabel: {
    fontFamily: Fonts.body,
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 14,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  chip: {
    borderWidth: 1.5,
    borderRadius: Layout.borderRadiusPill,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  activeChip: {
    backgroundColor: Colors.blue,
    borderColor: Colors.blue,
  },
  chipText: {
    fontFamily: Fonts.body,
    fontSize: 13,
  },
  activeChipText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  finishContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  summaryCard: {
    borderWidth: 1.5,
    borderRadius: Layout.borderRadiusCard,
    padding: 16,
    width: '100%',
    marginTop: 8,
  },
  summaryTitle: {
    fontFamily: Fonts.heading,
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  summaryItem: {
    fontFamily: Fonts.body,
    fontSize: 13,
    marginBottom: 4,
  },
});

const getThemedStyles = (colors: ThemeColors, isDarkMode: boolean) => ({
  stepTitle: {
    color: colors.textPrimary,
  },
  stepDesc: {
    color: colors.textSecondary,
  },
  inputLabel: {
    color: colors.textPrimary,
  },
  chip: {
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
  },
  chipText: {
    color: colors.textPrimary,
  },
  iconCircle: {
    backgroundColor: isDarkMode ? 'rgba(46, 204, 113, 0.15)' : '#E8F8F0',
  },
  summaryCard: {
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
  },
  summaryTitle: {
    color: colors.textPrimary,
  },
  summaryItem: {
    color: colors.textPrimary,
  },
});
