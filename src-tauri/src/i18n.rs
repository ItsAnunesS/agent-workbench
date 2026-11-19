use std::{collections::HashMap, sync::LazyLock};

static PORTUGUESE: LazyLock<HashMap<String, String>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../src/locales/pt.json"))
        .expect("The Portuguese catalog must be valid JSON")
});

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Locale {
    English,
    Portuguese,
}

impl Locale {
    pub fn from_option(value: Option<&str>) -> Self {
        match value {
            Some("pt" | "pt-PT" | "pt-BR") => Self::Portuguese,
            _ => Self::English,
        }
    }

    pub fn tag(self) -> &'static str {
        match self {
            Self::English => "en",
            Self::Portuguese => "pt",
        }
    }
}

// Persist canonical English messages. Translate only at response boundaries.
pub fn message(key: &str, locale: Locale) -> String {
    let canonical = if PORTUGUESE.contains_key(key) {
        key
    } else {
        PORTUGUESE
            .iter()
            .find(|(_, value)| value.as_str() == key)
            .map(|(key, _)| key.as_str())
            .unwrap_or(key)
    };
    let cleanup = "Docker did not confirm container cleanup. Check Docker before continuing.";
    if let Some(error) = canonical.strip_suffix(&format!(" {cleanup}")) {
        return format!("{} {}", message(error, locale), message(cleanup, locale));
    }
    match locale {
        Locale::English => canonical.to_owned(),
        Locale::Portuguese => PORTUGUESE
            .get(canonical)
            .map(String::as_str)
            .unwrap_or(canonical)
            .to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_english_and_only_accepts_supported_locales() {
        for value in [None, Some("en"), Some("fr"), Some("<script>")] {
            assert_eq!(Locale::from_option(value), Locale::English);
        }
        for value in ["pt", "pt-PT", "pt-BR"] {
            assert_eq!(Locale::from_option(Some(value)), Locale::Portuguese);
        }
    }

    #[test]
    fn localizes_api_errors_and_legacy_records_without_changing_unknown_text() {
        let key = "Invalid environment.";
        let localized = message(key, Locale::Portuguese);
        assert_ne!(localized, key);
        assert_eq!(message(&localized, Locale::English), key);
        assert_eq!(
            message("user-owned text", Locale::Portuguese),
            "user-owned text"
        );
    }

    #[test]
    fn catalogs_have_matching_keys_and_named_placeholders() {
        let english: HashMap<String, String> =
            serde_json::from_str(include_str!("../../src/locales/en.json")).unwrap();
        assert_eq!(english.len(), PORTUGUESE.len());
        for (key, value) in &*PORTUGUESE {
            assert!(english.contains_key(key), "Unknown key: {key}");
            for placeholder in key
                .split('{')
                .skip(1)
                .filter_map(|part| part.split_once('}').map(|(name, _)| name))
            {
                assert!(
                    value.contains(&format!("{{{placeholder}}}")),
                    "Missing placeholder in {key}"
                );
            }
        }
    }
}
