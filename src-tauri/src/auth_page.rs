use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};

const TEMPLATE: &str = include_str!("../resources/auth-callback.html");
const LOGO: &str =
    include_str!("../../assets/branding/brand-kit-v1/01-logos/svg/awb-symbol-orange.svg");
const SCRIPT: &str = "history.replaceState(null, '', location.pathname);";

pub enum CallbackState {
    Received,
    Denied,
    Invalid,
}

pub fn callback_response(state: CallbackState, locale: crate::i18n::Locale) -> String {
    let (status, eyebrow, title, description, step_mark, step_title, step_body) = match state {
        CallbackState::Received => (
            "200 OK", "CALLBACK RECEIVED", "Continue in the app.",
            "The OpenAI callback reached Agent Workbench. The app is validating your account authorization.",
            "2", "Return to your environment", "Connection confirmation appears in the account settings inside the app.",
        ),
        CallbackState::Denied => (
            "400 Bad Request", "CONNECTION NOT COMPLETED", "Shall we try again?",
            "Authorization was not completed at OpenAI. The previously connected account was preserved.",
            "↗", "Return to account settings", "In Agent Workbench, connect the account again and complete authorization in the browser.",
        ),
        CallbackState::Invalid => (
            "400 Bad Request", "UNRECOGNIZED REQUEST", "This connection is not valid.",
            "This page does not match the login in progress. It was not used to connect an account.",
            "↗", "Start the connection in the app", "Open the environment settings in Agent Workbench and start a new login.",
        ),
    };
    // The page contains only application-owned constants, never callback parameters.
    let body = TEMPLATE
        .replace("__LANG__", locale.tag())
        .replace(
            "__LOCAL__",
            &crate::i18n::message("Local connection", locale),
        )
        .replace(
            "__PRIVACY__",
            &crate::i18n::message(
                "This page is served by Agent Workbench on your computer. You can close this tab.",
                locale,
            ),
        )
        .replace(
            "__TAGLINE__",
            &crate::i18n::message("Your space to think and build.", locale),
        )
        .replace("__TITLE__", &crate::i18n::message(title, locale))
        .replace("__EYEBROW__", &crate::i18n::message(eyebrow, locale))
        .replace(
            "__DESCRIPTION__",
            &crate::i18n::message(description, locale),
        )
        .replace("__STEP_MARK__", step_mark)
        .replace("__STEP_TITLE__", &crate::i18n::message(step_title, locale))
        .replace("__STEP_BODY__", &crate::i18n::message(step_body, locale))
        .replace("__FAVICON__", &STANDARD.encode(LOGO.as_bytes()))
        .replace(
            "__FONT_REGULAR__",
            &STANDARD.encode(include_bytes!("../../public/fonts/open-sans-regular.woff")),
        )
        .replace(
            "__FONT_SEMIBOLD__",
            &STANDARD.encode(include_bytes!("../../public/fonts/open-sans-semibold.woff")),
        )
        .replace("__LOGO__", LOGO)
        .replace("__SCRIPT__", SCRIPT);
    let script_hash = STANDARD.encode(Sha256::digest(SCRIPT.as_bytes()));
    format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'sha256-{script_hash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_uses_the_login_language_without_changing_status_or_security_headers() {
        for locale in [
            crate::i18n::Locale::English,
            crate::i18n::Locale::Portuguese,
        ] {
            let response = callback_response(CallbackState::Received, locale);
            assert!(response.starts_with("HTTP/1.1 200 OK"));
            assert!(response.contains(&format!("lang=\"{}\"", locale.tag())));
            assert!(response.contains(&crate::i18n::message("Continue in the app.", locale)));
            assert!(!response.contains("__LOCAL__"));
            assert!(!response.contains("__PRIVACY__"));
            assert!(!response.contains("__TAGLINE__"));
            let (headers, body) = response.split_once("\r\n\r\n").unwrap();
            assert!(headers.contains(&format!("Content-Length: {}", body.len())));
            assert!(headers.contains("Cache-Control: no-store"));
        }
    }

    #[test]
    fn received_page_does_not_claim_identity_was_already_validated() {
        let response = callback_response(CallbackState::Received, crate::i18n::Locale::English);
        assert!(response.starts_with("HTTP/1.1 200 OK"));
        assert!(response.contains("is validating your account authorization"));
        assert!(response.contains("#FF791F"));
        assert!(!response.contains("__TITLE__"));
        assert!(!response.contains("Login completed"));
    }

    #[test]
    fn error_pages_use_error_status_and_safe_next_steps() {
        for state in [CallbackState::Denied, CallbackState::Invalid] {
            let response = callback_response(state, crate::i18n::Locale::English);
            assert!(response.starts_with("HTTP/1.1 400 Bad Request"));
            assert!(response.contains("Cache-Control: no-store"));
            assert!(!response.contains("CALLBACK RECEIVED"));
        }
    }

    #[test]
    fn cleanup_script_is_hash_authorized_and_content_length_is_utf8_bytes() {
        let response = callback_response(CallbackState::Received, crate::i18n::Locale::English);
        let (headers, body) = response.split_once("\r\n\r\n").unwrap();
        assert!(headers.contains(&format!(
            "script-src 'sha256-{}'",
            STANDARD.encode(Sha256::digest(SCRIPT.as_bytes()))
        )));
        let inline_script = body
            .split_once("<script>")
            .unwrap()
            .1
            .split_once("</script>")
            .unwrap()
            .0;
        assert!(headers.contains(&format!(
            "script-src 'sha256-{}'",
            STANDARD.encode(Sha256::digest(inline_script.as_bytes()))
        )));
        assert!(headers.contains(&format!("Content-Length: {}", body.len())));
        assert!(body.contains("history.replaceState(null, '', location.pathname)"));
        assert!(headers.contains("Referrer-Policy: no-referrer"));
        if let Ok(directory) = std::env::var("WORKBENCH_AUTH_PREVIEW_DIR") {
            let directory = std::path::Path::new(&directory);
            std::fs::create_dir_all(directory).unwrap();
            for (name, state) in [
                ("received", CallbackState::Received),
                ("denied", CallbackState::Denied),
                ("invalid", CallbackState::Invalid),
            ] {
                std::fs::write(
                    directory.join(format!("{name}.http")),
                    callback_response(state, crate::i18n::Locale::English),
                )
                .unwrap();
            }
        }
    }
}
