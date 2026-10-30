pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    if getrandom::fill(&mut bytes).is_err() {
        panic!("operating system random number generator unavailable");
    }
    bytes
}

pub fn uuid_v4() -> String {
    let mut bytes: [u8; 16] = random_bytes();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let text = hex::encode(bytes);
    format!("{}-{}-{}-{}-{}", &text[0..8], &text[8..12], &text[12..16], &text[16..20], &text[20..32])
}

pub fn entrant_wire_id(entrant_number: i32) -> String {
    format!("e{entrant_number}")
}

pub fn entrant_db_id(wire_id: &str) -> Option<i32> {
    wire_id.strip_prefix('e').and_then(|digits| digits.parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuid_v4_has_version_and_variant() {
        let id = uuid_v4();
        assert_eq!(id.len(), 36);
        let parts: Vec<&str> = id.split('-').collect();
        assert_eq!(parts.iter().map(|part| part.len()).collect::<Vec<_>>(), vec![8, 4, 4, 4, 12]);
        assert!(parts[2].starts_with('4'));
        assert!(matches!(parts[3].chars().next(), Some('8' | '9' | 'a' | 'b')));
        assert_ne!(uuid_v4(), id);
    }

    #[test]
    fn entrant_ids_convert() {
        assert_eq!(entrant_wire_id(7), "e7");
        assert_eq!(entrant_db_id("e10"), Some(10));
        assert_eq!(entrant_db_id("x1"), None);
    }
}
