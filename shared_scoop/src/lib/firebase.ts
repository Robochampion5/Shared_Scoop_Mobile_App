import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { Platform } from 'react-native';

// 1. Import strictly typed Auth modules
import { initializeAuth, getAuth, Auth } from "firebase/auth";

// 2. Bypass the Firebase v10 TypeScript bug. 
// The compiler can't see this function, but the Metro runtime will execute it flawlessly.
// @ts-ignore
import { getReactNativePersistence } from "firebase/auth";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { initializeFirestore, getFirestore, Firestore } from "firebase/firestore";

// Configuration
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

if (getApps().length === 0) {
  // --- INITIAL BOOT ---
  app = initializeApp(firebaseConfig);
  
  // Initialize Auth with Native AsyncStorage persistence
  if (Platform.OS !== 'web') {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } else {
    auth = getAuth(app); // Web fallback
  }

  // Initialize Firestore with React Native's compatible default memory cache
  db = initializeFirestore(app, {}); 

} else {
  // --- FAST REFRESH RECOVERY ---
  app = getApp();
  auth = getAuth(app);
  db = getFirestore(app);
}

export { app, auth, db };