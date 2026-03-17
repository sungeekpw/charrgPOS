const path = require("path");
const fs = require("fs");
const { withDangerousMod } = require("@expo/config-plugins");

function withNexGoSDK(config) {
  config = withNexGoAAR(config);
  config = withNexGoGradle(config);
  config = withNexGoMainApplication(config);
  config = withNexGoKotlinSource(config);
  return config;
}

// ─── 1. Copy the NexGo AAR into android/app/libs ─────────────────────────────
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

// ─── 2. Add fileTree dependency to android/app/build.gradle ──────────────────
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
      if (!gradle.includes(dep)) {
        gradle = gradle.replace(/dependencies\s*\{/, `dependencies {\n    ${dep}`);
        fs.writeFileSync(gradlePath, gradle);
        console.log("[withNexGoSDK] Added fileTree dep to build.gradle");
      }
      return config;
    },
  ]);
}

// ─── 3. Register NexGoSDKPackage in MainApplication.kt ───────────────────────
function withNexGoMainApplication(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const mainAppPath = path.join(
        projectRoot,
        "android", "app", "src", "main", "java", "com", "charrg", "pos",
        "MainApplication.kt"
      );
      if (!fs.existsSync(mainAppPath)) {
        console.warn("[withNexGoSDK] MainApplication.kt not found — skipping package registration.");
        return config;
      }

      let contents = fs.readFileSync(mainAppPath, "utf-8");

      // 3a. Add import after the package declaration line
      const importLine = "import com.charrg.pos.nexgo.NexGoSDKPackage";
      if (!contents.includes(importLine)) {
        contents = contents.replace(
          /^(package com\.charrg\.pos)\s*\n/m,
          `$1\n\n${importLine}\n`
        );
        console.log("[withNexGoSDK] Added NexGoSDKPackage import");
      }

      // 3b. Insert package after PackageList(this).packages — reliable anchor
      const anchor = "val packages = PackageList(this).packages";
      const addLine = "        packages.add(NexGoSDKPackage())";
      if (contents.includes(anchor) && !contents.includes(addLine)) {
        contents = contents.replace(anchor, `${anchor}\n${addLine}`);
        console.log("[withNexGoSDK] Registered NexGoSDKPackage");
      } else if (!contents.includes(anchor)) {
        // Fallback: try the mutable list pattern used in some Expo versions
        const altAnchor = "PackageList(this).packages";
        if (contents.includes(altAnchor) && !contents.includes(addLine)) {
          contents = contents.replace(
            altAnchor,
            `${altAnchor}.also { it.add(NexGoSDKPackage()) }`
          );
          console.log("[withNexGoSDK] Registered NexGoSDKPackage (alt pattern)");
        } else {
          console.warn("[withNexGoSDK] Could not find getPackages anchor in MainApplication.kt");
        }
      }

      fs.writeFileSync(mainAppPath, contents);
      return config;
    },
  ]);
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
        fs.copyFileSync(path.join(sourceDir, file), path.join(destDir, file));
        console.log(`[withNexGoSDK] Copied ${file}`);
      }
      return config;
    },
  ]);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function findAAR(projectRoot) {
  // Search attached_assets at repo root (walk up from project)
  let dir = projectRoot;
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, "attached_assets");
    if (fs.existsSync(candidate)) {
      const aar = fs.readdirSync(candidate).find(
        (f) => f.toLowerCase().includes("nexgo") && f.endsWith(".aar")
      );
      if (aar) return path.join(candidate, aar);
    }
    dir = path.dirname(dir);
  }
  return null;
}

module.exports = withNexGoSDK;
