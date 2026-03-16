#!/usr/bin/env node
/**
 * Generates a PKCS12 release keystore for CharrgPOS.
 * Run once: node scripts/generate-keystore.js
 * Output: android-signing/charrg-release.p12 + .env.keystore (base64 for CI)
 */

const forge = require("node-forge");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const projectRoot = path.resolve(__dirname, "..");
const signingDir = path.join(projectRoot, "android-signing");
const keystorePath = path.join(signingDir, "charrg-release.p12");
const envPath = path.join(signingDir, ".keystore-env");

if (fs.existsSync(keystorePath)) {
  console.log("✓ Keystore already exists at:", keystorePath);
  console.log("  Delete android-signing/charrg-release.p12 to regenerate.");
  process.exit(0);
}

fs.mkdirSync(signingDir, { recursive: true });

const STORE_PASS = process.env.KEYSTORE_PASS || "CharrgPOS2025Release!";
const KEY_ALIAS = "charrg";

console.log("Generating RSA 2048 key pair...");
const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();

cert.publicKey = keys.publicKey;
cert.serialNumber = "01";
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 25);

const attrs = [
  { name: "commonName", value: "CharrgPOS" },
  { name: "organizationName", value: "Charrg" },
  { name: "countryName", value: "US" },
];
cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.sign(keys.privateKey, forge.md.sha256.create());

console.log("Building PKCS12 keystore...");
const p12 = forge.pkcs12.toPkcs12Asn1(
  keys.privateKey,
  [cert],
  STORE_PASS,
  {
    algorithm: "3des",
    friendlyName: KEY_ALIAS,
  }
);

const p12Der = forge.asn1.toDer(p12).getBytes();
const p12Buffer = Buffer.from(p12Der, "binary");

fs.writeFileSync(keystorePath, p12Buffer);
console.log("✓ Keystore written to:", keystorePath);

const b64 = p12Buffer.toString("base64");
const envContent = [
  `KEYSTORE_BASE64=${b64}`,
  `KEYSTORE_PASS=${STORE_PASS}`,
  `KEY_ALIAS=${KEY_ALIAS}`,
  `KEY_PASS=${STORE_PASS}`,
].join("\n");

fs.writeFileSync(envPath, envContent, { mode: 0o600 });
console.log("✓ Credentials written to:", envPath);
console.log("\nNext steps:");
console.log("  1. Store KEYSTORE_BASE64, KEYSTORE_PASS, KEY_ALIAS, KEY_PASS as Replit Secrets");
console.log("  2. Delete android-signing/.keystore-env (it has plaintext secrets)");
console.log("  3. Run: pnpm --filter @workspace/pos-mobile run build:apk");
