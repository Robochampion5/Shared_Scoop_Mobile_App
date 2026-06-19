import React from 'react';
import { View, StyleSheet } from 'react-native';

export default function MatrixBackground() {
  return (
    <>
      <View style={styles.matrixOrb1} />
      <View style={styles.matrixOrb2} />
      <View style={styles.matrixOrb3} />
    </>
  );
}

const styles = StyleSheet.create({
  matrixOrb1: {
    position: 'absolute', top: -40, left: -60, width: 220, height: 220,
    borderRadius: 110, backgroundColor: 'rgba(124, 58, 237, 0.35)',
    opacity: 0.6,
  },
  matrixOrb2: {
    position: 'absolute', top: 280, right: -80, width: 260, height: 260,
    borderRadius: 130, backgroundColor: 'rgba(132, 204, 22, 0.2)',
    opacity: 0.5,
  },
  matrixOrb3: {
    position: 'absolute', top: 550, left: -30, width: 180, height: 180,
    borderRadius: 90, backgroundColor: 'rgba(217, 119, 6, 0.2)',
    opacity: 0.4,
  },
});
