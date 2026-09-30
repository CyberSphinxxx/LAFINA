import React from 'react';
import { View, Image, StyleSheet } from 'react-native';

const logo = require('../../../assets/lafina_default_logo.png');

/** The logo at the top of the Login and Register cards. */
export const AuthHeader: React.FC = () => {
  return (
    <View style={styles.header}>
      <Image
        source={logo}
        style={styles.logoText}
        resizeMode="contain"
        accessibilityLabel="LAFINA"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    marginBottom: 8,
  },
  logoText: {
    width: 120,
    height: 64,
  },
});
