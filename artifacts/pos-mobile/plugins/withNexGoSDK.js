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

// ─── 2. Add fileTree dep to android/app/build.gradle ─────────────────────────
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
      // compileOnly: the NexGo SDK is a system library pre-installed on NexGo
      // devices. We only need the AAR for compilation — bundling it (implementation)
      // causes a class-loading conflict with the system library at runtime.
      const dep = 'compileOnly fileTree(dir: "libs", include: ["*.aar"])';
      // Remove any previous implementation entry for this AAR
      const oldDep = 'implementation fileTree(dir: "libs", include: ["*.aar"])';
      if (gradle.includes(oldDep)) {
        gradle = gradle.replace(oldDep, dep);
        fs.writeFileSync(gradlePath, gradle);
        console.log("[withNexGoSDK] Replaced implementation → compileOnly for NexGo AAR");
      } else if (!gradle.includes(dep)) {
        gradle = gradle.replace(
          /dependencies\s*\{/,
          `dependencies {\n    ${dep}`
        );
        fs.writeFileSync(gradlePath, gradle);
        console.log("[withNexGoSDK] Added compileOnly fileTree dep to build.gradle");
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
    //     Expo generates: val packages = PackageList(this).packages
    //     We insert our package right after that assignment.
    const anchor = "val packages = PackageList(this).packages";
    const addLine = "        packages.add(NexGoSDKPackage())";

    if (src.includes(anchor) && !src.includes(addLine)) {
      src = src.replace(anchor, `${anchor}\n${addLine}`);
      console.log("[withNexGoSDK] Registered NexGoSDKPackage in getPackages()");
    } else if (!src.includes(anchor)) {
      console.warn(
        "[withNexGoSDK] Could not find PackageList anchor in MainApplication.kt — " +
        "NexGoSDKPackage was NOT registered. Full contents logged below:\n" +
        src.slice(0, 600)
      );
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
