// «Сейф»: держит ключ данных только в памяти, пока приложение разблокировано.
import * as db from './db.js';
import * as c from './crypto.js';

let dataKey = null;
let state = null;
let saving = Promise.resolve();

const META = 'meta';
const DATA = 'data';

export const isUnlocked = () => !!dataKey;
export const getState = () => state;
export const getMeta = () => db.get(META);

export async function isSetUp() {
  return !!(await db.get(META));
}

export async function setup(pin, initialState) {
  const salt = c.randomBytes(16);
  const kek = await c.keyFromPassword(pin, salt);
  dataKey = await c.generateDataKey();
  const meta = {
    v: 1,
    pin: { salt: c.b64(salt), iter: c.PBKDF2_ITER, wrapped: await c.wrapKey(dataKey, kek) },
    bio: null,
    fails: 0,
  };
  await db.set(META, meta);
  state = initialState;
  await save();
  db.requestPersistence();
}

async function loadState() {
  const blob = await db.get(DATA);
  state = await c.decryptJSON(dataKey, blob);
}

export async function unlockWithPin(pin) {
  const meta = await db.get(META);
  const kek = await c.keyFromPassword(pin, c.unb64(meta.pin.salt), meta.pin.iter);
  try {
    dataKey = await c.unwrapKey(meta.pin.wrapped, kek);
  } catch {
    meta.fails = (meta.fails || 0) + 1;
    meta.lastFail = Date.now();
    await db.set(META, meta);
    throw new Error('wrong-pin');
  }
  if (meta.fails) { meta.fails = 0; await db.set(META, meta); }
  await loadState();
  db.requestPersistence();
}

/** Сколько секунд ждать перед следующей попыткой ввода PIN. */
export function lockoutSeconds(meta) {
  const f = meta?.fails || 0;
  if (f < 5) return 0;
  const wait = Math.min(30 * 2 ** (f - 5), 3600);
  const left = Math.ceil((meta.lastFail + wait * 1000 - Date.now()) / 1000);
  return Math.max(0, left);
}

export function save() {
  if (!dataKey || !state) return Promise.reject(new Error('locked'));
  const key = dataKey;
  const snapshot = state;
  saving = saving.then(async () => {
    const blob = await c.encryptJSON(key, snapshot);
    await db.set(DATA, blob);
  });
  return saving;
}

export function lock() {
  dataKey = null;
  state = null;
}

export async function changePin(newPin) {
  if (!dataKey) throw new Error('locked');
  const meta = await db.get(META);
  const salt = c.randomBytes(16);
  const kek = await c.keyFromPassword(newPin, salt);
  meta.pin = { salt: c.b64(salt), iter: c.PBKDF2_ITER, wrapped: await c.wrapKey(dataKey, kek) };
  await db.set(META, meta);
}

/** Заменить все данные (импорт из резервной копии). */
export async function replaceState(newState) {
  state = newState;
  await save();
}

export async function wipe() {
  lock();
  await db.clearAll();
}

// ---------- Face ID / Touch ID через passkey + WebAuthn PRF ----------
export function biometricsAvailable() {
  return !!(window.PublicKeyCredential && navigator.credentials?.create);
}

function rpId() {
  return location.hostname;
}

export async function enableBiometrics() {
  if (!dataKey) throw new Error('locked');
  const prfSalt = c.randomBytes(32);
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Баланс', id: rpId() },
      user: { id: c.randomBytes(16), name: 'Баланс', displayName: 'Баланс — вход' },
      challenge: c.randomBytes(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'required' },
      extensions: { prf: { eval: { first: prfSalt } } },
      hints: ['client-device'], // просим хранить ключ на этом устройстве (iCloud Keychain), а не во внешнем менеджере
      timeout: 60000,
    },
  });
  let out = cred.getClientExtensionResults()?.prf?.results?.first;
  if (!out) {
    out = await prfAssert(new Uint8Array(cred.rawId), prfSalt);
  }
  if (!out) throw new Error('prf-unsupported');
  const kek = await c.keyFromPrf(out);
  const meta = await db.get(META);
  meta.bio = { credId: c.b64(cred.rawId), prfSalt: c.b64(prfSalt), wrapped: await c.wrapKey(dataKey, kek) };
  await db.set(META, meta);
}

async function prfAssert(credId, prfSalt) {
  const a = await navigator.credentials.get({
    publicKey: {
      challenge: c.randomBytes(32),
      rpId: rpId(),
      allowCredentials: [{ type: 'public-key', id: credId }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: prfSalt } } },
      hints: ['client-device'],
      timeout: 60000,
    },
  });
  return a.getClientExtensionResults()?.prf?.results?.first || null;
}

export async function unlockWithBiometrics() {
  const meta = await db.get(META);
  if (!meta?.bio) throw new Error('no-bio');
  const out = await prfAssert(c.unb64(meta.bio.credId), c.unb64(meta.bio.prfSalt));
  if (!out) throw new Error('prf-unsupported');
  const kek = await c.keyFromPrf(out);
  dataKey = await c.unwrapKey(meta.bio.wrapped, kek);
  await loadState();
}

export async function disableBiometrics() {
  const meta = await db.get(META);
  meta.bio = null;
  await db.set(META, meta);
}
