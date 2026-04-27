import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// No AI Studio, usamos o arquivo firebase-applet-config.json se disponível.
// No Vercel, usamos as variáveis de ambiente ou os valores padrão abaixo.

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAORPjsCqS06Wwm3iYkmN6eyYU8DIkMESs",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "gen-lang-client-0772285066.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "gen-lang-client-0772285066",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "gen-lang-client-0772285066.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1033892989320",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:1033892989320:web:75ceab1047b34c967d123d",
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID || "ai-studio-e2857072-f0fd-4975-81ba-28982e719f2e"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
