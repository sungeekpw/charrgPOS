const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const outputApk = path.join(distDir, "CharrgPOS.apk");

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, {
    stdio: "inherit",
    cwd: projectRoot,
    ...opts,
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  console.log("=== CharrgPOS APK Build ===\n");

  console.log("[1/3] Running expo prebuild...");
  run("npx expo prebuild --platform android --clean");

  console.log("\n[2/3] Building APK with Gradle...");
  const androidDir = path.join(projectRoot, "android");
  const gradlew = path.join(androidDir, "gradlew");

  if (!fs.existsSync(gradlew)) {
    console.error("ERROR: gradlew not found at", gradlew);
    process.exit(1);
  }

  fs.chmodSync(gradlew, "755");
  run("./gradlew assembleRelease", { cwd: androidDir });

  console.log("\n[3/3] Copying APK to dist/...");
  const apkCandidates = [
    path.join(
      androidDir,
      "app",
      "build",
      "outputs",
      "apk",
      "release",
      "app-release.apk"
    ),
    path.join(
      androidDir,
      "app",
      "build",
      "outputs",
      "apk",
      "release",
      "app-release-unsigned.apk"
    ),
    path.join(
      androidDir,
      "app",
      "build",
      "outputs",
      "apk",
      "debug",
      "app-debug.apk"
    ),
  ];

  const sourceApk = apkCandidates.find((p) => fs.existsSync(p));

  if (!sourceApk) {
    console.error("ERROR: No APK found. Checked:");
    apkCandidates.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
  }

  fs.mkdirSync(distDir, { recursive: true });
  fs.copyFileSync(sourceApk, outputApk);

  const stats = fs.statSync(outputApk);

  console.log("\n========================================");
  console.log("  APK Build Complete!");
  console.log("========================================");
  console.log(`  Source:  ${path.relative(projectRoot, sourceApk)}`);
  console.log(`  Output:  ${path.relative(projectRoot, outputApk)}`);
  console.log(`  Size:    ${formatSize(stats.size)}`);
  console.log("========================================\n");
}

main().catch((err) => {
  console.error("Build failed:", err.message);
  process.exit(1);
});
