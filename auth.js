// Password hashing, session tokens, and input checks for Mindful Check-in
// accounts. Uses only the Web Crypto API, so it runs in Cloudflare Workers
// and in Node.js (tests).

const encoder = new TextEncoder();
// Cloudflare Workers caps PBKDF2 at 100,000 iterations.
const pbkdf2Iterations = 100000;

export const sessionLifetimeMs = 8 * 60 * 60 * 1000;
export const maxFailedLogins = 5;
export const failureWindowMs = 15 * 60 * 1000;

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text) {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}

export function randomSalt() {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashPassword(password, saltBase64) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: fromBase64(saltBase64),
      iterations: pbkdf2Iterations,
    },
    key,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

export function safeEqual(first, second) {
  const a = encoder.encode(String(first));
  const b = encoder.encode(String(second));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

export function newSessionToken() {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return toBase64(new Uint8Array(digest));
}

// Unambiguous characters (no 0/O, 1/I/L) so a code can be read out or typed.
const codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newDoctorCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const characters = Array.from(
    bytes,
    (byte) => codeAlphabet[byte % codeAlphabet.length],
  ).join("");
  return `${characters.slice(0, 4)}-${characters.slice(4)}`;
}

export function normalizeDoctorCode(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^(.{4})(.{4})$/, "$1-$2");
}

export function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidEmail(email) {
  return (
    email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
  );
}

export function passwordProblem(password) {
  if (typeof password !== "string") return "Please choose a password.";
  if (password.length < 10) return "Your password must be at least 10 characters.";
  if (password.length > 128) return "Your password must be 128 characters or fewer.";
  return null;
}

export function cleanName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}
