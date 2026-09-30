import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
} from 'react-native';
import {
  Send,
  Paperclip,
  X,
  ClipboardList,
  CheckCircle2,
  Clock,
  AlertCircle,
  Radio,
  Bot,
} from 'lucide-react-native';
import { Fonts, FontSize } from '../../theme';
import { userStore } from '../../../storage/userStore';
import { businessStore } from '../../../storage/businessStore';
import { businessChatStore } from '../../../storage/businessChatStore';
import { businessTasksStore } from '../../../storage/businessTasksStore';
import {
  businessChatService,
  businessChatWsManager,
  WsConnectionStatus,
} from '../../../cloud/businessChatService';
import {
  BusinessChatMessageRow,
  BusinessTaskWithAssignments,
} from '../../../storage/syncTypes';

interface CompanyChatScreenProps {
  userId: string;
  onOpenTask?: (taskId: string) => void;
  onSwitchToAiAssistant?: () => void;
}

export const CompanyChatScreen: React.FC<CompanyChatScreenProps> = ({
  userId,
  onOpenTask,
  onSwitchToAiAssistant,
}) => {
  const [businessId, setBusinessId] = useState<string>('');
  const [businessName, setBusinessName] = useState<string>('Company');
  const [channelId, setChannelId] = useState<string>('');
  const [channelName, setChannelName] = useState<string>('general');
  const [userName, setUserName] = useState<string>('Me');

  const [messages, setMessages] = useState<BusinessChatMessageRow[]>([]);
  const [inputText, setInputText] = useState('');
  const [selectedTask, setSelectedTask] = useState<{ id: string; title: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<WsConnectionStatus>('disconnected');

  // Task picker modal state
  const [taskPickerVisible, setTaskPickerVisible] = useState(false);
  const [availableTasks, setAvailableTasks] = useState<BusinessTaskWithAssignments[]>([]);

  const flatListRef = useRef<FlatList>(null);

  // Initialize context & channel
  useEffect(() => {
    const initChat = async () => {
      const user = userStore.getUserById(userId);
      if (user) {
        setUserName(user.username || user.email || 'User');
      }

      const biz = businessStore.getBusinessForUser(userId);
      if (!biz) {
        setLoading(false);
        return;
      }

      setBusinessId(biz.id);
      setBusinessName(biz.name);

      const defaultChan = await businessChatStore.ensureDefaultChannel(biz.id);
      setChannelId(defaultChan.id);
      setChannelName(defaultChan.name);

      // Load local cached messages
      const localMsgs = await businessChatStore.getMessages(biz.id, defaultChan.id);
      setMessages(localMsgs);
      setLoading(false);

      // Connect WebSocket manager
      businessChatWsManager.connect(biz.id);
      setConnectionStatus(businessChatWsManager.getStatus());

      // Background delta catch-up
      try {
        const delta = await businessChatService.syncChannelMessages(biz.id, defaultChan.id);
        if (delta && delta.length > 0) {
          setMessages(delta);
        }
      } catch (err) {
        console.warn('Chat delta sync note:', err);
      }
    };

    initChat();
  }, [userId]);

  // Subscribe to real-time events
  useEffect(() => {
    const unsubscribe = businessChatWsManager.addListener((event) => {
      if (event.type === 'connection_change') {
        setConnectionStatus(event.status);
      } else if (event.type === 'new_message') {
        setMessages((prev) => {
          const exists = prev.some(
            (m) =>
              m.client_message_id === event.message.client_message_id ||
              m.id === event.message.id
          );
          if (exists) {
            return prev.map((m) =>
              m.client_message_id === event.message.client_message_id
                ? event.message
                : m
            );
          }
          return [...prev, event.message];
        });
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const openTaskPicker = useCallback(() => {
    if (!businessId) return;
    const tasks = businessTasksStore.getTasksForBusiness(businessId);
    setAvailableTasks(tasks.filter((t) => !t.is_cancelled && !t.deleted_at));
    setTaskPickerVisible(true);
  }, [businessId]);

  const handleSendMessage = async () => {
    if (!inputText.trim() || sending || !businessId || !channelId) return;

    const content = inputText.trim();
    const taskLink = selectedTask;
    setInputText('');
    setSelectedTask(null);
    setSending(true);

    try {
      const newMsg = await businessChatService.sendMessage({
        businessId,
        channelId,
        senderId: userId,
        senderName: userName,
        content,
        taskLinkId: taskLink?.id,
        taskTitle: taskLink?.title,
      });

      setMessages((prev) => {
        const filtered = prev.filter(
          (m) => m.client_message_id !== newMsg.client_message_id
        );
        return [...filtered, newMsg];
      });

      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (err) {
      console.warn('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };

  const renderConnectionBadge = () => {
    switch (connectionStatus) {
      case 'connected':
        return (
          <View style={[styles.badge, { backgroundColor: '#DCFCE7' }]}>
            <Radio size={10} color="#16A34A" />
            <Text style={[styles.badgeText, { color: '#16A34A' }]}>Live</Text>
          </View>
        );
      case 'connecting':
        return (
          <View style={[styles.badge, { backgroundColor: '#FEF3C7' }]}>
            <Radio size={10} color="#D97706" />
            <Text style={[styles.badgeText, { color: '#D97706' }]}>Connecting...</Text>
          </View>
        );
      case 'offline':
      default:
        return (
          <View style={[styles.badge, { backgroundColor: '#F3F4F6' }]}>
            <Radio size={10} color="#6B7280" />
            <Text style={[styles.badgeText, { color: '#6B7280' }]}>Offline Cache</Text>
          </View>
        );
    }
  };

  const renderMessageItem = ({ item }: { item: BusinessChatMessageRow }) => {
    const isMe = item.sender_id === userId;
    const sender = item.sender_name || (isMe ? 'You' : 'Member');
    const initials = sender.slice(0, 2).toUpperCase();

    const timeFormatted = item.created_at
      ? new Date(item.created_at).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';

    return (
      <View style={[styles.messageRow, isMe && styles.messageRowMe]}>
        {!isMe && (
          <View style={styles.senderAvatar}>
            <Text style={styles.senderAvatarText}>{initials}</Text>
          </View>
        )}

        <View style={[styles.messageBubbleContainer, isMe && styles.containerMe]}>
          <View style={[styles.messageBubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
            <View style={styles.bubbleHeader}>
              <Text style={[styles.senderLabel, isMe && styles.senderLabelMe]}>
                {sender}
              </Text>
              <Text style={styles.timeLabel}>{timeFormatted}</Text>
            </View>

            <Text style={[styles.messageText, isMe && styles.messageTextMe]}>
              {item.content}
            </Text>

            {/* Interactive Task Link Preview Card */}
            {item.task_link_id && (
              <TouchableOpacity
                style={[styles.taskCard, isMe ? styles.taskCardMe : styles.taskCardOther]}
                onPress={() => item.task_link_id && onOpenTask?.(item.task_link_id)}
                activeOpacity={0.7}
              >
                <View style={styles.taskCardHeader}>
                  <ClipboardList size={14} color={isMe ? '#93C5FD' : '#2563EB'} />
                  <Text style={[styles.taskCardTag, isMe && styles.taskCardTagMe]}>
                    TASK ATTACHMENT
                  </Text>
                </View>
                <Text
                  style={[styles.taskCardTitle, isMe && styles.taskCardTitleMe]}
                  numberOfLines={2}
                >
                  {item.task_title || 'View Linked Task'}
                </Text>
                <Text style={[styles.taskCardAction, isMe && styles.taskCardActionMe]}>
                  Tap to view deliverables & comments →
                </Text>
              </TouchableOpacity>
            )}

            {isMe && item.delivery_status === 'pending' && (
              <View style={styles.deliveryStatusRow}>
                <Clock size={10} color="#93C5FD" />
                <Text style={styles.deliveryTextMe}>Sending...</Text>
              </View>
            )}

            {isMe && item.delivery_status === 'failed' && (
              <View style={styles.deliveryStatusRow}>
                <AlertCircle size={10} color="#FCA5A5" />
                <Text style={[styles.deliveryTextMe, { color: '#FCA5A5' }]}>
                  Pending offline
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <View style={styles.channelTitleRow}>
            <Text style={styles.channelHash}>#</Text>
            <Text style={styles.channelName}>{channelName}</Text>
          </View>
          <Text style={styles.businessNameText}>{businessName}</Text>
        </View>

        <View style={styles.headerActions}>
          {renderConnectionBadge()}

          {onSwitchToAiAssistant && (
            <TouchableOpacity
              style={styles.aiButton}
              onPress={onSwitchToAiAssistant}
              accessibilityLabel="Switch to LAFINA AI Voice Assistant"
            >
              <Bot size={16} color="#2563EB" />
              <Text style={styles.aiButtonText}>AI Assistant</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Messages List */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#2563EB" />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.client_message_id || item.id}
          renderItem={renderMessageItem}
          contentContainerStyle={styles.messagesList}
          ListEmptyComponent={
            <View style={styles.emptyMessages}>
              <Text style={styles.emptyMessagesTitle}>Welcome to #{channelName}</Text>
              <Text style={styles.emptyMessagesSubtitle}>
                This is the start of your company's real-time communication channel.
              </Text>
            </View>
          }
        />
      )}

      {/* Task Attachment Chip */}
      {selectedTask && (
        <View style={styles.taskAttachmentChip}>
          <View style={styles.taskAttachmentInfo}>
            <ClipboardList size={16} color="#2563EB" />
            <Text style={styles.taskAttachmentText} numberOfLines={1}>
              Attached: {selectedTask.title}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setSelectedTask(null)}>
            <X size={16} color="#6B7280" />
          </TouchableOpacity>
        </View>
      )}

      {/* Input Bar */}
      <View style={styles.inputBar}>
        <TouchableOpacity
          style={styles.attachButton}
          onPress={openTaskPicker}
          accessibilityLabel="Attach a business task to this message"
        >
          <Paperclip size={20} color="#4B5563" />
        </TouchableOpacity>

        <TextInput
          style={styles.inputField}
          placeholder={`Message #${channelName}...`}
          placeholderTextColor="#9CA3AF"
          value={inputText}
          onChangeText={setInputText}
          multiline
          maxLength={4000}
        />

        <TouchableOpacity
          style={[
            styles.sendBtn,
            (!inputText.trim() || sending) && styles.sendBtnDisabled,
          ]}
          onPress={handleSendMessage}
          disabled={!inputText.trim() || sending}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Send size={18} color="#FFFFFF" />
          )}
        </TouchableOpacity>
      </View>

      {/* Task Link Picker Modal */}
      <Modal
        visible={taskPickerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setTaskPickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Link a Business Task</Text>
              <TouchableOpacity onPress={() => setTaskPickerVisible(false)}>
                <X size={20} color="#374151" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              Select a scheduled task to attach an interactive card to your message.
            </Text>

            <FlatList
              data={availableTasks}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.taskPickerItem}
                  onPress={() => {
                    setSelectedTask({ id: item.id, title: item.title });
                    setTaskPickerVisible(false);
                  }}
                >
                  <ClipboardList size={18} color="#2563EB" />
                  <View style={styles.taskPickerItemTextContainer}>
                    <Text style={styles.taskPickerItemTitle}>{item.title}</Text>
                    <Text style={styles.taskPickerItemPriority}>
                      Priority: {item.priority.toUpperCase()}
                    </Text>
                  </View>
                  <CheckCircle2 size={16} color="#9CA3AF" />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyTasksText}>No active business tasks found.</Text>
              }
              contentContainerStyle={{ paddingVertical: 8 }}
            />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  channelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  channelHash: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.subtitle,
    color: '#6B7280',
  },
  channelName: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.bodyLarge,
    color: '#111827',
  },
  businessNameText: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
    color: '#6B7280',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontFamily: Fonts.heading,
    fontSize: 10,
  },
  aiButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  aiButtonText: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.small,
    color: '#2563EB',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messagesList: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 6,
  },
  messageRowMe: {
    justifyContent: 'flex-end',
  },
  senderAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#6366F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  senderAvatarText: {
    color: '#FFFFFF',
    fontFamily: Fonts.heading,
    fontSize: 11,
  },
  messageBubbleContainer: {
    maxWidth: '80%',
  },
  containerMe: {
    alignItems: 'flex-end',
  },
  messageBubble: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleOther: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderBottomLeftRadius: 2,
  },
  bubbleMe: {
    backgroundColor: '#2563EB',
    borderBottomRightRadius: 2,
  },
  bubbleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  senderLabel: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.small,
    color: '#4B5563',
  },
  senderLabelMe: {
    color: '#DBEAFE',
  },
  timeLabel: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: '#9CA3AF',
  },
  messageText: {
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
    color: '#1F2937',
    lineHeight: 20,
  },
  messageTextMe: {
    color: '#FFFFFF',
  },
  taskCard: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  taskCardOther: {
    backgroundColor: '#F0F7FF',
    borderColor: '#BFDBFE',
  },
  taskCardMe: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  taskCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  taskCardTag: {
    fontFamily: Fonts.heading,
    fontSize: 10,
    color: '#2563EB',
    letterSpacing: 0.5,
  },
  taskCardTagMe: {
    color: '#93C5FD',
  },
  taskCardTitle: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.body,
    color: '#1E3A8A',
  },
  taskCardTitleMe: {
    color: '#FFFFFF',
  },
  taskCardAction: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: '#3B82F6',
    marginTop: 4,
  },
  taskCardActionMe: {
    color: '#BFDBFE',
  },
  deliveryStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  deliveryTextMe: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: '#BFDBFE',
  },
  emptyMessages: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
    paddingHorizontal: 20,
  },
  emptyMessagesTitle: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.bodyLarge,
    color: '#374151',
    marginBottom: 4,
  },
  emptyMessagesSubtitle: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  taskAttachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EFF6FF',
    borderTopWidth: 1,
    borderTopColor: '#BFDBFE',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  taskAttachmentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  taskAttachmentText: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.small,
    color: '#1E40AF',
    flex: 1,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    gap: 8,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputField: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
    color: '#111827',
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#9CA3AF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '75%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  modalTitle: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.bodyLarge,
    color: '#111827',
  },
  modalSubtitle: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
    color: '#6B7280',
    marginBottom: 12,
  },
  taskPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 10,
  },
  taskPickerItemTextContainer: {
    flex: 1,
  },
  taskPickerItemTitle: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.body,
    color: '#111827',
  },
  taskPickerItemPriority: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: '#6B7280',
    marginTop: 2,
  },
  emptyTasksText: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingVertical: 20,
  },
});
