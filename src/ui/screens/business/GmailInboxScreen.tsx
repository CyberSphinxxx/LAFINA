import React, { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { Fonts } from '../../theme';
import { gmailService } from '../../../cloud/gmailService';
import { gmailStore } from '../../../storage/gmailStore';
import type {
  LocalGmailThreadCacheRow,
  LocalGmailDraftRow,
} from '../../../storage/syncTypes';
import { GmailThreadDetailModal } from './GmailThreadDetailModal';
import { GmailComposeModal } from './GmailComposeModal';

interface GmailInboxScreenProps {
  userId: string;
}

export const GmailInboxScreen: React.FC<GmailInboxScreenProps> = ({ userId }) => {
  const { colors } = useTheme();
  const [connecting, setConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [emailAddress, setEmailAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // Search & view mode
  const [searchQuery, setSearchQuery] = useState('');
  const [viewTab, setViewTab] = useState<'threads' | 'drafts'>('threads');

  // Threads & Drafts data
  const [threads, setThreads] = useState<LocalGmailThreadCacheRow[]>([]);
  const [drafts, setDrafts] = useState<LocalGmailDraftRow[]>([]);

  // Modals
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedThreadSubject, setSelectedThreadSubject] = useState<string>('');
  const [composeVisible, setComposeVisible] = useState(false);
  const [editingDraft, setEditingDraft] = useState<LocalGmailDraftRow | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);

  const loadThreads = useCallback(async (query?: string) => {
    try {
      const res = await gmailService.fetchThreads(userId, {
        q: query !== undefined ? query : searchQuery || undefined,
        maxResults: 50,
      });
      setThreads(res.threads);
      setIsOffline(res.isOffline);
    } catch (e) {
      console.warn('Failed to load Gmail threads:', e);
      const cached = gmailStore.getCachedThreads(userId, 50);
      setThreads(cached);
      setIsOffline(true);
    }
  }, [userId, searchQuery]);

  const loadLocalDrafts = useCallback(() => {
    const localDrafts = gmailStore.getLocalDrafts(userId);
    setDrafts(localDrafts);
  }, [userId]);

  const checkConnectionAndLoad = useCallback(async () => {
    try {
      const status = await gmailService.getConnectionStatus(userId);
      setIsConnected(status.connected);
      setEmailAddress(status.email_address || null);

      if (status.connected) {
        await loadThreads();
        loadLocalDrafts();
      } else {
        // Load whatever might be cached locally
        const cached = gmailStore.getCachedThreads(userId, 50);
        setThreads(cached);
        loadLocalDrafts();
      }
    } catch (e) {
      console.warn('Error checking Gmail connection:', e);
      const cached = gmailStore.getCachedThreads(userId, 50);
      setThreads(cached);
      setIsOffline(true);
      loadLocalDrafts();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, loadThreads, loadLocalDrafts]);

  useEffect(() => {
    checkConnectionAndLoad();
  }, [checkConnectionAndLoad]);

  const onRefresh = async () => {
    setRefreshing(true);
    await checkConnectionAndLoad();
  };

  const handleConnectGmail = async () => {
    setConnecting(true);
    try {
      const startData = await gmailService.startConnect();
      if (startData?.auth_url) {
        const supported = await Linking.canOpenURL(startData.auth_url);
        if (supported) {
          await Linking.openURL(startData.auth_url);
        } else {
          Alert.alert('Cannot Open Browser', 'Please enable a web browser to complete Google Sign-In.');
        }
      }
    } catch (e: any) {
      Alert.alert('Connection Error', e.message || 'Could not start Gmail connection.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    setMenuVisible(false);
    Alert.alert(
      'Disconnect Gmail',
      'Are you sure you want to disconnect your Gmail account? Cached messages will be purged locally.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await gmailService.disconnect(userId);
            setIsConnected(false);
            setEmailAddress(null);
            setThreads([]);
            setDrafts([]);
            Alert.alert('Disconnected', 'Gmail account disconnected and cache cleared.');
          },
        },
      ]
    );
  };

  const handleClearCache = () => {
    setMenuVisible(false);
    gmailStore.clearCache(userId);
    setThreads([]);
    Alert.alert('Cache Cleared', 'All locally cached email messages and threads have been cleared.');
  };

  const handleDeleteDraft = (draftId: string) => {
    Alert.alert('Delete Draft', 'Are you sure you want to delete this draft?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          gmailStore.deleteLocalDraft(userId, draftId);
          loadLocalDrafts();
        },
      },
    ]);
  };

  const handleOpenDraft = (draft: LocalGmailDraftRow) => {
    setEditingDraft(draft);
    setComposeVisible(true);
  };

  const renderThreadItem = ({ item }: { item: LocalGmailThreadCacheRow }) => {
    const isUnread = item.unread === 1;

    return (
      <TouchableOpacity
        style={[
          styles.threadCard,
          {
            backgroundColor: colors.cardBg,
            borderColor: colors.border,
          },
        ]}
        onPress={() => {
          setSelectedThreadId(item.thread_id);
          setSelectedThreadSubject(item.subject || '(No Subject)');
        }}
        accessibilityRole="button"
        accessibilityLabel={`Email thread: ${item.subject || 'No Subject'} from ${item.from_address || 'Unknown'}`}
      >
        <View style={styles.threadRow}>
          {isUnread && <View style={styles.unreadDot} />}
          <Text
            style={[
              styles.senderText,
              { color: colors.textPrimary, fontWeight: isUnread ? '700' : '500' },
            ]}
            numberOfLines={1}
          >
            {item.from_address || 'Google Workspace'}
          </Text>
          <Text
            style={[
              styles.dateText,
              { color: colors.textMuted },
            ]}
          >
            {item.date ? item.date.substring(0, 16) : ''}
          </Text>
        </View>

        <View style={styles.subjectRow}>
          <Text
            style={[
              styles.subjectText,
              { color: colors.textPrimary, fontWeight: isUnread ? '700' : '400' },
            ]}
            numberOfLines={1}
          >
            {item.subject || '(No Subject)'}
          </Text>
          {item.has_attachments === 1 && (
            <Text style={styles.attachmentIcon}>📎</Text>
          )}
        </View>

        <Text
          style={[
            styles.snippetText,
            { color: colors.textSecondary },
          ]}
          numberOfLines={2}
        >
          {item.snippet || 'No preview available.'}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderDraftItem = ({ item }: { item: LocalGmailDraftRow }) => {
    return (
      <TouchableOpacity
        style={[
          styles.threadCard,
          {
            backgroundColor: colors.cardBg,
            borderColor: colors.border,
          },
        ]}
        onPress={() => handleOpenDraft(item)}
        accessibilityRole="button"
        accessibilityLabel={`Draft to ${item.to_address || 'Unspecified'}: ${item.subject || 'No subject'}`}
      >
        <View style={styles.threadRow}>
          <Text
            style={[
              styles.senderText,
              { color: '#2563EB', fontWeight: '700' },
            ]}
            numberOfLines={1}
          >
            To: {item.to_address || '(No Recipient)'}
          </Text>
          <TouchableOpacity
            style={styles.deleteDraftBtn}
            onPress={() => handleDeleteDraft(item.id)}
            accessibilityRole="button"
            accessibilityLabel="Delete draft"
          >
            <Text style={styles.deleteDraftText}>🗑</Text>
          </TouchableOpacity>
        </View>

        <Text
          style={[
            styles.subjectText,
            { color: colors.textPrimary, fontWeight: '600' },
          ]}
          numberOfLines={1}
        >
          {item.subject || '(Draft - No Subject)'}
        </Text>

        <Text
          style={[
            styles.snippetText,
            { color: colors.textSecondary },
          ]}
          numberOfLines={2}
        >
          {item.body || '(Empty Draft)'}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background },
      ]}
    >
      {/* Top App Bar */}
      <View
        style={[
          styles.topBar,
          {
            backgroundColor: colors.cardBg,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={styles.titleContainer}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            Gmail Inbox
          </Text>
          {isConnected && emailAddress && (
            <Text
              style={[styles.subtitle, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {emailAddress}
            </Text>
          )}
        </View>

        <View style={styles.topActions}>
          <TouchableOpacity
            style={[styles.actionIconBtn, { borderColor: colors.border }]}
            onPress={() => {
              setEditingDraft(null);
              setComposeVisible(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Compose new email"
          >
            <Text style={styles.actionIconText}>✏️</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionIconBtn, { borderColor: colors.border }]}
            onPress={() => setMenuVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Gmail options menu"
          >
            <Text style={styles.actionIconText}>⋮</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Offline Banner */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            Offline: Showing cached messages (50 max). Sending disabled.
          </Text>
        </View>
      )}

      {/* Not Connected View */}
      {!isConnected && (
        <View
          style={[
            styles.connectCard,
            {
              backgroundColor: colors.cardBg,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={[styles.connectTitle, { color: colors.textPrimary }]}>
            Connect Your Gmail
          </Text>
          <Text style={[styles.connectSubtitle, { color: colors.textSecondary }]}>
            Connect your individual Google account to read, compose, draft, and listen to emails with voice synthesis.
          </Text>
          <TouchableOpacity
            style={styles.connectButton}
            onPress={handleConnectGmail}
            disabled={connecting}
            accessibilityRole="button"
            accessibilityLabel="Connect Gmail Account"
          >
            {connecting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.connectButtonText}>Connect Gmail</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Search Bar */}
      <View style={styles.searchBarContainer}>
        <TextInput
          style={[
            styles.searchInput,
            {
              backgroundColor: colors.cardBg,
              color: colors.textPrimary,
              borderColor: colors.border,
            },
          ]}
          placeholder="Search emails..."
          placeholderTextColor={colors.placeholder}
          value={searchQuery}
          onChangeText={(q) => {
            setSearchQuery(q);
            loadThreads(q);
          }}
          returnKeyType="search"
          onSubmitEditing={() => loadThreads(searchQuery)}
          accessibilityLabel="Search emails"
        />
      </View>

      {/* Segment Tabs */}
      <View style={styles.segmentContainer}>
        <TouchableOpacity
          testID="tab-inbox"
          style={[
            styles.segmentTab,
            viewTab === 'threads' && styles.segmentTabActive,
          ]}
          onPress={() => setViewTab('threads')}
          accessibilityRole="tab"
          accessibilityLabel="Inbox tab"
          accessibilityState={{ selected: viewTab === 'threads' }}
        >
          <Text
            style={[
              styles.segmentTabText,
              viewTab === 'threads' && styles.segmentTabTextActive,
            ]}
          >
            Inbox ({threads.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="tab-drafts"
          style={[
            styles.segmentTab,
            viewTab === 'drafts' && styles.segmentTabActive,
          ]}
          onPress={() => {
            loadLocalDrafts();
            setViewTab('drafts');
          }}
          accessibilityRole="tab"
          accessibilityLabel="Local Drafts tab"
          accessibilityState={{ selected: viewTab === 'drafts' }}
        >
          <Text
            style={[
              styles.segmentTabText,
              viewTab === 'drafts' && styles.segmentTabTextActive,
            ]}
          >
            Local Drafts ({drafts.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Main List */}
      {loading ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={[styles.loaderText, { color: colors.textMuted }]}>
            Fetching emails...
          </Text>
        </View>
      ) : viewTab === 'threads' ? (
        <FlatList
          data={threads}
          keyExtractor={(item) => item.thread_id}
          renderItem={renderThreadItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#2563EB']} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                {isConnected ? 'No emails found.' : 'Connect Gmail above to view your inbox.'}
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={drafts}
          keyExtractor={(item) => item.id}
          renderItem={renderDraftItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#2563EB']} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                No local drafts saved.
              </Text>
            </View>
          }
        />
      )}

      {/* Options Menu Modal */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View
            style={[
              styles.menuCard,
              { backgroundColor: colors.cardBg },
            ]}
          >
            <TouchableOpacity style={styles.menuItem} onPress={handleClearCache}>
              <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>
                🧹 Clear Local Email Cache
              </Text>
            </TouchableOpacity>

            {isConnected && (
              <TouchableOpacity style={styles.menuItem} onPress={handleDisconnect}>
                <Text style={[styles.menuItemText, { color: '#DC2626' }]}>
                  🔌 Disconnect Gmail Account
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.menuItem} onPress={() => setMenuVisible(false)}>
              <Text style={[styles.menuItemText, { color: colors.textMuted }]}>
                ✕ Close Menu
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Thread Detail Modal */}
      {selectedThreadId && (
        <GmailThreadDetailModal
          visible={Boolean(selectedThreadId)}
          userId={userId}
          threadId={selectedThreadId}
          initialSubject={selectedThreadSubject}
          onClose={() => setSelectedThreadId(null)}
        />
      )}

      {/* Compose & Edit Draft Modal */}
      <GmailComposeModal
        visible={composeVisible}
        userId={userId}
        draftId={editingDraft?.id}
        initialTo={editingDraft?.to_address}
        initialCc={editingDraft?.cc_address || ''}
        initialBcc={editingDraft?.bcc_address || ''}
        initialSubject={editingDraft?.subject}
        initialBody={editingDraft?.body}
        threadId={editingDraft?.thread_id || undefined}
        onClose={() => {
          setComposeVisible(false);
          setEditingDraft(null);
        }}
        onSent={() => {
          loadThreads();
          loadLocalDrafts();
        }}
        onDraftSaved={() => {
          loadLocalDrafts();
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  titleContainer: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontFamily: Fonts.heading,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    fontFamily: Fonts.body,
    marginTop: 2,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionIconBtn: {
    minWidth: 44,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  actionIconText: {
    fontSize: 18,
  },
  offlineBanner: {
    backgroundColor: '#FEF3C7',
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  offlineBannerText: {
    color: '#92400E',
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: '600',
    textAlign: 'center',
  },
  connectCard: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  connectTitle: {
    fontSize: 16,
    fontFamily: Fonts.heading,
    fontWeight: '700',
    marginBottom: 6,
  },
  connectSubtitle: {
    fontSize: 13,
    fontFamily: Fonts.body,
    lineHeight: 18,
    marginBottom: 12,
  },
  connectButton: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  connectButtonText: {
    color: '#FFFFFF',
    fontFamily: Fonts.heading,
    fontSize: 14,
    fontWeight: '700',
  },
  searchBarContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  searchInput: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: Fonts.body,
  },
  segmentContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  segmentTab: {
    flex: 1,
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: 'rgba(100, 116, 139, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentTabActive: {
    backgroundColor: '#2563EB',
  },
  segmentTabText: {
    color: '#475569',
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  segmentTabTextActive: {
    color: '#FFFFFF',
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  threadCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563EB',
    marginRight: 6,
  },
  senderText: {
    flex: 1,
    fontSize: 14,
    fontFamily: Fonts.heading,
  },
  dateText: {
    fontSize: 11,
    fontFamily: Fonts.body,
    marginLeft: 8,
  },
  subjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  subjectText: {
    flex: 1,
    fontSize: 14,
    fontFamily: Fonts.heading,
  },
  attachmentIcon: {
    fontSize: 13,
    marginLeft: 6,
  },
  snippetText: {
    fontSize: 13,
    fontFamily: Fonts.body,
    lineHeight: 18,
  },
  deleteDraftBtn: {
    padding: 4,
  },
  deleteDraftText: {
    fontSize: 16,
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loaderText: {
    marginTop: 12,
    fontSize: 14,
    fontFamily: Fonts.body,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: Fonts.body,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  menuCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 14,
    padding: 16,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  menuItem: {
    minHeight: 44,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
    paddingHorizontal: 8,
  },
  menuItemText: {
    fontSize: 15,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
});
