import React, { createContext, useState, useEffect, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onAuthStateChanged, signOut as firebaseSignOut, updateProfile } from 'firebase/auth';
import { auth } from '../firebaseConfig';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [userName, setUserName] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const name = await AsyncStorage.getItem('userName');
        if (name) setUserName(name);
      } catch (e) {
        console.error('Failed to load local data', e);
      }
    };
    loadData();

    // Unified source of truth for the session
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        if (firebaseUser.displayName) {
          setUserName(firebaseUser.displayName);
          AsyncStorage.setItem('userName', firebaseUser.displayName);
        }
      } else {
        setUser(null);
      }
      setIsLoading(false);
    });

    return unsubscribe;
  }, []);

  const saveUserName = async (name) => {
    try {
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName: name });
      }
      setUserName(name);
      await AsyncStorage.setItem('userName', name);
    } catch (e) {
      console.error('Failed to save profile name', e);
    }
  };

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
    } catch (e) {
      console.error('Firebase SignOut Failed', e);
    }
    await AsyncStorage.removeItem('userName');
    setUserName(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, userName, isLoading, saveUserName, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
