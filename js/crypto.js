// Криптография на WebCrypto (встроена в браузер, без сторонних библиотек).
// Схема: случайный ключ данных AES-256-GCM шифрует все данные.
// Ключ данных хранится только в «обёрнутом» виде: ключом из PIN (PBKDF2-SHA256, 600 000 итераций)
// и, опционально, ключом из passkey (Face ID / Touch ID, расширение WebAuthn PRF → HKDF).

const subtle = crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const PBKDF2_ITER = 600_000;

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export function b64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function keyFromPassword(password, salt, iterations = PBKDF2_ITER, usages = ['wrapKey', 'unwrapKey']) {
  const base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

export async function keyFromPrf(prfOutput) {
  const base = await subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('balans-prf-v1'), info: new Uint8Array(0) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

export const generateDataKey = () =>
  subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

export async function wrapKey(dataKey, kek) {
  const iv = randomBytes(12);
  const wrapped = await subtle.wrapKey('raw', dataKey, kek, { name: 'AES-GCM', iv });
  return { iv: b64(iv), key: b64(wrapped) };
}

export function unwrapKey(w, kek) {
  return subtle.unwrapKey(
    'raw',
    unb64(w.key),
    kek,
    { name: 'AES-GCM', iv: unb64(w.iv) },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function encryptJSON(key, obj) {
  const iv = randomBytes(12);
  const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), data: b64(data) };
}

export async function decryptJSON(key, blob) {
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.data));
  return JSON.parse(dec.decode(plain));
}

// ---------- Резервная копия (отдельный пароль) ----------
export async function encryptBackup(obj, password) {
  const salt = randomBytes(16);
  const key = await keyFromPassword(password, salt, PBKDF2_ITER, ['encrypt', 'decrypt']);
  const blob = await encryptJSON(key, obj);
  return { format: 'balans-backup', v: 1, kdf: 'PBKDF2-SHA256', iter: PBKDF2_ITER, salt: b64(salt), ...blob };
}

export async function decryptBackup(file, password) {
  if (file?.format !== 'balans-backup') throw new Error('Это не файл резервной копии «Баланса»');
  const key = await keyFromPassword(password, unb64(file.salt), file.iter, ['encrypt', 'decrypt']);
  try {
    return await decryptJSON(key, file);
  } catch {
    throw new Error('Неверный пароль или файл повреждён');
  }
}
