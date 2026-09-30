import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, Layout, Shadows } from '../../theme';
import type { ThemeColors } from '../../contexts/ThemeContext';
import {
  Users,
  PlusCircle,
  Calendar,
  Mail,
  Mic,
  AlertCircle,
  Clock,
  CheckCircle,
  Settings,
} from 'lucide-react-native';
import { SyncStatusIndicator } from '../../components/business/SyncStatusIndicator';

interface ManagerOverviewProps {
  businessName?: string;
  activeSeats?: number;
  seatLimit?: number;
  onOpenTeamManagement: () => void;
  onOpenProfile: () => void;
  onActionPress?: (action: 'assign_task' | 'schedule_block' | 'compose_email' | 'record_meeting') => void;
  isLeaseActive?: boolean;
}

export const ManagerOverviewScreen: React.FC<ManagerOverviewProps> = ({
  businessName = 'My Business',
  activeSeats = 1,
  seatLimit = 5,
  onOpenTeamManagement,
  onOpenProfile,
  onActionPress,
  isLeaseActive = true,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);

  return (
    <View style={[styles.screen, themed.screen]}>
      {/* Top Header */}
      <View style={[styles.header, themed.header]}>
        <View>
          <Text style={[styles.orgName, themed.orgName]}>{businessName}</Text>
          <Text style={[styles.roleBadge, themed.roleBadge]}>Manager Workspace</Text>
        </View>
        <View style={styles.headerRight}>
          <SyncStatusIndicator
            status={isLeaseActive ? 'synced' : 'locked'}
            onPress={() => {
              if (!isLeaseActive) {
                Alert.alert(
                  'Offline Lease Expired',
                  'Your 24-hour offline Business access has expired. Please connect to the internet to refresh your session.'
                );
              }
            }}
          />
          <TouchableOpacity
            style={[styles.avatarButton, themed.avatarButton]}
            onPress={onOpenProfile}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Account and Settings"
          >
            <Settings size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Offline Lease Lock Alert */}
        {!isLeaseActive && (
          <View style={[styles.warningBanner, { backgroundColor: '#FEE2E2', borderColor: '#DC2626' }]}>
            <AlertCircle size={20} color="#DC2626" />
            <Text style={[styles.warningText, { color: '#991B1B' }]}>
              Offline Business lease expired (24h limit). Connect to the internet to unlock collaboration features.
            </Text>
          </View>
        )}

        {/* Seat Usage Card */}
        <View style={[styles.card, themed.card, Shadows.card]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <Users size={18} color={colors.red} />
              <Text style={[styles.cardTitle, themed.cardTitle]}>Team Seats</Text>
            </View>
            <TouchableOpacity
              style={[styles.smallBtn, { backgroundColor: colors.red }]}
              onPress={onOpenTeamManagement}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Manage Team Members"
            >
              <Text style={styles.smallBtnText}>Manage Team</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.seatCountText, themed.seatCountText]}>
            {`${activeSeats} / ${seatLimit} Seats Allocated`}
          </Text>
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${Math.min(100, (activeSeats / Math.max(1, seatLimit)) * 100)}%`,
                  backgroundColor: colors.red,
                },
              ]}
            />
          </View>
        </View>

        {/* Team Workload Summary */}
        <Text style={[styles.sectionTitle, themed.sectionTitle]}>Workload & Status</Text>
        <View style={styles.metricGrid}>
          <View style={[styles.metricCard, themed.card, Shadows.card]}>
            <Clock size={20} color="#D97706" />
            <Text style={[styles.metricValue, themed.text]}>3</Text>
            <Text style={[styles.metricLabel, themed.mutedText]}>Due Today</Text>
          </View>
          <View style={[styles.metricCard, themed.card, Shadows.card]}>
            <AlertCircle size={20} color="#DC2626" />
            <Text style={[styles.metricValue, themed.text]}>1</Text>
            <Text style={[styles.metricLabel, themed.mutedText]}>Needs Review</Text>
          </View>
          <View style={[styles.metricCard, themed.card, Shadows.card]}>
            <CheckCircle size={20} color="#16A34A" />
            <Text style={[styles.metricValue, themed.text]}>8</Text>
            <Text style={[styles.metricLabel, themed.mutedText]}>Completed</Text>
          </View>
        </View>

        {/* Quick Actions */}
        <Text style={[styles.sectionTitle, themed.sectionTitle]}>Quick Actions</Text>
        <View style={styles.actionGrid}>
          <TouchableOpacity
            style={[styles.actionBtn, themed.card, Shadows.card]}
            onPress={() => onActionPress?.('assign_task')}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Assign Task to Employee"
          >
            <PlusCircle size={24} color={colors.red} />
            <Text style={[styles.actionBtnText, themed.text]}>Assign Task</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, themed.card, Shadows.card]}
            onPress={() => onActionPress?.('schedule_block')}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Schedule Work Block"
          >
            <Calendar size={24} color={colors.blue} />
            <Text style={[styles.actionBtnText, themed.text]}>Schedule Block</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, themed.card, Shadows.card]}
            onPress={() => onActionPress?.('compose_email')}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Compose Email"
          >
            <Mail size={24} color="#8B5CF6" />
            <Text style={[styles.actionBtnText, themed.text]}>Compose Mail</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, themed.card, Shadows.card]}
            onPress={() => onActionPress?.('record_meeting')}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Record Meeting"
          >
            <Mic size={24} color="#EC4899" />
            <Text style={[styles.actionBtnText, themed.text]}>Record Meeting</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
};

const getThemedStyles = (colors: ThemeColors) => ({
  screen: { backgroundColor: colors.background },
  header: { backgroundColor: colors.cardBg, borderBottomColor: colors.border },
  orgName: { color: colors.textPrimary },
  roleBadge: { color: colors.red },
  card: { backgroundColor: colors.cardBg, borderColor: colors.border },
  cardTitle: { color: colors.textPrimary },
  seatCountText: { color: colors.textPrimary },
  sectionTitle: { color: colors.textPrimary },
  text: { color: colors.textPrimary },
  mutedText: { color: colors.textMuted },
  avatarButton: { backgroundColor: colors.background, borderColor: colors.border },
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  orgName: {
    fontSize: 20,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  roleBadge: {
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: '600',
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatarButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: Layout.navbarHeight + 48,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    gap: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    fontFamily: Fonts.body,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  smallBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    minHeight: 32,
    justifyContent: 'center',
  },
  smallBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  seatCountText: {
    fontSize: 14,
    fontFamily: Fonts.body,
    marginBottom: 8,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  metricGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  metricCard: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  metricValue: {
    fontSize: 22,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    marginTop: 4,
  },
  metricLabel: {
    fontSize: 11,
    fontFamily: Fonts.body,
    marginTop: 2,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionBtn: {
    width: '48%',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    minHeight: 88,
    gap: 8,
  },
  actionBtnText: {
    fontSize: 13,
    fontFamily: Fonts.heading,
    fontWeight: '600',
    textAlign: 'center',
  },
});
