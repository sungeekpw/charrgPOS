module.exports = {
  expo: {
    name: "CharrgPOS",
    slug: "pos-mobile",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "pos-mobile",
    userInterfaceStyle: "dark",
    newArchEnabled: true,
    splash: {
      image: "./assets/images/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#0D0D14",
    },
    ios: {
      supportsTablet: false,
    },
    android: {
      package: "com.charrg.pos",
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#0D0D14",
      },
    },
    web: {
      favicon: "./assets/images/icon.png",
    },
    plugins: [
      ["expo-router", { origin: "https://replit.com/" }],
      "expo-font",
      "expo-web-browser",
      "./plugins/withNexGoSDK",
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: { origin: "https://replit.com/" },
      eas: { projectId: "9ebe8ee6-df50-422c-b909-c07924a8bdae" },
      // Charrg API config — read from plain env var names at build time
      charrgEnv:      process.env.CHARRG_ENV      ?? "dev",
      charrgDevUrl:   process.env.CHARRG_DEV_URL  ?? "",
      charrgTestUrl:  process.env.CHARRG_TEST_URL ?? "",
      charrgProdUrl:  process.env.CHARRG_PROD_URL ?? "",
      charrgDevToken:  process.env.CHARRG_DEV_TOKEN  ?? "",
      charrgTestToken: process.env.CHARRG_TEST_TOKEN ?? "",
      charrgProdToken: process.env.CHARRG_PROD_TOKEN ?? "",
    },
  },
};
