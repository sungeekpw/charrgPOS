# CharrgPOS — Android Build Guide

## Prerequisites

- Node.js 18+
- Java JDK 17+ (`java -version`)
- Android SDK (via Android Studio or `ANDROID_HOME` env var)
- pnpm

---

## One-time Setup (already done)

### 1. Release Keystore

A release keystore has been generated and stored at:

```
artifacts/pos-mobile/android-signing/charrg-release.p12
```

The credentials are stored as Replit Secrets:

| Secret         | Value                        |
|----------------|------------------------------|
| `KEYSTORE_PASS` | keystore + key password      |
| `KEY_ALIAS`    | `charrg`                     |
| `KEY_PASS`     | same as `KEYSTORE_PASS`      |

> **IMPORTANT:** Back up `android-signing/charrg-release.p12` somewhere safe (e.g. a password manager or secure cloud storage). If you lose this keystore you cannot publish updates to devices that have the current version installed.

### 2. NexGo AAR

Place the NexGo SDK AAR file in:

```
artifacts/pos-mobile/attached_assets/nexgo-sdk-<version>.aar
```

The build plugin will automatically copy it into the Android project during `expo prebuild`. Without the AAR the app builds and runs in **simulation mode** (card reads are mocked).

---

## Building the APK

From the workspace root:

```bash
pnpm --filter @workspace/pos-mobile run build:apk
```

Or from inside `artifacts/pos-mobile/`:

```bash
node scripts/build-apk.js
```

The signed APK will be written to:

```
artifacts/pos-mobile/dist/CharrgPOS.apk
```

Build steps:
1. `expo prebuild --platform android --clean` — generates the native Android project
2. Injects signing credentials into `gradle.properties` and `app/build.gradle`
3. `./gradlew assembleRelease` — compiles and signs the APK
4. Copies the APK to `dist/CharrgPOS.apk`

---

## Installing on NexGo Device

### Via ADB (recommended)

```bash
adb devices                           # verify device is connected
adb install dist/CharrgPOS.apk       # install
adb shell am start -n com.charrg.pos/.MainActivity  # launch
```

### Via File Transfer

1. Copy `dist/CharrgPOS.apk` to the device (USB or SD card)
2. Open the Files app on the NexGo device
3. Navigate to the APK and tap to install
4. If prompted, enable "Install from unknown sources" in Settings → Security

---

## Regenerating the Keystore

> Only do this if the keystore file is lost. Regenerating creates a new signing identity — existing installations cannot be updated with the new APK without uninstalling first.

```bash
rm artifacts/pos-mobile/android-signing/charrg-release.p12
pnpm --filter @workspace/pos-mobile run generate-keystore
```

Then update the Replit Secrets with the new credentials shown in the output.

---

## TCP Remote Payment Integration

The app listens on **port 9090** (enable via the Remote tab in the app).

Send a JSON request over TCP:

```json
{
  "transaction_id": "TXN-ABC123",
  "amount": 12.50,
  "tip": 2.00,
  "reference": "ORDER-001"
}
```

The device will prompt the customer to present their card and complete the transaction automatically. The result is sent back over the same TCP connection.

---

## Charrg API

Payments are sent to: `https://api.charrg.com/v1/charge`

Endpoint payload:
```json
{
  "transaction_id": "TXN-...",
  "amount": 1250,
  "tip": 200,
  "total": 1450,
  "card": {
    "entry_mode": "contactless",
    "last4": "1234",
    "brand": "Visa",
    "emv_data": "..."
  },
  "timestamp": "2026-03-16T..."
}
```
