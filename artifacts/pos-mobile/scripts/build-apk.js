#!/usr/bin/env node
/**
 * CharrgPOS APK Build Script
 *
 * Runs expo prebuild → injects signing config → Gradle assembleRelease → dist/CharrgPOS.apk
 *
 * Required env vars (stored as Replit Secrets):
 *   KEYSTORE_PASS  - keystore and key password
 *   KEY_ALIAS      - signing key alias (default: "charrg")
 *   KEY_PASS       - key password (usually same as KEYSTORE_PASS)
 *
 * Keystore file: android-signing/charrg-release.p12
 * To regenerate the keystore: node scripts/generate-keystore.js
 *
 * NexGo AAR: place nexgo-sdk-*.aar in attached_assets/ before building.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const outputApk = path.join(distDir, "CharrgPOS.apk");
const signingDir = path.join(projectRoot, "android-signing");
const keystoreFile = path.join(signingDir, "charrg-release.p12");

const KEYSTORE_PASS = process.env.KEYSTORE_PASS;
const KEY_ALIAS = process.env.KEY_ALIAS || "charrg";
const KEY_PASS = process.env.KEY_PASS || KEYSTORE_PASS;

// ── helpers ───────────────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: projectRoot, ...opts });
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function findNexGoAAR() {
  const searchDirs = [
    path.join(projectRoot, "attached_assets"),
    projectRoot,
  ];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const f = fs.readdirSync(dir).find(
      (n) => n.endsWith(".aar") && n.toLowerCase().includes("nexgo")
    );
    if (f) return path.join(dir, f);
  }
  return null;
}

// ── preflight ─────────────────────────────────────────────────────────────────
function preflight() {
  // Support CI: decode base64 keystore from env if the file is missing
  if (!fs.existsSync(keystoreFile) && process.env.KEYSTORE_BASE64) {
    fs.mkdirSync(signingDir, { recursive: true });
    fs.writeFileSync(keystoreFile, Buffer.from(process.env.KEYSTORE_BASE64, "base64"));
    console.log("✓ Decoded keystore from KEYSTORE_BASE64");
  }

  const errors = [];

  if (!fs.existsSync(keystoreFile)) {
    errors.push(
      `Keystore not found: ${path.relative(projectRoot, keystoreFile)}\n` +
      `   → Run:  node scripts/generate-keystore.js`
    );
  }

  if (!KEYSTORE_PASS) {
    errors.push(
      "KEYSTORE_PASS env var is not set.\n" +
      "   → Add it to your Replit Secrets (KEYSTORE_PASS, KEY_ALIAS, KEY_PASS)"
    );
  }

  const aar = findNexGoAAR();
  if (aar) {
    console.log(`✓ NexGo AAR: ${path.relative(projectRoot, aar)}`);
  } else {
    console.warn(
      "\n⚠  NexGo AAR not found in attached_assets/\n" +
      "   The build will succeed but run in simulation mode.\n" +
      "   To enable hardware card reading:\n" +
      "     1. Place your nexgo-sdk-*.aar in: artifacts/pos-mobile/attached_assets/\n" +
      "     2. Re-run this build script.\n"
    );
  }

  if (errors.length > 0) {
    console.error("\n✗ Preflight failed:\n");
    errors.forEach((e) => console.error(`  • ${e}\n`));
    process.exit(1);
  }
}

// ── inject signing into gradle.properties ────────────────────────────────────
function writeSigningConfig(androidDir) {
  const propsPath = path.join(androidDir, "gradle.properties");
  let props = fs.existsSync(propsPath) ? fs.readFileSync(propsPath, "utf-8") : "";

  // Remove old block
  props = props.replace(/# CharrgPOS signing[\s\S]*?(?=\n\n|\n#|$)/m, "").trimEnd();

  props += `\n\n# CharrgPOS signing (written by build-apk.js)\n`;
  props += `CHARRG_STORE_FILE=${keystoreFile}\n`;
  props += `CHARRG_STORE_PASSWORD=${KEYSTORE_PASS}\n`;
  props += `CHARRG_KEY_ALIAS=${KEY_ALIAS}\n`;
  props += `CHARRG_KEY_PASSWORD=${KEY_PASS}\n`;

  fs.writeFileSync(propsPath, props);
  console.log("✓ Signing credentials written to gradle.properties");
}

// ── patch app/build.gradle with signingConfig stanza ─────────────────────────
function patchBuildGradle(androidDir) {
  const gradlePath = path.join(androidDir, "app", "build.gradle");
  if (!fs.existsSync(gradlePath)) return;

  let gradle = fs.readFileSync(gradlePath, "utf-8");

  const releaseBlock = `
        release {
            storeFile file(CHARRG_STORE_FILE)
            storePassword CHARRG_STORE_PASSWORD
            keyAlias CHARRG_KEY_ALIAS
            keyPassword CHARRG_KEY_PASSWORD
        }`;

  // If there's already a signingConfigs block but no release entry, inject one
  if (gradle.includes("signingConfigs {") && !gradle.includes("signingConfigs.release")) {
    gradle = gradle.replace(
      /signingConfigs\s*\{/,
      `signingConfigs {${releaseBlock}`
    );
  }

  // If there's no signingConfigs block at all, add one before buildTypes
  if (!gradle.includes("signingConfigs")) {
    const fullBlock = `    signingConfigs {${releaseBlock}\n    }\n    `;
    gradle = gradle.replace(/(\s*buildTypes\s*\{)/, `\n    ${fullBlock}$1`);
  }

  // In the release buildType: replace any reference to signingConfigs.debug
  // with signingConfigs.release (Expo prebuild defaults to debug for release)
  gradle = gradle.replace(
    /(buildTypes[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
    "$1signingConfig signingConfigs.release"
  );

  // If there's still no signingConfig line in the release buildType, add one
  if (!gradle.includes("signingConfig signingConfigs.release")) {
    gradle = gradle.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{)/,
      "$1\n            signingConfig signingConfigs.release"
    );
  }

  fs.writeFileSync(gradlePath, gradle);
  console.log("✓ app/build.gradle patched with release signingConfig");
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n╔══════════════════════════════════╗");
  console.log("║     CharrgPOS APK Build          ║");
  console.log("╚══════════════════════════════════╝");

  preflight();

  // Step 1: expo prebuild
  console.log("\n[1/3] Expo prebuild (generates android/ folder)...");
  run("npx expo prebuild --platform android --clean");

  const androidDir = path.join(projectRoot, "android");

  // Step 2: inject signing
  console.log("\n[2/3] Injecting release signing config...");
  writeSigningConfig(androidDir);
  patchBuildGradle(androidDir);

  // Step 3: Gradle build
  console.log("\n[3/3] Building signed APK...");
  const gradlew = path.join(androidDir, "gradlew");
  if (!fs.existsSync(gradlew)) {
    console.error("✗ gradlew not found — prebuild may have failed");
    process.exit(1);
  }
  fs.chmodSync(gradlew, "755");
  run("./gradlew assembleRelease", { cwd: androidDir });

  // Step 4: copy to dist/
  const apkCandidates = [
    path.join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk"),
    path.join(androidDir, "app", "build", "outputs", "apk", "release", "app-release-unsigned.apk"),
    path.join(androidDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk"),
  ];

  const sourceApk = apkCandidates.find((p) => fs.existsSync(p));
  if (!sourceApk) {
    console.error("✗ APK not found. Candidates checked:");
    apkCandidates.forEach((p) => console.error(`    ${p}`));
    process.exit(1);
  }

  fs.mkdirSync(distDir, { recursive: true });
  fs.copyFileSync(sourceApk, outputApk);
  const { size } = fs.statSync(outputApk);

  console.log("\n╔══════════════════════════════════╗");
  console.log("║       Build Complete!            ║");
  console.log("╚══════════════════════════════════╝");
  console.log(`  Output:  dist/CharrgPOS.apk  (${formatSize(size)})`);
  console.log(`  Signed:  ${KEY_ALIAS} (${path.basename(keystoreFile)})`);
  console.log("\nTo install on your NexGo device:");
  console.log("  adb install dist/CharrgPOS.apk");
  console.log("  (or transfer the APK to the device and open with Files)\n");
}

main().catch((err) => {
  console.error("\n✗ Build failed:", err.message);
  process.exit(1);
});
