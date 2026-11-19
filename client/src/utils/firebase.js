// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "stockpilot-ai-2c61a.firebaseapp.com",
  projectId: "stockpilot-ai-2c61a",
  storageBucket: "stockpilot-ai-2c61a.firebasestorage.app",
  messagingSenderId: "685692848484",
  appId: "1:685692848484:web:d3b3ec83691815b1201271",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
