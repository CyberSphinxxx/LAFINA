import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import type { Task, Event } from '../../../../storage';
import { tasksStore, remindersStore } from '../../../../storage';
import { ScheduleItemForm, ScheduleItemModalState } from '../types';
import { generateId } from '../../../../utils';
import { getReminderPreferences, scheduleReminderAlarm } from '../../../../scheduler';

interface UseScheduleItemModalOptions {
  userId: string;
  selectedDate: Date;
  onSaved: () => void;
  onRefresh: () => void;
}

const defaultForm = (): ScheduleItemForm => ({
  title: '',
  time: '12:00',
  endTime: '13:00',
  priority: 'Medium',
  category: 'Work',
  location: '',
  notes: '',
  recurrenceRule: null,
});

type Priority = 'High' | 'Medium' | 'Low';

export const useScheduleItemModal = (options: UseScheduleItemModalOptions): ScheduleItemModalState => {
  const { userId, selectedDate, onSaved, onRefresh } = options;
  const [visible, setVisible] = useState(false);
  const [modalType, setModalType] = useState<'task' | 'event'>('task');
  const [editingItem, setEditingItem] = useState<Task | Event | null>(null);
  const [form, setForm] = useState<ScheduleItemForm>(defaultForm());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);

  const updateField = useCallback(<K extends keyof ScheduleItemForm>(key: K, value: ScheduleItemForm[K]) => {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      if (key === 'time') {
        const startStr = value as string;
        const [h, m] = startStr.split(':').map(Number);
        const date = new Date();
        date.setHours(isNaN(h) ? 0 : h, isNaN(m) ? 0 : m, 0, 0);
        date.setHours(date.getHours() + 1);
        const nextH = date.getHours().toString().padStart(2, '0');
        const nextM = date.getMinutes().toString().padStart(2, '0');
        next.endTime = `${nextH}:${nextM}`;
      }
      return next;
    });
  }, []);

  const openNew = useCallback((type: 'task' | 'event') => {
    setModalType(type);
    setEditingItem(null);
    setForm(defaultForm());
    setVisible(true);
  }, []);

  const openEdit = useCallback((item: Task | Event, type: 'task' | 'event') => {
    setModalType(type);
    setEditingItem(item);
    setForm({
      title: item.title,
      time: type === 'task' ? (item as Task).dueTime || '12:00' : (item as Event).startTime,
      endTime: type === 'event' ? (item as Event).endTime : '13:00',
      priority: type === 'task' ? (item as Task).priority || 'Medium' : 'Medium',
      category: type === 'task' ? (item as Task).category || 'Work' : 'Work',
      location: type === 'event' ? (item as Event).location || '' : '',
      notes: type === 'task' ? (item as Task).notes || '' : '',
      recurrenceRule: item.recurrenceRule || null,
    });
    setVisible(true);
  }, []);

  const close = useCallback(() => setVisible(false), []);

  const save = useCallback((recurrenceRule?: string | null) => {
    if (!form.title.trim()) {
      Alert.alert('Error', 'Please enter a title.');
      return;
    }
    if (modalType === 'event' && form.time > form.endTime) {
      Alert.alert('Invalid Time Range', 'Start time cannot be after end time.');
      return;
    }

    const dateStr = selectedDate.toISOString().split('T')[0];
    const rule = recurrenceRule !== undefined ? recurrenceRule : (form.recurrenceRule || null);

    const syncReminder = (title: string, date: string, time: string) => {
      try {
        const prefs = getReminderPreferences(userId);
        const leadTimeMinutes = prefs.leadTimeMinutes;
        const localScheduledDate = new Date(`${date}T${time}:00`);
        if (isNaN(localScheduledDate.getTime())) return;

        const scheduledAt = localScheduledDate.toISOString();
        const preferredTriggerMs =
          localScheduledDate.getTime() - leadTimeMinutes * 60 * 1000;
        const triggerAt = new Date(
          Math.max(preferredTriggerMs, Date.now() + 1000),
        ).toISOString();

        const reminderId = generateId('rem');
        remindersStore.insertReminder({
          id: reminderId,
          userId,
          task: title,
          description: 'Scheduled reminder',
          scheduledAt,
          triggerAt,
          status: 'pending',
          preCastAudioPath: null,
        });

        void scheduleReminderAlarm(reminderId, title, triggerAt).catch((err) => {
          console.error('[Calendar] Failed to schedule reminder alarm:', err);
        });
      } catch (err) {
        console.error('[Calendar] Failed to create auto-reminder:', err);
      }
    };

    if (modalType === 'task') {
      if (editingItem) {
        tasksStore.updateTask({
          id: editingItem.id,
          title: form.title,
          dueTime: form.time,
          priority: form.priority as Priority,
          category: form.category,
          notes: form.notes,
          recurrenceRule: rule,
        });
        syncReminder(form.title, dateStr, form.time);
      } else {
        const taskId = generateId('task');
        tasksStore.insertTask({
          id: taskId,
          userId,
          title: form.title,
          dueDate: dateStr,
          dueTime: form.time,
          isCompleted: false,
          priority: form.priority as Priority,
          category: form.category,
          notes: form.notes,
          recurrenceRule: rule,
        });
        syncReminder(form.title, dateStr, form.time);
      }
    } else {
      if (editingItem) {
        tasksStore.updateEvent({
          id: editingItem.id,
          title: form.title,
          date: dateStr,
          startTime: form.time,
          endTime: form.endTime,
          location: form.location,
          recurrenceRule: rule,
        });
        syncReminder(form.title, dateStr, form.time);
      } else {
        const eventId = generateId('event');
        tasksStore.insertEvent({
          id: eventId,
          userId,
          title: form.title,
          date: dateStr,
          startTime: form.time,
          endTime: form.endTime,
          location: form.location,
          recurrenceRule: rule,
        });
        syncReminder(form.title, dateStr, form.time);
      }
    }

    setVisible(false);
    onSaved();
    onRefresh();
  }, [form, modalType, editingItem, selectedDate, userId, onSaved, onRefresh]);

  const handleDelete = useCallback((id: string, type: 'task' | 'event') => {
    Alert.alert(`Delete ${type === 'task' ? 'Task' : 'Event'}`, `Are you sure?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (type === 'task') tasksStore.deleteTask(id);
          else tasksStore.deleteEvent(id);
          setVisible(false);
          onSaved();
          onRefresh();
        },
      },
    ]);
  }, [onSaved, onRefresh]);

  return {
    visible,
    modalType,
    editingItem,
    form,
    showTimePicker,
    showEndTimePicker,
    openNew,
    openEdit,
    close,
    updateField,
    save,
    delete: handleDelete,
    setShowTimePicker,
    setShowEndTimePicker,
  };
};
