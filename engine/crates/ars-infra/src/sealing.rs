use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};

use crate::{Context, Res};

#[derive(Clone)]
pub struct Keyring {
    keys: Vec<(String, [u8; 32])>,
    current: String,
}

impl Keyring {
    pub fn parse(keys: &str, current: &str) -> Res<Keyring> {
        let mut parsed = Vec::new();
        for entry in keys.split(',').map(str::trim).filter(|entry| !entry.is_empty()) {
            let (id, hex_key) = entry.split_once(':').context("SCRIPT_KEYS entries must be id:hex")?;
            let bytes = hex::decode(hex_key.trim()).context("SCRIPT_KEYS key is not hex")?;
            let key: [u8; 32] = bytes.try_into().map_err(|_| format!("key {id} must be 32 bytes (64 hex chars)"))?;
            parsed.push((id.trim().to_string(), key));
        }
        if parsed.is_empty() {
            return Err("SCRIPT_KEYS has no keys".into());
        }
        if !parsed.iter().any(|(id, _)| id == current) {
            return Err(format!("SCRIPT_KEY_ID {current} not present in SCRIPT_KEYS"));
        }
        Ok(Keyring { keys: parsed, current: current.to_string() })
    }

    pub fn from_env() -> Res<Keyring> {
        let keys = crate::config::required("SCRIPT_KEYS")?;
        let current = crate::config::string("SCRIPT_KEY_ID", "k1");
        Keyring::parse(&keys, &current)
    }

    pub fn current_id(&self) -> &str {
        &self.current
    }

    fn key(&self, id: &str) -> Res<&[u8; 32]> {
        self.keys.iter().find(|(key_id, _)| key_id == id).map(|(_, key)| key).context(&format!("unknown key id {id}"))
    }

    pub fn seal(&self, aad: &str, plaintext: &[u8]) -> Res<Vec<u8>> {
        let key = self.key(&self.current)?;
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "invalid key length".to_string())?;
        let nonce_bytes: [u8; 12] = crate::ids::random_bytes();
        let nonce = Nonce::try_from(&nonce_bytes[..]).map_err(|_| "invalid nonce".to_string())?;
        let ciphertext = cipher
            .encrypt(&nonce, Payload { msg: plaintext, aad: aad.as_bytes() })
            .map_err(|_| "encryption failed".to_string())?;
        let mut sealed = Vec::with_capacity(12 + ciphertext.len());
        sealed.extend_from_slice(&nonce_bytes);
        sealed.extend_from_slice(&ciphertext);
        Ok(sealed)
    }

    pub fn open(&self, key_id: &str, aad: &str, sealed: &[u8]) -> Res<Vec<u8>> {
        if sealed.len() < 12 + 16 {
            return Err("sealed blob too short".into());
        }
        let key = self.key(key_id)?;
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "invalid key length".to_string())?;
        let nonce = Nonce::try_from(&sealed[..12]).map_err(|_| "invalid nonce".to_string())?;
        cipher
            .decrypt(&nonce, Payload { msg: &sealed[12..], aad: aad.as_bytes() })
            .map_err(|_| format!("decryption failed (key {key_id})"))
    }
}

pub fn compress(bytes: &[u8]) -> Res<Vec<u8>> {
    zstd::bulk::compress(bytes, 9).context("zstd compress")
}

pub fn decompress(bytes: &[u8]) -> Res<Vec<u8>> {
    zstd::stream::decode_all(bytes).context("zstd decompress")
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEYS: &str = "k1:000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f,k0:ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";

    #[test]
    fn seals_and_opens_with_race_id_as_aad() {
        let keyring = Keyring::parse(KEYS, "k1").expect("keyring");
        let script = compress(b"{\"raceId\":\"42\"}").expect("compress");
        let sealed = keyring.seal("42", &script).expect("seal");
        assert_eq!(sealed.len(), 12 + script.len() + 16);
        let opened = keyring.open("k1", "42", &sealed).expect("open");
        assert_eq!(decompress(&opened).expect("decompress"), b"{\"raceId\":\"42\"}");
        assert!(keyring.open("k1", "43", &sealed).is_err());
        assert!(keyring.open("k0", "42", &sealed).is_err());
        let mut tampered = sealed.clone();
        tampered[20] ^= 1;
        assert!(keyring.open("k1", "42", &tampered).is_err());
    }

    #[test]
    fn rejects_bad_key_config() {
        assert!(Keyring::parse(KEYS, "k9").is_err());
        assert!(Keyring::parse("k1:abcd", "k1").is_err());
        assert!(Keyring::parse("", "k1").is_err());
    }
}
