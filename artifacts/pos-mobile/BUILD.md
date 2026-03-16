# CharrgPOS — Android Build Guide

Building an Android APK requires Java + the full Android SDK (several GB). Rather than
installing all of that locally, we use **EAS Build** — Expo's cloud build service — which
handles everything in the cloud and returns a ready-to-install APK.

---

## Quick Start

### 1. Install EAS CLI

```bash
npm install -g eas-cli
```

### 2. Log in to Expo

```bash
eas login
```

You'll need a free account at https://expo.dev — create one if you don't have one.

### 3. Link the project to your Expo account

```bash
cd artifacts/pos-mobile
eas init --id <your-project-id>
```

Or just run the build — EAS will prompt you to create a project automatically.

### 4. Build the APK in the cloud

```bash
pnpm --filter @workspace/pos-mobile run build:eas:cloud
```

EAS will:
- Upload your source code to Expo's build servers
- Run `expo prebuild` + Gradle in the cloud (no local Android SDK needed)
- Sign the APK with the keystore in `android-signing/charrg-release.p12`
- Give you a download link when done (~5–15 min)

---

## Credentials & Keystore

The release keystore lives at:

```
artifacts/pos-mobile/android-signing/charrg-release.p12
```

`credentials.json` (gitignored) tells EAS to use this local keystore instead of
generating its own. It's recreated automatically — do not commit it.

Keystore details:
| Field           | Value                    |
|-----------------|--------------------------|
| Alias           | `charrg`                 |
| Password        | stored as Replit Secret  |

> **Back up `charrg-release.p12` securely.** Losing it means you cannot push
> updates to devices that have the current version installed.

---

## NexGo AAR

Place the NexGo SDK AAR in:

```
artifacts/pos-mobile/attached_assets/nexgo-sdk-<version>.aar
```

It will be bundled automatically during the build. Without it, the app builds and
runs in **simulation mode** (card reads are mocked — safe for UI/API testing).

---

## Installing on the NexGo Device

After the build completes, download `CharrgPOS.apk` from the EAS dashboard link.

### Via ADB

```bash
adb devices                        # confirm device is connected
adb install CharrgPOS.apk
```

### Via File Transfer

Copy the APK to the device over USB or SD card, open the Files app, tap the APK,
and follow the install prompt. Enable "Install from unknown sources" if asked.

---

## Build Profiles

| Profile   | Command                                       | Output     |
|-----------|-----------------------------------------------|------------|
| `release` | `pnpm --filter @workspace/pos-mobile run build:eas:cloud` | Signed APK |
| `preview` | `eas build -p android --profile preview`      | Internal APK |
| `dev`     | `eas build -p android --profile development`  | Dev client |

---

## TCP Remote Payment Integration

The app listens on **port 9090** (enable via the Remote tab in the app).

Send a JSON payload over TCP:

```json
{
  "transaction_id": "TXN-ABC123",
  "amount": 12.50,
  "tip": 2.00,
  "reference": "ORDER-001"
}
```

The result is sent back over the same TCP connection.

---

## Charrg API

Payments POST to `https://api.charrg.com/v1/charge`.

```json
{
  "transaction_id": "TXN-...",
  "amount": 1250,
  "tip": 200,
  "total": 1450,
  "card": { "entry_mode": "contactless", "last4": "1234", "brand": "Visa" },
  "timestamp": "2026-03-16T..."
}
```
