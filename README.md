# Mobile template

Minimal [Expo](https://expo.dev/) + React Native + TypeScript starter. Replace the placeholder UI in `App.tsx` with your app.

## Prerequisites

- Node.js 18+
- For device builds: Xcode (iOS) and/or Android Studio (Android)

## Setup

```bash
npm install
npx expo start
```

Use **i** / **a** in the terminal for iOS Simulator or Android emulator, or scan the QR code with Expo Go.

## Native projects

`ios/` and `android/` are generated when needed:

```bash
npx expo prebuild
npx expo run:ios
npx expo run:android
```

Change `bundleIdentifier` (iOS) and `package` (Android) in `app.json` before shipping.

## Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start Metro / Expo |
| `npm run ios` / `android` | Run on simulator/device (after prebuild) |
| `npm run lint` | ESLint |

Dependency versions align with the `sub` app (Expo SDK 55, same native-oriented plugins in `app.json`). Replace `bundleIdentifier`, Android `package`, and iCloud identifiers in `app.json` for your own Apple / Play setup before release.
