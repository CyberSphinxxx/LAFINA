import React from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { Colors, Fonts } from '../../theme';

interface GmailSendConfirmModalProps {
  visible: boolean;
  to: string;
  subject: string;
  onConfirm: () => void;
  onCancel: () => void;
  isSending?: boolean;
}

export const GmailSendConfirmModal: React.FC<GmailSendConfirmModalProps> = ({
  visible,
  to,
  subject,
  onConfirm,
  onCancel,
  isSending = false,
}) => {
  const { colors, isDarkMode } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.container,
            { backgroundColor: colors.cardBg },
          ]}
          accessible={true}
          accessibilityRole="alert"
          accessibilityLabel="Confirm email sending"
        >
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            Confirm Send Email
          </Text>

          <Text style={[styles.message, { color: colors.textSecondary }]}>
            Are you sure you want to send this email?
          </Text>

          <View style={[styles.infoBox, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : '#F1F5F9' }]}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              To: <Text style={{ color: colors.textPrimary, fontWeight: 'bold' }}>{to}</Text>
            </Text>
            <Text style={[styles.label, { color: colors.textSecondary, marginTop: 4 }]}>
              Subject: <Text style={{ color: colors.textPrimary }}>{subject || '(No Subject)'}</Text>
            </Text>
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={onCancel}
              disabled={isSending}
              accessibilityRole="button"
              accessibilityLabel="Cancel send"
              accessibilityHint="Dismisses send confirmation without sending"
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.confirmButton]}
              onPress={onConfirm}
              disabled={isSending}
              accessibilityRole="button"
              accessibilityLabel="Confirm and Send Email"
              accessibilityHint="Dispatches email through Gmail API"
            >
              <Text style={styles.confirmButtonText}>
                {isSending ? 'Sending...' : 'Send Now'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 16,
    padding: 24,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  title: {
    fontSize: 18,
    fontFamily: Fonts.heading,
    fontWeight: '700',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    fontFamily: Fonts.body,
    marginBottom: 16,
    lineHeight: 20,
  },
  infoBox: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontFamily: Fonts.body,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  button: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: 'transparent',
  },
  cancelButtonText: {
    color: '#64748B',
    fontFamily: Fonts.heading,
    fontSize: 14,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: Colors.blue || '#2563EB',
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontFamily: Fonts.heading,
    fontSize: 14,
    fontWeight: '700',
  },
});
