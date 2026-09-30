import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Send, Clock, AlertCircle } from 'lucide-react-native';
import { Fonts, FontSize } from '../../theme';
import { businessChatStore } from '../../../storage/businessChatStore';
import {
  businessChatService,
  businessChatWsManager,
} from '../../../cloud/businessChatService';
import { BusinessTaskCommentRow } from '../../../storage/syncTypes';

interface TaskCommentsThreadProps {
  taskId: string;
  businessId: string;
  currentUserId: string;
  currentUserName?: string;
}

export const TaskCommentsThread: React.FC<TaskCommentsThreadProps> = ({
  taskId,
  businessId,
  currentUserId,
  currentUserName = 'User',
}) => {
  const [comments, setComments] = useState<BusinessTaskCommentRow[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef<FlatList>(null);

  const loadComments = useCallback(async () => {
    try {
      const local = await businessChatStore.getTaskComments(taskId);
      setComments(local);
      setLoading(false);

      // Background delta sync
      const remote = await businessChatService.syncTaskComments(businessId, taskId);
      if (remote && remote.length > 0) {
        setComments(remote);
      }
    } catch {
      setLoading(false);
    }
  }, [taskId, businessId]);

  useEffect(() => {
    loadComments();

    // Subscribe to real-time WebSocket comments
    const unsubscribe = businessChatWsManager.addListener((event) => {
      if (event.type === 'new_comment' && event.comment.task_id === taskId) {
        setComments((prev) => {
          const exists = prev.some(
            (c) =>
              c.client_comment_id === event.comment.client_comment_id ||
              c.id === event.comment.id
          );
          if (exists) {
            return prev.map((c) =>
              c.client_comment_id === event.comment.client_comment_id
                ? event.comment
                : c
            );
          }
          return [...prev, event.comment];
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [taskId, businessId, loadComments]);

  const handleSend = async () => {
    if (!inputText.trim() || sending) return;

    const text = inputText.trim();
    setInputText('');
    setSending(true);

    try {
      const newComment = await businessChatService.sendTaskComment({
        businessId,
        taskId,
        userId: currentUserId,
        userName: currentUserName,
        content: text,
      });

      setComments((prev) => {
        const filtered = prev.filter(
          (c) => c.client_comment_id !== newComment.client_comment_id
        );
        return [...filtered, newComment];
      });

      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (err) {
      console.warn('Failed to send task comment:', err);
    } finally {
      setSending(false);
    }
  };

  const renderComment = ({ item }: { item: BusinessTaskCommentRow }) => {
    const isMe = item.user_id === currentUserId;
    const authorName = item.user_name || (isMe ? 'You' : 'Member');
    const initials = authorName.slice(0, 2).toUpperCase();

    const timeFormatted = item.created_at
      ? new Date(item.created_at).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';

    return (
      <View style={[styles.commentRow, isMe && styles.commentRowMe]}>
        {!isMe && (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        )}

        <View style={[styles.commentBubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
          <View style={styles.bubbleHeader}>
            <Text style={[styles.authorText, isMe && styles.authorTextMe]}>
              {authorName}
            </Text>
            <Text style={styles.timeText}>{timeFormatted}</Text>
          </View>
          <Text style={[styles.commentContent, isMe && styles.contentMe]}>
            {item.content}
          </Text>

          {item.delivery_status === 'pending' && (
            <View style={styles.statusRow}>
              <Clock size={11} color="#9CA3AF" />
              <Text style={styles.statusText}>Sending...</Text>
            </View>
          )}

          {item.delivery_status === 'failed' && (
            <View style={styles.statusRow}>
              <AlertCircle size={11} color="#EF4444" />
              <Text style={[styles.statusText, { color: '#EF4444' }]}>Failed to send</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionHeader}>Comments & Feedback</Text>

      {loading ? (
        <ActivityIndicator size="small" color="#2563EB" style={styles.loader} />
      ) : (
        <FlatList
          ref={flatListRef}
          data={comments}
          keyExtractor={(item) => item.client_comment_id || item.id}
          renderItem={renderComment}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No comments yet. Start the conversation!</Text>
          }
          nestedScrollEnabled
        />
      )}

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Add a comment or update..."
          placeholderTextColor="#9CA3AF"
          value={inputText}
          onChangeText={setInputText}
          multiline
          maxLength={1000}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!inputText.trim() || sending) && styles.sendDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim() || sending}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Send size={18} color="#FFFFFF" />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  sectionHeader: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.bodyLarge,
    color: '#111827',
    marginBottom: 10,
  },
  loader: {
    marginVertical: 14,
  },
  listContent: {
    paddingVertical: 6,
    gap: 10,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  commentRowMe: {
    justifyContent: 'flex-end',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontFamily: Fonts.heading,
    fontSize: 10,
  },
  commentBubble: {
    maxWidth: '82%',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleOther: {
    backgroundColor: '#F3F4F6',
    borderBottomLeftRadius: 3,
  },
  bubbleMe: {
    backgroundColor: '#2563EB',
    borderBottomRightRadius: 3,
    alignSelf: 'flex-end',
  },
  bubbleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 3,
  },
  authorText: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.small,
    color: '#374151',
  },
  authorTextMe: {
    color: '#E0E7FF',
  },
  timeText: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: '#9CA3AF',
  },
  commentContent: {
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
    color: '#1F2937',
    lineHeight: 18,
  },
  contentMe: {
    color: '#FFFFFF',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  statusText: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: '#9CA3AF',
  },
  emptyText: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
    color: '#9CA3AF',
    fontStyle: 'italic',
    textAlign: 'center',
    marginVertical: 10,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginTop: 10,
  },
  input: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
    color: '#111827',
    maxHeight: 90,
  },
  sendButton: {
    backgroundColor: '#2563EB',
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {
    backgroundColor: '#9CA3AF',
  },
});
