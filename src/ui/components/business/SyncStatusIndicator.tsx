import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { CheckCircle2, Clock, AlertTriangle, Lock } from 'lucide-react-native';
import { Fonts } from '../../theme';

export type SyncBadgeStatus = 'synced' | 'pending' | 'failed' | 'locked';

interface SyncStatusIndicatorProps {
  status: SyncBadgeStatus;
  pendingCount?: number;
  onPress?: () => void;
}

export const SyncStatusIndicator: React.FC<SyncStatusIndicatorProps> = ({
  status,
  pendingCount = 0,
  onPress,
}) => {

  const getStatusConfig = () => {
    switch (status) {
      case 'pending':
        return {
          icon: <Clock size={14} color="#D97706" />,
          text: pendingCount > 0 ? `${pendingCount} pending` : 'Syncing...',
          color: '#D97706',
          bg: '#FEF3C7',
          accessibilityLabel: `Sync status: ${pendingCount} changes pending upload`,
        };
      case 'failed':
        return {
          icon: <AlertTriangle size={14} color="#DC2626" />,
          text: 'Sync error',
          color: '#DC2626',
          bg: '#FEE2E2',
          accessibilityLabel: 'Sync status: sync error, tap to retry',
        };
      case 'locked':
        return {
          icon: <Lock size={14} color="#6B7280" />,
          text: 'Lease expired',
          color: '#6B7280',
          bg: '#F3F4F6',
          accessibilityLabel: 'Sync status: 24-hour offline lease expired. Connect to internet to revalidate.',
        };
      case 'synced':
      default:
        return {
          icon: <CheckCircle2 size={14} color="#16A34A" />,
          text: 'Synced',
          color: '#16A34A',
          bg: '#DCFCE7',
          accessibilityLabel: 'Sync status: all business data up to date',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: config.bg, borderColor: config.color }]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!onPress}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={config.accessibilityLabel}
    >
      <View style={styles.iconWrapper}>{config.icon}</View>
      <Text style={[styles.text, { color: config.color }]}>{config.text}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 28,
  },
  iconWrapper: {
    marginRight: 4,
  },
  text: {
    fontSize: 11,
    fontFamily: Fonts.heading,
    fontWeight: '600',
  },
});
