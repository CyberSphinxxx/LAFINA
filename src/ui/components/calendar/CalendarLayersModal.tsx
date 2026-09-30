import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TouchableWithoutFeedback,
} from 'react-native';
import { Check, X, Trash2 } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { Fonts, Colors, Shadows } from '../../theme';
import { ImportBatch } from '../../../storage/importedBatchesStore';
import { HOLIDAY_CALENDAR_ID, HOLIDAY_CALENDAR_NAME } from '../../screens/calendar/utils/philippineHolidays';

interface CalendarLayersModalProps {
  visible: boolean;
  onClose: () => void;
  username: string;
  batches: ImportBatch[];
  visibilityMap: Record<string, boolean>;
  onToggleVisibility: (calendarId: string, isVisible: boolean) => void;
  onRemoveBatch: (batch: ImportBatch) => void;
}

/**
 * Bottom-sheet style modal to view and toggle calendar visibility layers,
 * similar to Google Calendar's "My Calendars" panel.
 */
export const CalendarLayersModal: React.FC<CalendarLayersModalProps> = ({
  visible,
  onClose,
  username,
  batches,
  visibilityMap,
  onToggleVisibility,
  onRemoveBatch,
}) => {
  const { colors } = useTheme();
  
  const mainVisible = visibilityMap.main !== false;
  const holidaysVisible = visibilityMap[HOLIDAY_CALENDAR_ID] !== false;

  /**
   * Generates a stable color from the calendar filename to display next to the checkbox.
   */
  const getHashColor = (str: string): string => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colorsList = [
      '#F44336', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5', 
      '#2196F3', '#03A9F4', '#00BCD4', '#009688', '#4CAF50', 
      '#8BC34A', '#FF9800', '#FF5722', '#795548'
    ];
    const index = Math.abs(hash) % colorsList.length;
    return colorsList[index];
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={[styles.sheet, { backgroundColor: colors.cardBg }]}>
              {/* Header */}
              <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>My Calendars</Text>
                <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                  <X size={20} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
                {/* Primary Calendar */}
                <TouchableOpacity
                  style={[styles.item, { borderBottomColor: colors.border }]}
                  activeOpacity={0.7}
                  onPress={() => onToggleVisibility('main', !mainVisible)}
                >
                  <View style={[
                    styles.checkbox,
                    { borderColor: Colors.blue },
                    mainVisible && { backgroundColor: Colors.blue }
                  ]}>
                    {mainVisible && <Check size={12} color="#FFFFFF" strokeWidth={3} />}
                  </View>
                  <View style={styles.textContainer}>
                    <Text style={[styles.itemTitle, { color: colors.textPrimary }]}>
                      {username || 'Main Calendar'}
                    </Text>
                    <Text style={[styles.itemSub, { color: colors.textSecondary }]}>Primary Schedule</Text>
                  </View>
                </TouchableOpacity>

                {/* Built in, like Google Calendar's holiday layer: nothing to import */}
                <TouchableOpacity
                  style={[styles.item, { borderBottomColor: colors.border }]}
                  activeOpacity={0.7}
                  onPress={() => onToggleVisibility(HOLIDAY_CALENDAR_ID, !holidaysVisible)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: holidaysVisible }}
                  accessibilityLabel={HOLIDAY_CALENDAR_NAME}
                >
                  <View style={[
                    styles.checkbox,
                    { borderColor: colors.holiday },
                    holidaysVisible && { backgroundColor: colors.holiday }
                  ]}>
                    {holidaysVisible && <Check size={12} color={colors.white} strokeWidth={3} />}
                  </View>
                  <View style={styles.textContainer}>
                    <Text style={[styles.itemTitle, { color: colors.textPrimary }]}>{HOLIDAY_CALENDAR_NAME}</Text>
                    <Text style={[styles.itemSub, { color: colors.textSecondary }]}>Regular and special non-working days</Text>
                  </View>
                </TouchableOpacity>

                {/* Imported Calendars */}
                {batches.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                      No imported calendars. Use the upload button on the calendar screen to import .ics files.
                    </Text>
                  </View>
                ) : (
                  batches.map((batch) => {
                    const batchVisible = visibilityMap[batch.id] !== false;
                    const color = getHashColor(batch.fileName);
                    const dateStr = new Date(batch.timestamp).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    });

                    return (
                      <View
                        key={batch.id}
                        style={[styles.item, { borderBottomColor: colors.border }]}
                      >
                        <TouchableOpacity
                          style={styles.itemContent}
                          activeOpacity={0.7}
                          onPress={() => onToggleVisibility(batch.id, !batchVisible)}
                        >
                          <View style={[
                            styles.checkbox,
                            { borderColor: color },
                            batchVisible && { backgroundColor: color }
                          ]}>
                            {batchVisible && <Check size={12} color="#FFFFFF" strokeWidth={3} />}
                          </View>
                          <View style={styles.textContainer}>
                            <Text style={[styles.itemTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                              {batch.fileName}
                            </Text>
                            <Text style={[styles.itemSub, { color: colors.textSecondary }]}>
                              Imported {dateStr} • {batch.events.length + batch.blocks.length + batch.tasks.length} items
                            </Text>
                          </View>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.deleteButton}
                          activeOpacity={0.7}
                          onPress={() => onRemoveBatch(batch)}
                          accessibilityLabel="Delete Imported Calendar"
                        >
                          <Trash2 size={18} color={colors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    minHeight: '40%',
    maxHeight: '75%',
    paddingBottom: 24,
    ...Shadows.card,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontFamily: Fonts.heading,
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 4,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  itemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  deleteButton: {
    padding: 8,
    marginLeft: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  textContainer: {
    flex: 1,
  },
  itemTitle: {
    fontFamily: Fonts.body,
    fontSize: 15,
    fontWeight: '600',
  },
  itemSub: {
    fontFamily: Fonts.body,
    fontSize: 12,
    marginTop: 2,
  },
  emptyContainer: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
