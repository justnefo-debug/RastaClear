import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { FirebaseRecaptchaVerifierModal } from 'expo-firebase-recaptcha';
import { PhoneAuthProvider, signInWithCredential, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, signOut } from 'firebase/auth';
import * as Location from 'expo-location';
import { auth, firebaseConfig } from '../firebaseConfig';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [name, setName] = useState('');
  const [verificationId, setVerificationId] = useState(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const recaptchaVerifier = useRef(null);
  const { saveUserName } = useAuth();
  
  const [authMode, setAuthMode] = useState('phone');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [currentCity, setCurrentCity] = useState('Pakistan');

  useEffect(() => {
    (async () => {
      try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        let loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
        let geocode = await Location.reverseGeocodeAsync({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude
        });

        if (geocode && geocode.length > 0) {
          setCurrentCity(geocode[0].city || geocode[0].subregion || 'Pakistan');
        }
      } catch (error) {
        console.log("Location geocoding error: ", error);
      }
    })();
  }, []);

  const handleSendOTP = async () => {
    if (!phoneNumber || !name) {
      Alert.alert("Error", "Please enter your name and phone number.");
      return;
    }
    setLoading(true);
    try {
      const phoneProvider = new PhoneAuthProvider(auth);
      const id = await phoneProvider.verifyPhoneNumber(
        phoneNumber,
        recaptchaVerifier.current
      );
      setVerificationId(id);
      await saveUserName(name);
    } catch (error) {
      Alert.alert("Error", error.message);
    }
    setLoading(false);
  };

  const handleVerifyOTP = async () => {
    if (!verificationCode) {
      Alert.alert("Error", "Please enter the OTP.");
      return;
    }
    setLoading(true);
    try {
      const credential = PhoneAuthProvider.credential(
        verificationId,
        verificationCode
      );
      await signInWithCredential(auth, credential);
    } catch (error) {
      Alert.alert("Error", "Invalid OTP.");
    }
    setLoading(false);
  };

  const handleEmailLogin = async () => {
    if (!email || !password) {
      Alert.alert("Error", "Please enter email and password.");
      return;
    }
    setLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      if (!userCredential.user.emailVerified) {
        Alert.alert("Verification Required", "Please verify your email first.");
        await signOut(auth);
        setLoading(false);
        return;
      }
      
      // We don't overwrite the name on login unless they provide one.
      if (name) {
        await saveUserName(name);
      }
    } catch (error) {
      Alert.alert("Error", error.message);
    }
    setLoading(false);
  };

  const handleEmailSignUp = async () => {
    if (!email || !password || !name) {
      Alert.alert("Error", "Please enter name, email, and password.");
      return;
    }
    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await saveUserName(name);
      await sendEmailVerification(userCredential.user);
      Alert.alert("Account created!", "Please check your email to verify your account before logging in.");
      await signOut(auth);
    } catch (error) {
      Alert.alert("Error", error.message);
    }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <FirebaseRecaptchaVerifierModal
        ref={recaptchaVerifier}
        firebaseConfig={firebaseConfig}
      />
      
      <View style={styles.content}>
        <Text style={styles.brandTitle}>Rasta Clear</Text>
        <Text style={styles.tagline}>Ride Safe, {currentCity}.</Text>

        <View style={styles.toggleContainer}>
          <TouchableOpacity onPress={() => setAuthMode('phone')} style={[styles.toggleTab, authMode === 'phone' && styles.activeTab]}>
            <Text style={[styles.toggleText, authMode === 'phone' && styles.activeToggleText]}>Phone</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setAuthMode('email')} style={[styles.toggleTab, authMode === 'email' && styles.activeTab]}>
            <Text style={[styles.toggleText, authMode === 'email' && styles.activeToggleText]}>Email</Text>
          </TouchableOpacity>
        </View>

        {authMode === 'phone' ? (
          verificationId ? (
            <>
              <Text style={styles.subtitle}>Enter the 6-digit OTP</Text>
              <TextInput
                style={styles.input}
                placeholder="123456"
                placeholderTextColor="#666"
                keyboardType="number-pad"
                value={verificationCode}
                onChangeText={setVerificationCode}
              />
              <TouchableOpacity style={styles.button} onPress={handleVerifyOTP} disabled={loading}>
                {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>Verify</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.subtitle}>Sign in with Phone</Text>
              <TextInput
                style={styles.input}
                placeholder="Full Name"
                placeholderTextColor="#666"
                value={name}
                onChangeText={setName}
              />
              <TextInput
                style={styles.input}
                placeholder="+92 300 1234567"
                placeholderTextColor="#666"
                keyboardType="phone-pad"
                value={phoneNumber}
                onChangeText={setPhoneNumber}
              />
              <TouchableOpacity style={styles.button} onPress={handleSendOTP} disabled={loading}>
                {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>Send OTP</Text>}
              </TouchableOpacity>
            </>
          )
        ) : (
          <>
            <Text style={styles.subtitle}>Sign in with Email</Text>
            <TextInput
              style={styles.input}
              placeholder="Full Name (for Sign Up)"
              placeholderTextColor="#666"
              value={name}
              onChangeText={setName}
            />
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#666"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#666"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <View style={styles.emailButtonContainer}>
              <TouchableOpacity style={[styles.button, styles.flexButton]} onPress={handleEmailLogin} disabled={loading}>
                {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>Log In</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, styles.flexButton, styles.signupButton]} onPress={handleEmailSignUp} disabled={loading}>
                {loading ? <ActivityIndicator color="#00FF00" /> : <Text style={styles.signupButtonText}>Sign Up</Text>}
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    width: '100%',
  },
  brandTitle: {
    fontSize: 42,
    fontWeight: '800',
    color: '#00FF00',
    textAlign: 'center',
    marginBottom: 4,
  },
  tagline: {
    fontSize: 16,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 40,
    opacity: 0.8,
  },
  subtitle: {
    fontSize: 18,
    color: '#ccc',
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#1e1e1e',
    color: '#ffffff',
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  button: {
    backgroundColor: '#00FF00',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#000000',
    fontSize: 18,
    fontWeight: 'bold',
  },
  toggleContainer: {
    flexDirection: 'row',
    marginBottom: 20,
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    overflow: 'hidden',
  },
  toggleTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  activeTab: {
    backgroundColor: '#333',
  },
  toggleText: {
    color: '#666',
    fontSize: 16,
    fontWeight: 'bold',
  },
  activeToggleText: {
    color: '#00FF00',
  },
  emailButtonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  flexButton: {
    flex: 1,
  },
  signupButton: {
    backgroundColor: '#1e1e1e',
    borderWidth: 1,
    borderColor: '#00FF00',
  },
  signupButtonText: {
    color: '#00FF00',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
