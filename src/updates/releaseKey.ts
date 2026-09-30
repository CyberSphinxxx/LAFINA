/**
 * The public half of the release signing key: base64 SPKI DER of an ECDSA
 * P-256 key. Public and safe to commit — it can only check signatures.
 *
 * Written once by `npm run release:keygen`. Installed copies only accept
 * updates signed by the key they were built with, so changing it means
 * everyone has to install the next APK by hand. Empty means this build does
 * not update itself.
 */
export const UPDATE_PUBLIC_KEY: string = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEqilaZ/G7QrgZzz8TW7EbSvYAmuqENbkvQVgMMTSn8OtYa7krWzKX4Vnq4dipBKnV8ln8u7U423ySfdW1yo+38g==';
