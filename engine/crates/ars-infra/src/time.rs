use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 { shifted } else { shifted - 146_096 } / 146_097;
    let day_of_era = (shifted - era * 146_097) as u64;
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era as i64 + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_index + 2) / 5 + 1) as u32;
    let month = if month_index < 10 { month_index + 3 } else { month_index - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = (year - era * 400) as u64;
    let month = month as u64;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day as u64 - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era as i64 - 719_468
}

pub fn unix_millis(time: SystemTime) -> i64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as i64,
        Err(err) => -(err.duration().as_millis() as i64),
    }
}

pub fn from_unix_millis(millis: i64) -> SystemTime {
    if millis >= 0 {
        UNIX_EPOCH + Duration::from_millis(millis as u64)
    } else {
        UNIX_EPOCH - Duration::from_millis(millis.unsigned_abs())
    }
}

pub fn format_rfc3339(time: SystemTime) -> String {
    let millis = unix_millis(time);
    let days = millis.div_euclid(86_400_000);
    let rest = millis.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    let hours = rest / 3_600_000;
    let minutes = (rest / 60_000) % 60;
    let seconds = (rest / 1000) % 60;
    let fraction = rest % 1000;
    format!("{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}.{fraction:03}Z")
}

pub fn now_rfc3339() -> String {
    format_rfc3339(SystemTime::now())
}

pub fn parse_rfc3339(text: &str) -> Option<SystemTime> {
    let text = text.trim();
    if text.len() < 19 {
        return None;
    }
    let number = |range: std::ops::Range<usize>| text.get(range)?.parse::<i64>().ok();
    let year = number(0..4)?;
    let month = number(5..7)? as u32;
    let day = number(8..10)? as u32;
    let hours = number(11..13)?;
    let minutes = number(14..16)?;
    let seconds = number(17..19)?;
    let mut rest = &text[19..];
    let mut millis = 0i64;
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits: String = fraction.chars().take_while(|character| character.is_ascii_digit()).collect();
        rest = &fraction[digits.len()..];
        let padded = format!("{digits:0<3}");
        millis = padded[..3].parse().ok()?;
    }
    let offset_minutes = match rest {
        "Z" | "z" | "" => 0,
        offset if offset.len() == 6 => {
            let sign = if offset.starts_with('-') { -1 } else { 1 };
            let offset_hours: i64 = offset[1..3].parse().ok()?;
            let offset_mins: i64 = offset[4..6].parse().ok()?;
            sign * (offset_hours * 60 + offset_mins)
        }
        _ => return None,
    };
    let days = days_from_civil(year, month, day);
    let total = ((days * 24 + hours) * 60 + minutes - offset_minutes) * 60 + seconds;
    Some(from_unix_millis(total * 1000 + millis))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_and_parses_rfc3339_with_millis() {
        let time = from_unix_millis(1_793_362_800_123);
        let text = format_rfc3339(time);
        assert_eq!(text, "2026-10-30T12:20:00.123Z");
        assert_eq!(parse_rfc3339(&text), Some(time));
        assert_eq!(parse_rfc3339("2026-10-30T14:20:00.123+02:00"), Some(time));
        assert_eq!(parse_rfc3339("2026-10-30T12:20:00Z"), Some(from_unix_millis(1_793_362_800_000)));
        assert_eq!(format_rfc3339(from_unix_millis(951_782_400_000)), "2000-02-29T00:00:00.000Z");
        assert_eq!(parse_rfc3339("garbage"), None);
    }
}
