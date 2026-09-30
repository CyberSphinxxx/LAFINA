import React from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity, Modal } from 'react-native';
import { Colors, Fonts, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../contexts/ThemeContext';

interface PrivacyModalProps {
  visible: boolean;
  onClose: () => void;
}

export const PrivacyModal: React.FC<PrivacyModalProps> = ({
  visible,
  onClose,
}) => {
  const themed = useThemedStyles(getThemedStyles);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.privacyContainer, themed.privacyContainer]}>
        <View style={[styles.privacyHeader, themed.privacyHeader]}>
          <Text style={[styles.privacyHeaderTitle, themed.privacyHeaderTitle]}>Privacy Policy</Text>
          <TouchableOpacity onPress={onClose} style={styles.privacyCloseBtn}>
            <Text style={styles.privacyCloseBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.privacyContent} contentContainerStyle={styles.privacyContentContainer}>
          <Text style={[styles.privacySectionTitle, themed.privacySectionTitle]}>1. Data Collection</Text>
          <Text style={[styles.privacyBodyText, themed.privacyBodyText]}>
            LAFINA stores all scheduling data, notes, and tasks locally on your device using SQLite. No data is transmitted to external servers without your explicit action.
          </Text>

          <Text style={[styles.privacySectionTitle, themed.privacySectionTitle]}>2. Voice Processing</Text>
          <Text style={[styles.privacyBodyText, themed.privacyBodyText]}>
            Voice recordings are processed entirely on-device using offline AI models. Audio is never uploaded, shared, or stored beyond the current session.
          </Text>

          <Text style={[styles.privacySectionTitle, themed.privacySectionTitle]}>3. Account Information</Text>
          <Text style={[styles.privacyBodyText, themed.privacyBodyText]}>
            Your email and display name are stored locally for profile display and optional cloud sync.
          </Text>

          <Text style={[styles.privacySectionTitle, themed.privacySectionTitle]}>4. No Third-Party Sharing</Text>
          <Text style={[styles.privacyBodyText, themed.privacyBodyText]}>
            LAFINA does not share, sell, or transmit your personal data to third parties.
          </Text>

          <Text style={[styles.privacySectionTitle, themed.privacySectionTitle]}>5. Data Deletion</Text>
          <Text style={[styles.privacyBodyText, themed.privacyBodyText]}>
            You can delete all personal data at any time using the "Clear All Data" option in Profile Settings.
          </Text>

          <Text style={[styles.privacySectionTitle, themed.privacySectionTitle]}>6. Contact</Text>
          <Text style={[styles.privacyBodyText, themed.privacyBodyText]}>
            For privacy concerns, contact the LAFINA development team at USTP Cagayan de Oro.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  privacyContainer: {
    flex: 1,
  },
  privacyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  privacyHeaderTitle: {
    fontFamily: Fonts.heading,
    fontSize: 18,
    fontWeight: 'bold',
  },
  privacyCloseBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  privacyCloseBtnText: {
    fontFamily: Fonts.body,
    color: Colors.red,
    fontWeight: 'bold',
  },
  privacyContent: {
    flex: 1,
    padding: 16,
  },
  privacyContentContainer: {
    paddingBottom: 32,
  },
  privacySectionTitle: {
    fontFamily: Fonts.heading,
    fontSize: 15,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 6,
  },
  privacyBodyText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 18,
  },
});

const getThemedStyles = (colors: ThemeColors) => ({
  privacyContainer: {
    backgroundColor: colors.background,
  },
  privacyHeader: {
    borderBottomColor: colors.border,
  },
  privacyHeaderTitle: {
    color: colors.textPrimary,
  },
  privacySectionTitle: {
    color: colors.textPrimary,
  },
  privacyBodyText: {
    color: colors.textSecondary,
  },
});
