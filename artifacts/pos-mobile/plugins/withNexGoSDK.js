const path = require("path");
const fs = require("fs");
const { withDangerousMod, withMainApplication } = require("@expo/config-plugins");

function withNexGoSDK(config) {
  config = withNexGoAAR(config);
  config = withNexGoGradle(config);
  config = withNexGoMainApplication(config);
  config = withNexGoKotlinSource(config);
  return config;
}

function withNexGoAAR(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const androidDir = path.join(projectRoot, "android");
      const libsDir = path.join(androidDir, "app", "libs");

      fs.mkdirSync(libsDir, { recursive: true });

      const workspaceRoot = findWorkspaceRoot(projectRoot);
      const aarSource = findAAR(workspaceRoot);

      if (aarSource) {
        const dest = path.join(libsDir, "nexgo-sdk.aar");
        fs.copyFileSync(aarSource, dest);
        console.log(`[withNexGoSDK] Copied AAR to ${dest}`);
      } else {
        console.warn(
          "[withNexGoSDK] NexGo AAR not found in attached_assets/. The build will fail without it."
        );
      }

      return config;
    },
  ]);
}

function withNexGoGradle(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const gradlePath = path.join(
        projectRoot,
        "android",
        "app",
        "build.gradle"
      );

      if (!fs.existsSync(gradlePath)) {
        return config;
      }

      let gradle = fs.readFileSync(gradlePath, "utf-8");
      const fileTreeDep =
        'implementation fileTree(dir: "libs", include: ["*.aar"])';

      if (!gradle.includes(fileTreeDep)) {
        gradle = gradle.replace(
          /dependencies\s*\{/,
          `dependencies {\n    ${fileTreeDep}`
        );
        fs.writeFileSync(gradlePath, gradle);
        console.log("[withNexGoSDK] Added fileTree dependency to build.gradle");
      }

      return config;
    },
  ]);
}

function withNexGoMainApplication(config) {
  return withMainApplication(config, (config) => {
    const contents = config.modResults.contents;
    const packageImport = "import com.charrg.pos.nexgo.NexGoSDKPackage";
    const packageAdd = "packages.add(NexGoSDKPackage())";

    if (!contents.includes(packageImport)) {
      config.modResults.contents = contents.replace(
        /^(package .+)$/m,
        `$1\n${packageImport}`
      );
    }

    if (!config.modResults.contents.includes(packageAdd)) {
      config.modResults.contents = config.modResults.contents.replace(
        /(override fun getPackages\(\).*?\{[\s\S]*?val packages\s*=\s*PackageList\(this\)\.packages)/,
        `$1\n        ${packageAdd}`
      );
    }

    return config;
  });
}

function withNexGoKotlinSource(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const destDir = path.join(
        projectRoot,
        "android",
        "app",
        "src",
        "main",
        "java",
        "com",
        "charrg",
        "pos",
        "nexgo"
      );

      fs.mkdirSync(destDir, { recursive: true });

      const sourceDir = path.join(projectRoot, "plugins", "native", "nexgo");

      if (!fs.existsSync(sourceDir)) {
        throw new Error(
          `[withNexGoSDK] Kotlin source directory not found: ${sourceDir}`
        );
      }

      const files = fs
        .readdirSync(sourceDir)
        .filter((f) => f.endsWith(".kt"));

      if (files.length === 0) {
        throw new Error(
          `[withNexGoSDK] No .kt files found in ${sourceDir}`
        );
      }

      for (const file of files) {
        fs.copyFileSync(
          path.join(sourceDir, file),
          path.join(destDir, file)
        );
        console.log(`[withNexGoSDK] Copied ${file} to ${destDir}`);
      }

      return config;
    },
  ]);
}

function findWorkspaceRoot(startDir) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return startDir;
}

function findAAR(workspaceRoot) {
  const attachedDir = path.join(workspaceRoot, "attached_assets");
  if (!fs.existsSync(attachedDir)) return null;

  const files = fs.readdirSync(attachedDir);
  const aar = files.find(
    (f) => f.toLowerCase().includes("nexgo") && f.endsWith(".aar")
  );

  return aar ? path.join(attachedDir, aar) : null;
}

module.exports = withNexGoSDK;
