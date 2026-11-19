use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::{ipc::Channel, State};

const RELEASE_URL: &str = "https://api.github.com/repos/ItsAnunesS/agent-workbench/releases/latest";
const DOWNLOAD_PREFIX: &str = "https://github.com/ItsAnunesS/agent-workbench/releases/download/";
const MAX_IMAGE_SIZE: u64 = 1024 * 1024 * 1024;

#[derive(Default)]
pub struct Updater {
    operation: tokio::sync::Mutex<()>,
    installed: AtomicBool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    supported: bool,
    version: Option<String>,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}

#[derive(Clone, Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    downloaded: u64,
    total: u64,
}

fn version(value: &str) -> Result<[u64; 3], String> {
    let parts = value
        .strip_prefix('v')
        .unwrap_or(value)
        .split('.')
        .collect::<Vec<_>>();
    if parts.len() != 3
        || parts.iter().any(|part| {
            part.is_empty()
                || !part.bytes().all(|byte| byte.is_ascii_digit())
                || (part.len() > 1 && part.starts_with('0'))
        })
    {
        return Err("The release version is invalid.".into());
    }
    Ok([
        parts[0]
            .parse()
            .map_err(|_| "The release version is invalid.")?,
        parts[1]
            .parse()
            .map_err(|_| "The release version is invalid.")?,
        parts[2]
            .parse()
            .map_err(|_| "The release version is invalid.")?,
    ])
}

fn select_asset(release: Release, current: &str) -> Result<Option<(String, Asset)>, String> {
    if release.draft || release.prerelease {
        return Ok(None);
    }
    if version(&release.tag_name)? <= version(current)? {
        return Ok(None);
    }
    let latest = release
        .tag_name
        .strip_prefix('v')
        .unwrap_or(&release.tag_name)
        .to_owned();
    let name = format!("Agent-Workbench_{latest}_amd64.AppImage");
    let url = format!("{DOWNLOAD_PREFIX}{}/{name}", release.tag_name);
    let asset = release
        .assets
        .into_iter()
        .find(|asset| asset.name == name)
        .ok_or("The release has no compatible AppImage.")?;
    if asset.browser_download_url != url || asset.size < 12 || asset.size > MAX_IMAGE_SIZE {
        return Err("The release download is invalid.".into());
    }
    expected_digest(&asset)?;
    Ok(Some((latest, asset)))
}

fn expected_digest(asset: &Asset) -> Result<String, String> {
    let digest = asset
        .digest
        .as_deref()
        .and_then(|value| value.strip_prefix("sha256:"))
        .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or("The release has no valid SHA-256 checksum.")?;
    Ok(digest.to_ascii_lowercase())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("Agent-Workbench/", env!("CARGO_PKG_VERSION")))
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(15 * 60))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                attempt.error("Too many download redirects")
            } else if matches!(
                attempt.url().host_str(),
                Some(
                    "github.com"
                        | "api.github.com"
                        | "release-assets.githubusercontent.com"
                        | "objects.githubusercontent.com"
                )
            ) {
                attempt.follow()
            } else {
                attempt.error("Untrusted download redirect")
            }
        }))
        .build()
        .map_err(|_| "Could not prepare the update connection.".into())
}

async fn latest_release(client: &reqwest::Client) -> Result<Option<(String, Asset)>, String> {
    let response = client
        .get(RELEASE_URL)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|_| "Could not check GitHub releases. Check your connection and try again.")?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if matches!(response.status().as_u16(), 403 | 429) {
        return Err("GitHub is limiting update checks. Try again later.".into());
    }
    let response = response
        .error_for_status()
        .map_err(|_| "Could not check GitHub releases. Check your connection and try again.")?;
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "Could not read the GitHub release.")?;
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("The GitHub release response is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let release =
        serde_json::from_slice(&bytes).map_err(|_| "Could not read the GitHub release.")?;
    select_asset(release, env!("CARGO_PKG_VERSION"))
}

fn image_path() -> Result<Option<PathBuf>, String> {
    if !cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        return Ok(None);
    }
    let Some(path) = std::env::var_os("APPIMAGE").map(PathBuf::from) else {
        return Ok(None);
    };
    if !path.is_absolute() {
        return Err("The installed AppImage is unavailable.".into());
    }
    let path = path
        .canonicalize()
        .map_err(|_| "The installed AppImage is unavailable.")?;
    if !path.is_file() {
        return Err("The installed AppImage is unavailable.".into());
    }
    Ok(Some(path))
}

// Cancellation, failed downloads and checksum failures must never leave a partial update.
struct TemporaryImage(PathBuf);
impl Drop for TemporaryImage {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[cfg(target_os = "linux")]
fn replace_image(
    path: &Path,
    temporary: &Path,
    original: &std::fs::Metadata,
) -> Result<(), String> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let current = std::fs::metadata(path)
        .map_err(|_| "The installed AppImage changed. Check for updates again.")?;
    if (
        original.dev(),
        original.ino(),
        original.len(),
        original.mtime(),
        original.mtime_nsec(),
    ) != (
        current.dev(),
        current.ino(),
        current.len(),
        current.mtime(),
        current.mtime_nsec(),
    ) {
        return Err("The installed AppImage changed. Check for updates again.".into());
    }
    std::fs::set_permissions(
        temporary,
        std::fs::Permissions::from_mode((original.mode() & 0o777) | 0o100),
    )
    .map_err(|_| "Could not make the updated AppImage executable.")?;
    // Both files share a directory/filesystem. Rename commits the verified image atomically.
    std::fs::rename(temporary, path).map_err(|_| {
        "Could not replace the AppImage. Check folder permissions and disk space.".into()
    })
}

#[cfg(not(target_os = "linux"))]
fn replace_image(_: &Path, _: &Path, _: &std::fs::Metadata) -> Result<(), String> {
    Err("In-app updates require the Linux x86_64 AppImage.".into())
}

async fn install_image(
    client: &reqwest::Client,
    path: &Path,
    asset: &Asset,
    progress: &Channel<DownloadProgress>,
) -> Result<(), String> {
    let original = std::fs::metadata(path).map_err(|_| "The installed AppImage is unavailable.")?;
    let parent = path
        .parent()
        .ok_or("The installed AppImage is unavailable.")?;
    let temporary =
        TemporaryImage(parent.join(format!(".agent-workbench-update-{}", uuid::Uuid::new_v4())));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary.0)
        .map_err(|_| "Could not prepare the update. Check folder permissions and disk space.")?;
    let response = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|_| "Could not download the update. Check your connection and try again.")?;
    let mut stream = response.bytes_stream();
    let mut hasher = Sha256::new();
    let mut downloaded = 0;
    let mut reported = 0;
    let mut header = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|_| "Could not download the update. Check your connection and try again.")?;
        downloaded += chunk.len() as u64;
        if downloaded > asset.size {
            return Err("The update size or checksum does not match the release.".into());
        }
        if header.len() < 12 {
            header.extend_from_slice(&chunk[..chunk.len().min(12 - header.len())]);
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|_| "Could not save the update. Check available disk space.")?;
        if downloaded - reported >= 1024 * 1024 || downloaded == asset.size {
            let _ = progress.send(DownloadProgress {
                downloaded,
                total: asset.size,
            });
            reported = downloaded;
        }
    }
    validate_image(
        downloaded,
        &format!("{:x}", hasher.finalize()),
        &header,
        asset,
    )?;
    file.sync_all()
        .map_err(|_| "Could not save the update. Check available disk space.")?;
    drop(file);
    replace_image(path, &temporary.0, &original)
}

fn validate_image(size: u64, digest: &str, header: &[u8], asset: &Asset) -> Result<(), String> {
    if size != asset.size
        || digest != expected_digest(asset)?
        || !header.starts_with(b"\x7fELF")
        || header.get(8..11) != Some(b"AI\x02")
    {
        return Err("The update size or checksum does not match the release.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn app_update_check(
    state: State<'_, Updater>,
    locale: Option<String>,
) -> Result<UpdateStatus, String> {
    let result = async {
        let _guard = state
            .operation
            .try_lock()
            .map_err(|_| "An update operation is already running.")?;
        let supported = image_path()?.is_some();
        let release = if supported && !state.installed.load(Ordering::SeqCst) {
            latest_release(&client()?).await?
        } else {
            None
        };
        Ok(UpdateStatus {
            supported,
            version: release.map(|(version, _)| version),
        })
    }
    .await;
    result.map_err(|error: String| {
        crate::i18n::message(&error, crate::i18n::Locale::from_option(locale.as_deref()))
    })
}

#[tauri::command]
pub async fn app_update_install(
    state: State<'_, Updater>,
    version: String,
    progress: Channel<DownloadProgress>,
    locale: Option<String>,
) -> Result<(), String> {
    let result = async {
        let _guard = state
            .operation
            .try_lock()
            .map_err(|_| "An update operation is already running.")?;
        if state.installed.load(Ordering::SeqCst) {
            return Err("The update is installed. Close and reopen the app.".into());
        }
        let path = image_path()?.ok_or("In-app updates require the Linux x86_64 AppImage.")?;
        let client = client()?;
        // Never accept a URL or digest supplied by the webview. Re-read the owning release.
        let (_, asset) = latest_release(&client)
            .await?
            .filter(|(latest, _)| latest == &version)
            .ok_or("The release changed. Check for updates again.")?;
        install_image(&client, &path, &asset, &progress).await?;
        state.installed.store(true, Ordering::SeqCst);
        Ok(())
    }
    .await;
    result.map_err(|error: String| {
        crate::i18n::message(&error, crate::i18n::Locale::from_option(locale.as_deref()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release() -> Release {
        Release {
            tag_name: "v1.10.0".into(),
            draft: false,
            prerelease: false,
            assets: vec![Asset {
                name: "Agent-Workbench_1.10.0_amd64.AppImage".into(),
                browser_download_url: format!(
                    "{DOWNLOAD_PREFIX}v1.10.0/Agent-Workbench_1.10.0_amd64.AppImage"
                ),
                size: 24,
                digest: Some(format!("sha256:{}", "ab".repeat(32))),
            }],
        }
    }

    #[test]
    fn selects_only_newer_stable_versions_numerically() {
        assert_eq!(
            select_asset(release(), "1.9.9").unwrap().unwrap().0,
            "1.10.0"
        );
        assert!(select_asset(release(), "1.10.0").unwrap().is_none());
        assert!(select_asset(release(), "2.0.0").unwrap().is_none());
        let mut draft = release();
        draft.draft = true;
        assert!(select_asset(draft, "1.0.0").unwrap().is_none());
        let mut prerelease = release();
        prerelease.prerelease = true;
        assert!(select_asset(prerelease, "1.0.0").unwrap().is_none());
        for invalid in [
            "1.0",
            "1.0.0-beta.1",
            "1.0.0/path",
            "01.0.0",
            "1.0.0+meta",
            "1.0.18446744073709551616",
        ] {
            assert!(version(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn rejects_missing_or_untrusted_assets_and_digests() {
        let mut missing = release();
        missing.assets.clear();
        assert!(select_asset(missing, "1.0.0").is_err());
        let mut untrusted = release();
        untrusted.assets[0].browser_download_url = "https://example.test/update".into();
        assert!(select_asset(untrusted, "1.0.0").is_err());
        for digest in [
            None,
            Some("sha256:bad".into()),
            Some(format!("sha512:{}", "ab".repeat(32))),
        ] {
            let mut invalid = release();
            invalid.assets[0].digest = digest;
            assert!(select_asset(invalid, "1.0.0").is_err());
        }
        let mut oversized = release();
        oversized.assets[0].size = MAX_IMAGE_SIZE + 1;
        assert!(select_asset(oversized, "1.0.0").is_err());
    }

    #[test]
    fn validates_size_checksum_and_appimage_header_independently() {
        let asset = release().assets.remove(0);
        let digest = "ab".repeat(32);
        let header = b"\x7fELF\x02\x01\x01\x00AI\x02\x00";
        assert!(validate_image(24, &digest, header, &asset).is_ok());
        assert!(validate_image(23, &digest, header, &asset).is_err());
        assert!(validate_image(24, &"cd".repeat(32), header, &asset).is_err());
        assert!(validate_image(24, &digest, b"<html>error</html>", &asset).is_err());
        assert!(validate_image(24, &digest, b"\x7fELF\x02\x01\x01\x00BAD\x00", &asset).is_err());
    }

    #[tokio::test]
    async fn serializes_update_operations() {
        let updater = Updater::default();
        let guard = updater.operation.try_lock().unwrap();
        assert!(updater.operation.try_lock().is_err());
        drop(guard);
        assert!(updater.operation.try_lock().is_ok());
    }

    #[cfg(target_os = "linux")]
    struct Fixture(PathBuf);
    #[cfg(target_os = "linux")]
    impl Fixture {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("awb-updater-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    #[cfg(target_os = "linux")]
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn replacement_preserves_path_permissions_and_open_original() {
        use std::{io::Read, os::unix::fs::PermissionsExt};
        let fixture = Fixture::new();
        let path = fixture.0.join("App with spaces.AppImage");
        std::fs::write(&path, b"original").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o750)).unwrap();
        let original = std::fs::metadata(&path).unwrap();
        let mut running = std::fs::File::open(&path).unwrap();
        let temporary = fixture.0.join("update");
        std::fs::write(&temporary, b"updated").unwrap();
        replace_image(&path, &temporary, &original).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"updated");
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o750
        );
        let mut original_bytes = Vec::new();
        running.read_to_end(&mut original_bytes).unwrap();
        assert_eq!(original_bytes, b"original");
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn external_replacement_aborts_without_overwriting_manager_update() {
        let fixture = Fixture::new();
        let path = fixture.0.join("app");
        std::fs::write(&path, b"original").unwrap();
        let original = std::fs::metadata(&path).unwrap();
        let manager_image = fixture.0.join("manager");
        std::fs::write(&manager_image, b"manager update").unwrap();
        std::fs::rename(manager_image, &path).unwrap();
        let temporary = fixture.0.join("update");
        std::fs::write(&temporary, b"in-app update").unwrap();
        assert!(replace_image(&path, &temporary, &original).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"manager update");
    }

    #[tokio::test]
    #[cfg(target_os = "linux")]
    async fn download_commits_verified_image_and_cleans_up_all_failure_modes() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let image = b"\x7fELF\x02\x01\x01\x00AI\x02\x00verified AppImage fixture";
        for failure in ["none", "checksum", "truncated", "oversized", "http"] {
            let fixture = Fixture::new();
            let path = fixture.0.join("Installed.AppImage");
            std::fs::write(&path, b"original").unwrap();
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let mut asset = release().assets.remove(0);
            asset.size = image.len() as u64;
            asset.digest = Some(format!("sha256:{:x}", Sha256::digest(image)));
            asset.browser_download_url = format!("http://{address}/fixture");
            if failure == "checksum" {
                asset.digest = Some(format!("sha256:{}", "00".repeat(32)));
            }
            if failure == "oversized" {
                asset.size -= 1;
            }
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0; 4096];
                socket.read(&mut request).await.unwrap();
                let code = if failure == "http" {
                    "500 Internal Server Error"
                } else {
                    "200 OK"
                };
                let body = if failure == "truncated" {
                    &image[..12]
                } else {
                    image.as_slice()
                };
                let header = format!(
                    "HTTP/1.1 {code}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    image.len()
                );
                socket.write_all(header.as_bytes()).await.unwrap();
                socket.write_all(body).await.unwrap();
            });
            let progress = Channel::new(|_| Ok(()));
            let result = install_image(&reqwest::Client::new(), &path, &asset, &progress).await;
            server.await.unwrap();
            if failure == "none" {
                assert!(result.is_ok(), "{result:?}");
                assert_eq!(std::fs::read(&path).unwrap(), image);
            } else {
                assert!(result.is_err(), "{failure}");
                assert_eq!(std::fs::read(&path).unwrap(), b"original", "{failure}");
            }
            assert_eq!(
                std::fs::read_dir(&fixture.0).unwrap().count(),
                1,
                "{failure}"
            );
        }
    }
}
