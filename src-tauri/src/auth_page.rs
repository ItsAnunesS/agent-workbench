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

pub fn callback_response(state: CallbackState) -> String {
    let (status, eyebrow, title, description, step_mark, step_title, step_body) = match state {
        CallbackState::Received => (
            "200 OK", "RETORNO RECEBIDO", "Continua na aplicação.",
            "O retorno da OpenAI chegou ao Agent Workbench. A aplicação está a validar a autorização da tua conta.",
            "2", "Volta ao teu ambiente", "A confirmação da ligação aparece nas definições da conta, dentro da aplicação.",
        ),
        CallbackState::Denied => (
            "400 Bad Request", "LIGAÇÃO NÃO CONCLUÍDA", "Vamos tentar novamente?",
            "A autorização não foi concluída na OpenAI. A conta anteriormente ligada ao ambiente foi preservada.",
            "↗", "Volta às definições da conta", "No Agent Workbench, inicia novamente a ligação e conclui a autorização no navegador.",
        ),
        CallbackState::Invalid => (
            "400 Bad Request", "PEDIDO NÃO RECONHECIDO", "Esta ligação não é válida.",
            "Esta página não corresponde ao login em curso. Não foi utilizada para ligar uma conta.",
            "↗", "Inicia a ligação na aplicação", "Abre as definições do ambiente no Agent Workbench e começa um novo login.",
        ),
    };
    // The page contains only application-owned constants, never callback parameters.
    let body = TEMPLATE
        .replace("__TITLE__", title)
        .replace("__EYEBROW__", eyebrow)
        .replace("__DESCRIPTION__", description)
        .replace("__STEP_MARK__", step_mark)
        .replace("__STEP_TITLE__", step_title)
        .replace("__STEP_BODY__", step_body)
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
    fn received_page_does_not_claim_identity_was_already_validated() {
        let response = callback_response(CallbackState::Received);
        assert!(response.starts_with("HTTP/1.1 200 OK"));
        assert!(response.contains("está a validar a autorização"));
        assert!(response.contains("#FF791F"));
        assert!(!response.contains("__TITLE__"));
        assert!(!response.contains("Login concluído"));
    }

    #[test]
    fn error_pages_use_error_status_and_safe_next_steps() {
        for state in [CallbackState::Denied, CallbackState::Invalid] {
            let response = callback_response(state);
            assert!(response.starts_with("HTTP/1.1 400 Bad Request"));
            assert!(response.contains("Cache-Control: no-store"));
            assert!(!response.contains("RETORNO RECEBIDO"));
        }
    }

    #[test]
    fn cleanup_script_is_hash_authorized_and_content_length_is_utf8_bytes() {
        let response = callback_response(CallbackState::Received);
        let (headers, body) = response.split_once("\r\n\r\n").unwrap();
        assert!(headers.contains(&format!(
            "script-src 'sha256-{}'",
            STANDARD.encode(Sha256::digest(SCRIPT.as_bytes()))
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
                    callback_response(state),
                )
                .unwrap();
            }
        }
    }
}
