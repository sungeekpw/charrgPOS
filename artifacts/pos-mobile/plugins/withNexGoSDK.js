const path = require("path");
const fs = require("fs");
const {
  withDangerousMod,
  withMainApplication,
} = require("@expo/config-plugins");

function withNexGoSDK(config) {
  config = withNexGoAAR(config);
  config = withNexGoGradle(config);
  config = withNexGoMainApplication(config);
  config = withNexGoKotlinSource(config);
  config = withNexGoAssets(config);
  return config;
}

// ─── 1. Copy NexGo AAR into android/app/libs ─────────────────────────────────
function withNexGoAAR(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const libsDir = path.join(projectRoot, "android", "app", "libs");
      fs.mkdirSync(libsDir, { recursive: true });

      const aarSource = findAAR(projectRoot);
      if (aarSource) {
        const dest = path.join(libsDir, "nexgo-sdk.aar");
        fs.copyFileSync(aarSource, dest);
        console.log(`[withNexGoSDK] Copied AAR → ${dest}`);
      } else {
        console.warn("[withNexGoSDK] NexGo AAR not found — build will fail.");
      }
      return config;
    },
  ]);
}

// ─── 2. Ensure implementation fileTree dep in android/app/build.gradle ───────
//
// The NexGo SDK AAR must be bundled into the APK via `implementation`, not
// `compileOnly`. Using `compileOnly` omits the SDK classes from the APK's DEX,
// causing a NoClassDefFoundError at runtime and silently preventing the native
// module from loading. The NexGo SDK README explicitly uses `compile`
// (the deprecated alias for `implementation`).
function withNexGoGradle(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const gradlePath = path.join(
        config.modRequest.projectRoot,
        "android", "app", "build.gradle"
      );
      if (!fs.existsSync(gradlePath)) return config;

      let gradle = fs.readFileSync(gradlePath, "utf-8");
      const dep = 'implementation fileTree(dir: "libs", include: ["*.aar"])';
      // Remove any stale compileOnly entry if a previous build left one
      const stale = 'compileOnly fileTree(dir: "libs", include: ["*.aar"])';
      if (gradle.includes(stale)) {
        gradle = gradle.replace(stale, dep);
        fs.writeFileSync(gradlePath, gradle);
        console.log("[withNexGoSDK] Replaced compileOnly → implementation for NexGo AAR");
      } else if (!gradle.includes(dep)) {
        gradle = gradle.replace(
          /dependencies\s*\{/,
          `dependencies {\n    ${dep}`
        );
        fs.writeFileSync(gradlePath, gradle);
        console.log("[withNexGoSDK] Added implementation fileTree dep to build.gradle");
      } else {
        console.log("[withNexGoSDK] implementation fileTree dep already present — no change needed");
      }
      return config;
    },
  ]);
}

// ─── 3. Register NexGoSDKPackage via the official withMainApplication mod ─────
//
// withMainApplication hands us the already-generated MainApplication.kt content
// in config.modResults.contents — no file path guessing needed.
function withNexGoMainApplication(config) {
  return withMainApplication(config, (config) => {
    let src = config.modResults.contents;

    // 3a. Add import after the package declaration
    const importLine = "import com.charrg.pos.nexgo.NexGoSDKPackage";
    if (!src.includes(importLine)) {
      // Insert after "package com.charrg.pos" (the very first line)
      src = src.replace(
        /^(package\s+\S+)/m,
        `$1\n${importLine}`
      );
      console.log("[withNexGoSDK] Added NexGoSDKPackage import");
    }

    // 3b. Add the package into getPackages().
    //
    //     React Native ≤ 0.72 generates:
    //       val packages = PackageList(this).packages
    //       packages.add(...)
    //
    //     React Native ≥ 0.73 generates:
    //       PackageList(this).packages.apply {
    //         add(...)
    //       }
    //
    //     Handle both forms.
    const alreadyRegistered = src.includes("NexGoSDKPackage()");

    if (!alreadyRegistered) {
      // Pattern A — legacy style
      const anchorA = "val packages = PackageList(this).packages";
      // Pattern B — modern apply {} style
      const anchorB = "PackageList(this).packages.apply {";

      if (src.includes(anchorA)) {
        src = src.replace(anchorA, `${anchorA}\n        packages.add(NexGoSDKPackage())`);
        console.log("[withNexGoSDK] Registered NexGoSDKPackage in getPackages() (legacy val-packages style)");
      } else if (src.includes(anchorB)) {
        src = src.replace(anchorB, `${anchorB}\n              add(NexGoSDKPackage())`);
        console.log("[withNexGoSDK] Registered NexGoSDKPackage in getPackages() (apply{} style)");
      } else {
        console.warn(
          "[withNexGoSDK] Could not find PackageList anchor in MainApplication.kt — " +
          "NexGoSDKPackage was NOT registered. Full contents:\n" +
          src.slice(0, 800)
        );
      }
    } else {
      console.log("[withNexGoSDK] NexGoSDKPackage already present in getPackages() — skipping.");
    }

    config.modResults.contents = src;
    return config;
  });
}

// ─── 4. Copy NexGoSDKModule.kt + NexGoSDKPackage.kt into the android source ──
function withNexGoKotlinSource(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const destDir = path.join(
        projectRoot,
        "android", "app", "src", "main", "java",
        "com", "charrg", "pos", "nexgo"
      );
      fs.mkdirSync(destDir, { recursive: true });

      const sourceDir = path.join(projectRoot, "plugins", "native", "nexgo");
      if (!fs.existsSync(sourceDir)) {
        throw new Error(`[withNexGoSDK] Source dir not found: ${sourceDir}`);
      }

      const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".kt"));
      if (files.length === 0) {
        throw new Error(`[withNexGoSDK] No .kt files in ${sourceDir}`);
      }

      for (const file of files) {
        const src = path.join(sourceDir, file);
        const dst = path.join(destDir, file);
        fs.copyFileSync(src, dst);
        console.log(`[withNexGoSDK] Copied ${file} → nexgo/`);
      }
      return config;
    },
  ]);
}

// ─── 5. Copy EMV CAPK/AID JSON assets into android/app/src/main/assets ───────
function withNexGoAssets(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const destDir = path.join(
        projectRoot,
        "android", "app", "src", "main", "assets"
      );
      fs.mkdirSync(destDir, { recursive: true });

      const sourceDir = path.join(projectRoot, "plugins", "native", "nexgo", "assets");
      if (!fs.existsSync(sourceDir)) {
        console.warn(`[withNexGoSDK] CAPK assets dir not found: ${sourceDir}`);
        return config;
      }

      const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const src = path.join(sourceDir, file);
        const dst = path.join(destDir, file);
        fs.copyFileSync(src, dst);
        console.log(`[withNexGoSDK] Copied ${file} → assets/`);
      }
      return config;
    },
  ]);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function findAAR(projectRoot) {
  let dir = projectRoot;
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, "attached_assets");
    if (fs.existsSync(candidate)) {
      const aar = fs.readdirSync(candidate).find(
        (f) => f.toLowerCase().includes("nexgo") && f.endsWith(".aar")
      );
      if (aar) return path.join(candidate, aar);
    }
    // Also check directly inside the project
    const local = path.join(dir, "nexgo-sdk.aar");
    if (fs.existsSync(local)) return local;
    dir = path.dirname(dir);
  }
  return null;
}

module.exports = withNexGoSDK;
