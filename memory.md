# Rasta Clear - Internal Memory & Architecture

## System Architecture
Rasta Clear is a real-time mobile application built with React Native and Expo. It relies on Firebase for backend services:
- **Firebase Auth**: Manages user sessions, with persistence handled by `@react-native-async-storage/async-storage`.
- **Firebase Firestore**: Stores and syncs "police pins" in real-time across all connected clients.
- **Client-Side Processing**: The app fetches active pins and calculates proximity to the user's current device location locally to determine when to trigger alerts.

## Folder Structure
```
/
├── .env                  # Local environment variables (EXPO_PUBLIC_*)
├── App.js                # Entry point
├── app.json              # Expo configuration
├── package.json          # Dependencies
└── src/
    ├── context/
    │   └── AuthContext.js    # Authentication state and logic
    ├── screens/
    │   ├── HomeScreen.js     # Main map, proximity alerts, and pin logic
    │   └── LoginScreen.js    # User authentication screen
    └── firebaseConfig.js     # Firebase initialization and exports
```

## Tech Stack
- **Framework**: React Native (Expo)
- **Backend**: Firebase (Firestore, Authentication)
- **Maps**: `react-native-maps`
- **Device Sensors/Features**: 
  - `expo-location` (GPS tracking)
  - `expo-speech` (Voice alerts)
  - `expo-haptics` (Vibration feedback)

## Core Logic & Algorithms

### Haversine Formula
The app uses the Haversine formula to calculate the great-circle distance between the user's current GPS coordinates and the coordinates of each active pin. The formula takes the Earth's radius (6371 km) and the latitude/longitude of both points (converted to radians) to calculate the distance. If the distance is less than or equal to 0.5 km (500 meters), a proximity alert is triggered.

### 2-Minute Cooldown Logic
To prevent spamming the user with continuous alerts when they are stopped near a pin or driving slowly, a cooldown mechanism is implemented. When a proximity alert triggers, a timestamp is recorded. The app requires `Date.now() - lastWarningTime > 120000` (120,000 milliseconds = 2 minutes) before it will trigger another voice and haptic alert.

### 2-Hour Auto-Expiration
Pins are ephemeral and intended only for real-time use. A constant `TWO_HOURS = 2 * 60 * 60 * 1000` is defined. The Firestore listener only fetches and retains pins where `Date.now() - pin.timestamp < TWO_HOURS`. Additionally, a local interval runs every 60 seconds to prune any pins from the map that have aged past the 2-hour mark.

### 3-Strike Community "Clear" Logic
The application uses a community-driven moderation system to maintain the accuracy of the map. Users can report that a pin is no longer valid by tapping "Clear ❌" on the warning banner or "Not There ❌" on the pin details. If a pin receives 3 clear reports or downvotes (the logic checks if `currentClearReports >= 2` or `currentDownvotes >= 2` before processing the current user's request), the document is permanently deleted from Firestore.

## Firebase Schema

**Collection:** `police_pins`
- `timestamp` (Number): Epoch time of creation (e.g., `Date.now()`)
- `createdAt` (Timestamp): Firestore server timestamp
- `userName` (String): Display name of the reporting user
- `creatorName` (String): Display name of the reporting user
- `creatorId` (String): Firebase Auth UID of the reporter
- `upvotes` (Number): Count of "Still There" confirmations
- `downvotes` (Number): Count of "Not There" reports (from map)
- `clearReports` (Number): Count of "Clear" reports (from banner)
- `coordinate` (Object):
  - `latitude` (Number)
  - `longitude` (Number)
