import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, Alert } from 'react-native';
import MapView, { Marker, Callout } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { useAuth } from '../context/AuthContext';
import { collection, onSnapshot, addDoc, deleteDoc, doc, query, where, orderBy, serverTimestamp, Timestamp, updateDoc, increment } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import { Modal, TextInput, ActivityIndicator } from 'react-native';
import * as Haptics from 'expo-haptics';

const haversineDistance = (coords1, coords2) => {
  const toRad = x => (x * Math.PI) / 180;
  const R = 6371; // km
  const dLat = toRad(coords2.latitude - coords1.latitude);
  const dLon = toRad(coords2.longitude - coords1.longitude);
  const lat1 = toRad(coords1.latitude);
  const lat2 = toRad(coords2.latitude);

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const aClamped = Math.max(0, Math.min(1, a));
  const c = 2 * Math.atan2(Math.sqrt(aClamped), Math.sqrt(1 - aClamped));
  return R * c;
};

export default function HomeScreen() {
  const { signOut, userName, user, saveUserName } = useAuth();
  const [location, setLocation] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [pins, setPins] = useState([]);
  const [cooldown, setCooldown] = useState(false);
  const [selectedPin, setSelectedPin] = useState(null);
  const [activeWarningPin, setActiveWarningPin] = useState(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [followMode, setFollowMode] = useState(true);
  const [showWarning, setShowWarning] = useState(false);
  
  const pinsRef = useRef(pins);
  const mapRef = useRef(null);
  const lastWarningTime = useRef(0);

  useEffect(() => {
    if (followMode && location && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: location.latitude,
        longitude: location.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 500);
    }
  }, [location, followMode]);

  useEffect(() => {
    if (user && !userName) {
      setShowProfileModal(true);
    }
  }, [user, userName]);

  useEffect(() => {
    pinsRef.current = pins;
  }, [pins]);

  useEffect(() => {
    let locationSubscription;

    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission to access location was denied');
        return;
      }

      locationSubscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
        (loc) => {
          setLocation(loc.coords);
        }
      );
    })();

    return () => locationSubscription?.remove();
  }, []);

  // Proximity check effect (fires when location or pins change)
  useEffect(() => {
    if (!location) return;

    let nearPin = null;
    let minDistance = Infinity;

    pins.forEach(pin => {
      const dist = haversineDistance(location, pin.coordinate);
      if (dist <= 0.5 && dist < minDistance) { // 500 meters
        nearPin = pin;
        minDistance = dist;
      }
    });

    if (nearPin) {
      const now = Date.now();
      if (now - lastWarningTime.current > 120000) { // 2 minutes cooldown
        lastWarningTime.current = now;
        setActiveWarningPin(nearPin);
        setShowWarning(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        
        Speech.stop();
        Speech.speak(`Heads up ${userName || 'rider'}, traffic police reported within 500 meters. Please ensure your helmet is on.`, {
          volume: 1.0, pitch: 1.0, rate: 1.0
        });
        
        setTimeout(() => {
          setShowWarning(false);
        }, 15000); // Hide banner after 15 seconds
      }
    }
  }, [location, pins, userName]);

  useEffect(() => {
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    
    // Ordered by newest first
    const q = query(
      collection(db, 'police_pins'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedPins = [];
      const now = Date.now();
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const pinTime = data.timestamp || 0;
        if (now - pinTime < TWO_HOURS) {
          fetchedPins.push({
            id: docSnap.id,
            ...data
          });
        }
      });
      setPins(fetchedPins);
    }, (error) => {
      console.error("Error fetching pins: ", error);
    });

    const interval = setInterval(() => {
      setPins(currentPins => {
        const now = Date.now();
        return currentPins.filter(p => (now - (p.timestamp || 0)) < TWO_HOURS);
      });
    }, 60000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const handleBannerStillThere = async () => {
    if (!activeWarningPin) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowWarning(false);
    
    try {
      const pinRef = doc(db, 'police_pins', activeWarningPin.id);
      await updateDoc(pinRef, {
        upvotes: increment(1)
      });
    } catch (error) {
      console.error("Error upvoting from banner: ", error);
    }
  };

  const handleBannerClear = async () => {
    if (!activeWarningPin) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowWarning(false);

    try {
      const currentClearReports = activeWarningPin.clearReports || 0;
      if (currentClearReports >= 2) {
        // Strike 3: Delete pin
        await deleteDoc(doc(db, 'police_pins', activeWarningPin.id));
        setSelectedPin(null);
      } else {
        const pinRef = doc(db, 'police_pins', activeWarningPin.id);
        await updateDoc(pinRef, {
          clearReports: increment(1)
        });
      }
    } catch (error) {
      console.error("Error clearing pin from banner: ", error);
    }
  };

  const handleReportPolice = async () => {
    if (cooldown) return;

    try {
      let currentLoc = await Location.getCurrentPositionAsync({});
      const newPinData = {
        timestamp: Date.now(),
        createdAt: serverTimestamp(),
        userName: userName || 'Rider', // Display name of reporter
        creatorName: userName || 'Rider',
        creatorId: auth.currentUser ? auth.currentUser.uid : 'unknown',
        upvotes: 0,
        downvotes: 0,
        clearReports: 0,
        coordinate: {
          latitude: currentLoc.coords.latitude,
          longitude: currentLoc.coords.longitude,
        },
      };
      
      await addDoc(collection(db, 'police_pins'), newPinData);
      
      setCooldown(true);
      const timer = setTimeout(() => {
        setCooldown(false);
      }, 10 * 60 * 1000); // 10 minutes

      return () => clearTimeout(timer);
    } catch (e) {
      alert("Could not post to database. " + e.message);
    }
  };

  const handleUpvote = async (pinId) => {
    try {
      const pinRef = doc(db, 'police_pins', pinId);
      await updateDoc(pinRef, {
        upvotes: increment(1)
      });
      // Selected pin state will update automatically via onSnapshot
    } catch (error) {
      console.error("Error upvoting: ", error);
    }
  };

  const handleSaveProfile = async () => {
    if (newName.trim().length < 2) {
      Alert.alert("Error", "Please enter a valid name");
      return;
    }
    setProfileLoading(true);
    await saveUserName(newName);
    setProfileLoading(false);
    setShowProfileModal(false);
  };

  const handleDownvotePin = async (pin) => {
    try {
      const currentDownvotes = pin.downvotes || 0;
      if (currentDownvotes >= 2) {
        // Strike 3 (2 existing + current vote): Community verified false, auto-delete.
        await deleteDoc(doc(db, 'police_pins', pin.id));
        setSelectedPin(null);
      } else {
        const pinRef = doc(db, 'police_pins', pin.id);
        await updateDoc(pinRef, {
          downvotes: increment(1)
        });
        // Optimistically update the local view so the user sees the button feedback
        setSelectedPin({ ...pin, downvotes: currentDownvotes + 1 });
      }
    } catch (error) {
      console.error("Error downvoting pin: ", error);
    }
  };

  const handleDeletePin = async (pin) => {
    if (pin.creatorId && auth.currentUser && pin.creatorId !== auth.currentUser.uid) {
      Alert.alert("Permission Denied", "You can only remove pins that you reported.");
      return;
    }
    try {
      await deleteDoc(doc(db, 'police_pins', pin.id));
      if (pin.creatorId === auth.currentUser?.uid) {
        setCooldown(false);
      }
      setSelectedPin(null);
    } catch (error) {
      console.error("Error deleting pin: ", error);
    }
  };

  const darkMapStyle = [
    { "elementType": "geometry", "stylers": [{ "color": "#242f3e" }] },
    { "elementType": "labels.text.fill", "stylers": [{ "color": "#746855" }] },
    { "elementType": "labels.text.stroke", "stylers": [{ "color": "#242f3e" }] },
    { "featureType": "administrative.locality", "elementType": "labels.text.fill", "stylers": [{ "color": "#d59563" }] },
    { "featureType": "poi", "elementType": "labels.text.fill", "stylers": [{ "color": "#d59563" }] },
    { "featureType": "poi.park", "elementType": "geometry", "stylers": [{ "color": "#263c3f" }] },
    { "featureType": "poi.park", "elementType": "labels.text.fill", "stylers": [{ "color": "#6b9a76" }] },
    { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#38414e" }] },
    { "featureType": "road", "elementType": "geometry.stroke", "stylers": [{ "color": "#212a37" }] },
    { "featureType": "road", "elementType": "labels.text.fill", "stylers": [{ "color": "#9ca5b3" }] },
    { "featureType": "road.highway", "elementType": "geometry", "stylers": [{ "color": "#746855" }] },
    { "featureType": "road.highway", "elementType": "geometry.stroke", "stylers": [{ "color": "#1f2835" }] },
    { "featureType": "road.highway", "elementType": "labels.text.fill", "stylers": [{ "color": "#f3d19c" }] },
    { "featureType": "transit", "elementType": "geometry", "stylers": [{ "color": "#2f3948" }] },
    { "featureType": "transit.station", "elementType": "labels.text.fill", "stylers": [{ "color": "#d59563" }] },
    { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#17263c" }] },
    { "featureType": "water", "elementType": "labels.text.fill", "stylers": [{ "color": "#515c6d" }] },
    { "featureType": "water", "elementType": "labels.text.stroke", "stylers": [{ "color": "#17263c" }] }
  ];

  return (
    <View style={styles.container}>
      {location ? (
        <MapView
          ref={mapRef}
          style={styles.map}
          customMapStyle={darkMapStyle}
          showsUserLocation={true}
          onPanDrag={() => setFollowMode(false)}
          initialRegion={{
            latitude: location.latitude,
            longitude: location.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
        >
          {pins.map((pin) => (
            <Marker
              key={pin.id}
              coordinate={pin.coordinate}
              pinColor="red"
              onPress={() => setSelectedPin(pin)}
            />
          ))}
        </MapView>
      ) : (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>
            {errorMsg ? errorMsg : "Locating..."}
          </Text>
        </View>
      )}

      {/* Pin Detail Overlay (Bottom Sheet Style) */}
      {selectedPin && (
        <View style={styles.pinDetailContainer}>
          <View style={styles.pinDetailContent}>
            <Text style={styles.pinDetailTitle}>Police Spotted!</Text>
            <Text style={styles.pinDetailText}>Reported by: {selectedPin.creatorName || 'Rider'}</Text>
            <Text style={styles.pinDetailText}>Confirmed: {selectedPin.upvotes || 0} times</Text>
            
            <View style={styles.pinActions}>
              <TouchableOpacity 
                style={styles.upvoteButton} 
                onPress={() => handleUpvote(selectedPin.id)}
              >
                <Text style={styles.upvoteButtonText}>Still There 👍</Text>
              </TouchableOpacity>
              
              {user && selectedPin.creatorId === user.uid ? (
                <TouchableOpacity 
                  style={[styles.removeButton, { backgroundColor: '#e53935', borderColor: '#e53935' }]} 
                  onPress={() => handleDeletePin(selectedPin)}
                >
                  <Text style={styles.removeButtonText}>Delete My Report 🗑️</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity 
                  style={styles.removeButton} 
                  onPress={() => handleDownvotePin(selectedPin)}
                >
                  <Text style={styles.removeButtonText}>Not There ❌</Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity 
              style={styles.closeDetailButton} 
              onPress={() => setSelectedPin(null)}
            >
              <Text style={styles.closeDetailText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Profile Setup Modal */}
      <Modal visible={showProfileModal} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Set Your Rider Name</Text>
            <Text style={styles.modalSubtitle}>This helps other riders trust your reports.</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. SpeedRider"
              placeholderTextColor="#666"
              value={newName}
              onChangeText={setNewName}
            />
            <TouchableOpacity 
              style={styles.modalButton} 
              onPress={handleSaveProfile}
              disabled={profileLoading}
            >
              {profileLoading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.modalButtonText}>Save & Join</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Warning Banner */}
      {showWarning && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>WARNING: Police Reported Ahead!</Text>
          {activeWarningPin && (
            <View style={styles.bannerActions}>
              <TouchableOpacity style={styles.bannerStillThereBtn} onPress={handleBannerStillThere}>
                <Text style={styles.bannerStillThereBtnText}>Still There 👍</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.bannerClearBtn} onPress={handleBannerClear}>
                <Text style={styles.bannerClearBtnText}>Clear ❌</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* Greeting Header */}
      <View style={styles.headerContainer}>
        <Text style={styles.greetingText}>Welcome, {userName || 'Rider'}!</Text>
      </View>

      {!selectedPin && (
        <TouchableOpacity 
          style={[styles.reportButton, cooldown && styles.reportButtonDisabled]} 
          onPress={handleReportPolice}
          disabled={cooldown}
        >
          <Text style={styles.reportButtonText}>
            {cooldown ? 'Cooldown (10m)' : 'Report Police'}
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.logoutButton} onPress={signOut}>
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>

      {/* Live Tracking Toggle Button */}
      {location && (
        <TouchableOpacity 
          style={[styles.followButton, followMode && styles.followButtonActive]} 
          onPress={() => setFollowMode(true)}
        >
          <Text style={styles.followButtonText}>🎯</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  map: { width: Dimensions.get('window').width, height: Dimensions.get('window').height },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#ffffff', fontSize: 18 },
  reportButton: {
    position: 'absolute', bottom: 50, alignSelf: 'center',
    backgroundColor: '#e53935', paddingVertical: 18, paddingHorizontal: 40,
    borderRadius: 30, width: 250, alignItems: 'center',
    elevation: 8, shadowColor: '#000', shadowOpacity: 0.3, shadowOffset: { width: 0, height: 4 },
  },
  reportButtonDisabled: {
    backgroundColor: '#757575',
  },
  reportButtonText: { color: '#ffffff', fontSize: 20, fontWeight: 'bold' },
  logoutButton: {
    position: 'absolute', top: 60, right: 20,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingVertical: 10, paddingHorizontal: 16,
    borderRadius: 8, borderWidth: 1, borderColor: '#333',
  },
  logoutText: { color: '#ffffff', fontWeight: 'bold' },
  headerContainer: {
    position: 'absolute',
    top: 60,
    left: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  greetingText: {
    color: '#00FF00',
    fontWeight: 'bold',
    fontSize: 16,
  },
  followButton: {
    position: 'absolute',
    right: 20,
    bottom: 150,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 12,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
    width: 60,
    height: 60,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
  },
  followButtonActive: {
    backgroundColor: '#00FF00',
    borderColor: '#00FF00',
  },
  followButtonText: {
    fontSize: 24,
  },
  // Modal & Overlay Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#333',
  },
  modalTitle: {
    color: '#00FF00',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubtitle: {
    color: '#ccc',
    fontSize: 14,
    marginBottom: 24,
    textAlign: 'center',
  },
  modalInput: {
    backgroundColor: '#121212',
    color: '#fff',
    borderRadius: 8,
    padding: 16,
    fontSize: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#444',
  },
  modalButton: {
    backgroundColor: '#00FF00',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 18,
  },
  pinDetailContainer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    padding: 16,
    backgroundColor: 'transparent',
  },
  pinDetailContent: {
    backgroundColor: '#1e1e1e',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#333',
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 10,
  },
  pinDetailTitle: {
    color: '#e53935',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  pinDetailText: {
    color: '#ccc',
    fontSize: 14,
    marginBottom: 2,
  },
  pinActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  upvoteButton: {
    backgroundColor: '#00FF00',
    flex: 1,
    marginRight: 8,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upvoteButtonText: {
    color: '#000',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  removeButton: {
    backgroundColor: '#333',
    flex: 1,
    marginLeft: 8,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#444',
  },
  removeButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  closeDetailButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  closeDetailText: {
    color: '#666',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  warningBanner: {
    position: 'absolute',
    top: 60,
    width: '90%',
    alignSelf: 'center',
    backgroundColor: '#ff0000',
    padding: 20,
    borderRadius: 16,
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 1000,
  },
  warningText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 22,
    textAlign: 'center',
    marginBottom: 15,
  },
  bannerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  bannerStillThereBtn: {
    flex: 1,
    backgroundColor: '#00FF00',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerClearBtn: {
    flex: 1,
    backgroundColor: '#b71c1c',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#ff5252',
  },
  bannerStillThereBtnText: {
    color: '#000',
    fontWeight: '900',
    fontSize: 18,
  },
  bannerClearBtnText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 18,
  },
});
