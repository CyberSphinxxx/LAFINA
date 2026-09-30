import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Alert,
  Keyboard,
  Switch,
} from 'react-native';
import { Trash2, Plus, BookOpen, FileSpreadsheet, FileText, Presentation } from 'lucide-react-native';
import { SvgXml } from 'react-native-svg';
import { Fonts, Colors } from '../theme';
import { chatStore } from '../../storage';
import { LAFINA_LOGO_CHAT_HEADER_XML } from '../../assets/lafina_logo_chat_header_xml';
import type { ChatAttachment, ChatMessage } from '../../storage';
import {
  runLocalLlmChat,
  createFallbackNluResult,
  normalizeTranscript,
  applyNluScheduleResult,
  detectDocumentRequest,
} from '../../ai';
import { useThemedStyles } from '../theme/createThemedStyles';
import { useTheme } from '../contexts/ThemeContext';
import type { ThemeColors } from '../contexts/ThemeContext';
import { generateId } from '../../utils';

// Chat sub-components
import { ChatMessageItem } from '../components/chat/ChatMessageItem';
import { ChatInput } from '../components/chat/ChatInput';
import { TypingBubble } from '../components/chat/TypingBubble';
import { removeAttachmentFiles, saveGeneratedFile, shareAttachment } from '../components/chat/chatFiles';
import { ToolSheet } from '../components/tools';

import {
  handbookPreference,
  handbookSourceLabel,
  onlineChatSkill,
} from '../../skills/onlineChatSkill';
import type { HandbookStatus } from '../../skills/onlineChatSkill';
import {
  DOCUMENT_FORMAT_ORDER,
  DOCUMENT_FORMATS,
  describeDocumentFailure,
  documentSkill,
} from '../../skills/documentSkill';
import type { DocumentFormat } from '../../skills/documentSkill';
import { accountLinkService } from '../../cloud/accountLinkService';
import { cloudClient } from '../../cloud/cloudClient';
import { hasProEntitlement, isStudentProAccount } from '../../cloud';

interface ChatScreenProps {
  userId: string;
  refreshTrigger: number;
  onRefresh: () => void;
}

let userExplicitOfflineChoice = false;

/** Prefix that marks an inline explanation of why the cloud model was not used. */
const OFFLINE_NOTE_PREFIX = '⚠ LAFINA';

const FORMAT_ICONS: Record<DocumentFormat, React.ComponentType<{ size: number; color: string }>> = {
  pdf: FileText,
  docx: FileText,
  xlsx: FileSpreadsheet,
  pptx: Presentation,
};

const FORMAT_NOUNS: Record<DocumentFormat, string> = {
  pdf: 'document',
  docx: 'document',
  xlsx: 'workbook',
  pptx: 'presentation',
};

export const ChatScreen: React.FC<ChatScreenProps> = ({
  userId,
  refreshTrigger,
  onRefresh,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [isOnlineMode, setIsOnlineMode] = useState(false);
  const [isSending, setIsSending] = useState(false);
  /** Shown beside the spinner, e.g. "Creating your PDF file…". */
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  /** The file format picked for the next message, if any. */
  const [docFormat, setDocFormat] = useState<DocumentFormat | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  /** This student's own switch for handbook answers; the admin panel's still rules. */
  const [handbookOn, setHandbookOn] = useState(() => handbookPreference.read(userId));
  /** What the server says about the handbook; null until it has been asked. */
  const [handbookStatus, setHandbookStatus] = useState<HandbookStatus | null>(null);
  /** "Handbook p. 32" for replies the server grounded in the Student Handbook. */
  const [handbookNotes, setHandbookNotes] = useState<Record<string, string>>({});
  const flatListRef = useRef<FlatList>(null);

  const { colors } = useTheme();
  const themed = useThemedStyles(getChatThemedStyles);
  const studentPro = isStudentProAccount(userId);

  // Another account's switch and picked format do not carry over.
  useEffect(() => {
    setHandbookOn(handbookPreference.read(userId));
    setDocFormat(null);
    setHandbookNotes({});
  }, [userId]);

  /**
   * Asks the server whether handbook answers are switched on and working.
   * Only while online: offline, the handbook plays no part and says nothing.
   */
  const refreshHandbookStatus = useCallback(async (): Promise<void> => {
    try {
      const result = await onlineChatSkill.fetchHandbookStatus();
      setHandbookStatus(result.status === 'success' && result.data ? result.data : null);
    } catch (error) {
      console.warn('[Chat] Could not check the Student Handbook status:', error);
      setHandbookStatus(null);
    }
  }, []);

  useEffect(() => {
    if (!isOnlineMode) {
      setHandbookStatus(null);
      return;
    }
    refreshHandbookStatus();
  }, [isOnlineMode, userId, refreshTrigger, refreshHandbookStatus]);

  // The handbook is only offered while it is switched on in the admin panel,
  // and only matters online: offline, the on-device model answers alone.
  const handbookOffered = isOnlineMode && !!handbookStatus?.enabled;

  useEffect(() => {
    let isMounted = true;
    const checkDefaultOnline = async () => {
      try {
        const isProOrBusiness = hasProEntitlement(userId);

        const isOnline = await cloudClient.isOnline();
        const token = cloudClient.getAccessToken();
        if (isProOrBusiness && isOnline && token && !userExplicitOfflineChoice && isMounted) {
          setIsOnlineMode(true);
        } else if ((!isOnline || !isProOrBusiness) && isMounted) {
          setIsOnlineMode(false);
        }
      } catch {
        // Fallback gracefully
      }
    };
    checkDefaultOnline();
    return () => {
      isMounted = false;
    };
  }, [userId, refreshTrigger]);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => setIsKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setIsKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    loadChatHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, refreshTrigger]);

  const loadChatHistory = () => {
    const history = chatStore.getMessages(userId);
    setMessages(history);
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: false });
    }, 100);
  };

  const handleToggleOnline = async () => {
    if (!isOnlineMode) {
      const authorization = await accountLinkService.authorizeOnlineMode(userId);
      if (authorization.status === 'student_pro_required') {
        Alert.alert(
          'Student Pro Required',
          'Online Assistant (DeepSeek-V4) is exclusive to Student Pro accounts.\n\nOffline Chat and offline scheduling remain available.'
        );
        return;
      }
      if (authorization.status !== 'success') {
        const needsAuthentication = authorization.status === 'auth_required';
        const unavailable = authorization.status === 'offline' ||
          authorization.status === 'server_unavailable';
        Alert.alert(
          needsAuthentication
            ? 'Cloud Authentication Required'
            : unavailable ? 'Online Service Unavailable' : 'Online Mode Unavailable',
          `${authorization.message}\n\n${needsAuthentication
            ? 'Sign in while online so LAFINA can link FastAPI automatically.'
            : 'Offline Chat and offline scheduling remain available.'}`
        );
        return;
      }
      userExplicitOfflineChoice = false;
      setIsOnlineMode(true);
    } else {
      userExplicitOfflineChoice = true;
      setIsOnlineMode(false);
    }
  };

  const handleOpenFiles = () => {
    if (!studentPro) {
      Alert.alert(
        'Student Pro Required',
        'Creating PDF, Word, Excel and PowerPoint files is exclusive to Student Pro accounts.\n\nOffline chat and offline scheduling remain available.'
      );
      return;
    }
    setFilesOpen(true);
  };

  const handleToggleHandbook = (next: boolean) => {
    setHandbookOn(next);
    handbookPreference.write(userId, next);
  };

  /**
   * Asks the server for a file built from the conversation, and keeps it.
   *
   * The file is written to the app's attachments folder straight away, so the
   * card in the chat still offers it after a restart.
   */
  const createDocumentReply = async (
    format: DocumentFormat,
    conversation: ChatMessage[],
  ): Promise<{ reply: string; attachment: ChatAttachment | null }> => {
    const info = DOCUMENT_FORMATS[format];
    const result = await documentSkill.generate({
      format,
      messages: conversation.map((message) => ({ role: message.sender, content: message.content })),
    });

    if (result.status !== 'success' || !result.data) {
      console.warn(`[Chat] File generation failed (${result.status})`, result.error);
      if (result.status === 'auth_required' || result.status === 'subscription_required') {
        setIsOnlineMode(false);
      }
      return {
        reply: `${OFFLINE_NOTE_PREFIX} could not create that ${info.label} file. ${describeDocumentFailure(result)}`,
        attachment: null,
      };
    }

    const data = result.data;
    const path = await saveGeneratedFile(data.contentBase64, info.extension);
    const warnings = data.warnings?.length
      ? `\n\n${data.warnings.map((warning) => `- ${warning}`).join('\n')}`
      : '';
    return {
      reply: `${data.summary}${warnings}`,
      attachment: {
        uri: path,
        fileName: data.filename,
        format,
        mimeType: data.mimeType || info.mimeType,
        sizeBytes: data.sizeBytes || Math.floor((data.contentBase64.length * 3) / 4),
      },
    };
  };

  const handleOpenAttachment = async (attachment: ChatAttachment) => {
    const outcome = await shareAttachment(attachment);
    if (outcome === 'missing') {
      Alert.alert('File Not Found', 'This file is no longer on this phone. Ask for it again to get a new copy.');
    } else if (outcome === 'failed') {
      Alert.alert('Could Not Share', 'That file could not be opened or shared.');
    }
  };

  const handleSend = async () => {
    if (!inputText.trim() || isSending) return;

    const userText = inputText.trim();
    // A format picked in the composer always means a file. One only guessed
    // from the wording respects an explicit switch to Offline, since making
    // the file sends the conversation to the server.
    const pickedFormat = docFormat;
    const fileFormat = pickedFormat ?? detectDocumentRequest(userText);
    setInputText('');
    setDocFormat(null);
    Keyboard.dismiss();
    setIsSending(true);

    const sessionId = chatStore.ensureDefaultSession(userId);

    // 1. Insert User Message
    const userMsgId = generateId('msg');
    const userMsg = {
      id: userMsgId,
      sessionId,
      sender: 'user' as const,
      content: userText,
    };
    chatStore.insertMessage(userMsg);

    // Temp state update for immediate user feedback
    const tempMessages = [
      ...messages,
      {
        ...userMsg,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    setMessages(tempMessages);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

    let aiReply = '';
    let attachment: ChatAttachment | null = null;
    let handbookNote: string | null = null;
    try {
      const isProOrBusiness = hasProEntitlement(userId);

      const isDeviceOnline = await cloudClient.isOnline();
      const hasToken = !!cloudClient.getAccessToken();
      const shouldUseOnline = isProOrBusiness && (isOnlineMode || (isDeviceOnline && !userExplicitOfflineChoice)) && hasToken;
      const makeFile = !!fileFormat && studentPro && (!!pickedFormat || !userExplicitOfflineChoice);

      if (makeFile && fileFormat) {
        // Skips the offline scheduler on purpose: it reads "create" as a
        // command, and "create a PDF of my plan" is not a task to add.
        setPendingLabel(`Creating your ${DOCUMENT_FORMATS[fileFormat].label} file…`);
        ({ reply: aiReply, attachment } = await createDocumentReply(fileFormat, tempMessages));
      } else if (shouldUseOnline) {
        // Apply scheduling actions locally if user message expresses scheduling intent
        const normalizedUserText = normalizeTranscript(userText);
        const scheduleNlu = createFallbackNluResult(normalizedUserText);
        let localScheduleReply: string | null = null;
        if (scheduleNlu.intent === 'schedule') {
          const scheduleRes = applyNluScheduleResult(scheduleNlu, userId);
          if (scheduleRes.didUpdate) {
            localScheduleReply = scheduleRes.reply;
          }
        }

        // FastAPI is authoritative for entitlements and re-checks the live account
        // role on every request, including SQLAdmin upgrades and downgrades.
        const chatPayload = tempMessages.map((m) => ({
          role: m.sender as 'user' | 'assistant',
          content: m.content,
        }));
        const cloudRes = await onlineChatSkill.sendChatMessage(chatPayload, { useHandbook: handbookOn });
        if (cloudRes.status === 'success' && cloudRes.data) {
          aiReply = localScheduleReply ?? cloudRes.data.reply;
          handbookNote = localScheduleReply ? null : handbookSourceLabel(cloudRes.data.sources);
          setIsOnlineMode(true);
          // The admin may have flipped the switch since the badge last asked.
          refreshHandbookStatus();
        } else if (localScheduleReply) {
          aiReply = localScheduleReply;
        } else if (cloudRes.status === 'auth_required') {
          setIsOnlineMode(false);
          aiReply = '[Cloud AI Error (auth_required)]: Cloud session expired. Sign in again while online. Offline mode remains available.';
        } else {
          // Graceful automatic fallback to SmolLM2 Local LLM when cloud call fails
          console.warn(`[Chat] Online AI request returned ${cloudRes.status}, falling back to offline LLM.`);
          aiReply = await runLocalLlmChat(userText, userId);
        }
      } else {
        // Process Command via SmolLM2 Local LLM Chatbot (100% offline)
        aiReply = await runLocalLlmChat(userText, userId);
      }

      // Asked for a file in so many words, but did not get one: say why,
      // rather than answering as though the request were never made.
      if (fileFormat && !makeFile) {
        const label = DOCUMENT_FORMATS[fileFormat].label;
        aiReply += studentPro
          ? `\n\n${OFFLINE_NOTE_PREFIX} creates ${label} files online. Switch to Online, or pick a format with the file button.`
          : `\n\n${OFFLINE_NOTE_PREFIX} creates ${label} files for Student Pro accounts only.`;
      }
    } catch (error) {
      console.error('[Chat] Failed to produce a reply:', error);
      aiReply = 'Something went wrong while processing that. Please try again.';
      attachment = null;
    }

    // 3. Insert AI Response
    const aiMsgId = generateId('msg');
    const aiMsg = {
      id: aiMsgId,
      sessionId,
      sender: 'assistant' as const,
      content: aiReply,
      attachment,
    };
    chatStore.insertMessage(aiMsg);
    if (handbookNote) {
      const note = handbookNote;
      setHandbookNotes((previous) => ({ ...previous, [aiMsgId]: note }));
    }

    setIsSending(false);
    setPendingLabel(null);
    loadChatHistory();
    onRefresh();
  };

  const handleClearChat = () => {
    Alert.alert(
      'Clear Chat History',
      'Are you sure you want to clear your conversation history? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            // The generated files go with the history that offered them.
            // Copies already shared elsewhere are untouched.
            const attachmentUris = chatStore.getAttachmentUris(userId);
            chatStore.clearHistory(userId);
            removeAttachmentFiles(attachmentUris);
            setHandbookNotes({});
            loadChatHistory();
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: ChatMessage }) => {
    return (
      <ChatMessageItem
        item={item}
        handbookNote={handbookNotes[item.id]}
        onOpenAttachment={handleOpenAttachment}
      />
    );
  };

  const pickedInfo = docFormat ? DOCUMENT_FORMATS[docFormat] : null;

  return (
    <KeyboardAvoidingView
      style={[styles.container, themed.container]}
      behavior={undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <SvgXml
            xml={LAFINA_LOGO_CHAT_HEADER_XML}
            width={38}
            height={38}
            style={styles.headerLogo}
          />
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>LAFINA Assistant</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1} ellipsizeMode="tail">
              {isOnlineMode ? 'Online Assistant (DeepSeek-V4)' : 'Offline NLU Scheduler'}
            </Text>
            {handbookOffered && handbookOn && handbookStatus ? (
              <TouchableOpacity
                style={[styles.handbookBadge, handbookStatus.functional ? themed.handbookReady : themed.handbookDown]}
                onPress={() =>
                  Alert.alert(
                    'USTP Student Handbook',
                    handbookStatus.functional
                      ? `Questions about USTP are answered from the Student Handbook (${handbookStatus.passages} passages indexed). Turn it off from the file button.`
                      : handbookStatus.detail || 'The Student Handbook is switched on but not working right now.'
                  )
                }
                accessibilityRole="button"
              >
                <BookOpen size={10} color={colors.white} />
                <Text style={[styles.handbookBadgeText, themed.onHeader]}>
                  {handbookStatus.functional ? 'Handbook' : 'Handbook unavailable'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={handleToggleOnline}
            style={[styles.modeToggleBtn, isOnlineMode && styles.modeToggleActive]}
          >
            <Text style={[styles.modeToggleText, isOnlineMode && styles.modeToggleTextActive]}>
              {isOnlineMode ? 'Online' : 'Offline'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleClearChat} style={styles.headerIconBtn}>
            <View style={styles.plusCircle}>
              <Plus size={16} color="#FFFFFF" />
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleClearChat} style={styles.headerIconBtn}>
            <Trash2 size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Message List */}
      {messages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, themed.emptyText]}>Ask me to schedule events, create tasks, or save notes!</Text>
          <Text style={[styles.exampleText, themed.exampleText]}>Try: "add task Submit paper by 9:00 PM"</Text>
          <Text style={[styles.exampleText, themed.exampleText]}>Try: "block 13:00-15:00 for Exam Review"</Text>
          <Text style={[styles.exampleText, themed.exampleText]}>Try: "note Remind me to call Mom"</Text>
          {studentPro ? (
            <Text style={[styles.exampleText, themed.exampleText]}>
              Try: "make me a PDF study guide on cell organelles"
            </Text>
          ) : null}
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          ListFooterComponent={
            isSending ? <TypingBubble label={pendingLabel} /> : null
          }
        />
      )}

      {/* Input Row */}
      <ChatInput
        inputText={inputText}
        setInputText={setInputText}
        onSend={handleSend}
        isKeyboardVisible={isKeyboardVisible}
        onOpenFiles={handleOpenFiles}
        filesLocked={!studentPro}
        fileLabel={pickedInfo?.label ?? null}
        onClearFile={() => setDocFormat(null)}
        isSending={isSending}
      />
      <ToolSheet visible={filesOpen} title="Create a file" onClose={() => setFilesOpen(false)}>
        {DOCUMENT_FORMAT_ORDER.map((format) => {
          const Icon = FORMAT_ICONS[format];
          const selected = docFormat === format;
          return (
            <TouchableOpacity
              key={format}
              style={[styles.formatRow, themed.formatRow, selected && themed.formatRowSelected]}
              onPress={() => {
                setDocFormat(format);
                setFilesOpen(false);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Icon size={20} color={colors.red} />
              <Text style={[styles.formatLabel, themed.formatLabel]}>
                {DOCUMENT_FORMATS[format].label} {FORMAT_NOUNS[format]}
              </Text>
            </TouchableOpacity>
          );
        })}
        <Text style={[styles.formatHint, themed.exampleText]}>
          Then describe what the file should contain. It is written on the LAFINA server from this conversation.
        </Text>
        {handbookOffered ? (
          <View style={[styles.handbookRow, themed.formatRow]}>
            <BookOpen size={20} color={colors.blue} />
            <View style={styles.handbookRowText}>
              <Text style={[styles.formatLabel, themed.formatLabel]}>Answer from the Student Handbook</Text>
              <Text style={[styles.formatHint, themed.exampleText]}>
                Questions about USTP are answered from the handbook, with the pages cited.
              </Text>
            </View>
            <Switch
              value={handbookOn}
              onValueChange={handleToggleHandbook}
              trackColor={{ false: colors.switchTrackOff, true: colors.blue }}
              thumbColor={colors.switchThumb}
              accessibilityLabel="Answer from the Student Handbook"
            />
          </View>
        ) : null}
      </ToolSheet>
      <View style={{ height: isKeyboardVisible ? 0 : 170 }} />
    </KeyboardAvoidingView>
  );
};

const getChatThemedStyles = (colors: ThemeColors) => ({
  container: { backgroundColor: colors.background },
  emptyText: { color: colors.textSecondary },
  exampleText: { color: colors.textMuted },
  assistantBubble: { backgroundColor: colors.cardBg, borderColor: colors.border },
  assistantText: { color: colors.textPrimary },
  assistantTime: { color: colors.textMuted },
  onHeader: { color: colors.white },
  handbookReady: { backgroundColor: colors.success },
  handbookDown: { backgroundColor: colors.warning },
  formatRow: { borderColor: colors.border, backgroundColor: colors.cardBg },
  formatRowSelected: { borderColor: colors.red },
  formatLabel: { color: colors.textPrimary },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 12,
    backgroundColor: Colors.blue,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  headerLogo: {
    width: 38,
    height: 38,
    marginRight: 10,
  },
  headerTextContainer: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: Fonts.heading,
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 11,
    fontFamily: Fonts.body,
    marginTop: 2,
    color: 'rgba(255, 255, 255, 0.85)',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIconBtn: {
    padding: 6,
    marginLeft: 12,
  },
  plusCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: Fonts.heading,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
  exampleText: {
    fontSize: 12,
    fontFamily: Fonts.body,
    marginTop: 6,
    fontStyle: 'italic',
  },
  modeToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    marginRight: 6,
  },
  modeToggleActive: {
    backgroundColor: '#FFFFFF',
  },
  modeToggleText: {
    fontSize: 11,
    fontFamily: Fonts.heading,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  modeToggleTextActive: {
    color: Colors.blue,
    fontWeight: 'bold',
  },
  handbookBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginTop: 3,
    gap: 3,
  },
  handbookBadgeText: {
    fontSize: 9,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  formatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 12,
  },
  formatLabel: {
    fontSize: 15,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
  formatHint: {
    fontSize: 12,
    fontFamily: Fonts.body,
    marginBottom: 8,
    lineHeight: 17,
  },
  handbookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 8,
    gap: 12,
  },
  handbookRowText: {
    flex: 1,
  },
});
