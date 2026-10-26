// Looking things up on the web for a film, once the person has said yes.
//
// Made here rather than in the page, whose content policy reaches no host on
// the internet:
//
//   web_fetch { url } -> { ok, reason, status, finalUrl, contentType, text, truncated }
//       one public page, read as text, at most a megabyte.
//   web_search (search.rs) reads the search services through the same reader.
//
// An address a model chose may name a host that leads to this computer or its
// private network. The host is resolved once, every address it answers with
// is judged, and the connection is pinned to those addresses, so it goes where
// the check was made; the certificate is still checked against the host's
// name. Each redirect is a new address and goes through all of it again.

use serde::Serialize;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::time::Duration;
use ureq::config::Config;
use ureq::http::Uri;
use ureq::tls::{TlsConfig, TlsProvider};
use ureq::unversioned::resolver::{ResolvedSocketAddrs, Resolver};
use ureq::unversioned::transport::{DefaultConnector, NextTimeout};
use ureq::Agent;


const MAX_REDIRECTS: usize = 5;
const MAX_BYTES: u64 = 1_000_000;
const MAX_URL: usize = 2000;

fn private_v4(ip: &Ipv4Addr) -> bool {
    let o = ip.octets();
    ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        || (o[0] == 100 && (64..=127).contains(&o[1]))
        || o[0] == 0
        || o[0] >= 240
        || (o[0] == 192 && o[1] == 0 && o[2] == 0)
        || (o[0] == 198 && (o[1] == 18 || o[1] == 19))
}

fn private_v6(ip: &Ipv6Addr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() {
        return true;
    }
    let seg = ip.segments();
    if seg[0] & 0xffc0 == 0xfe80 || seg[0] & 0xfe00 == 0xfc00 {
        return true;
    }
    if let Some(v4) = ip.to_ipv4_mapped().or_else(|| ip.to_ipv4()) {
        return private_v4(&v4);
    }
    let v4_of = |hi: u16, lo: u16| Ipv4Addr::new((hi >> 8) as u8, hi as u8, (lo >> 8) as u8, lo as u8);
    if seg[0] == 0x64 && seg[1] == 0xff9b && seg[2..6].iter().all(|s| *s == 0) {
        return private_v4(&v4_of(seg[6], seg[7]));
    }
    if seg[0] == 0x64 && seg[1] == 0xff9b && seg[2] == 1 {
        return true;
    }
    if seg[0] == 0x2002 {
        return private_v4(&v4_of(seg[1], seg[2]));
    }
    if seg[0] == 0x2001 && seg[1] == 0 {
        return private_v4(&v4_of(seg[2], seg[3])) || private_v4(&v4_of(!seg[6], !seg[7]));
    }
    (seg[0] == 0x2001 && seg[1] == 0x0db8) || (seg[0] == 0x0100 && seg[1..4].iter().all(|s| *s == 0))
}

/// Somewhere that is not on the public internet: this computer, its network,
/// or an address no public page lives at.
pub fn is_private(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => private_v4(v4),
        IpAddr::V6(v6) => private_v6(v6),
    }
}

/// Every address a host answers with, or why it may not be reached.
fn resolve(host: &str) -> Result<Vec<IpAddr>, String> {
    let name = host.trim().trim_start_matches('[').trim_end_matches(']');
    if name.is_empty() {
        return Err("that address names no host.".into());
    }
    let found: Vec<IpAddr> = (name, 80u16).to_socket_addrs().map_err(|e| format!("that address could not be found: {e}"))?.map(|s| s.ip()).collect();
    if found.is_empty() {
        return Err("that address could not be found.".into());
    }
    if let Some(bad) = found.iter().find(|ip| is_private(ip)) {
        return Err(format!("that address leads to {bad}, on this computer or its private network, which the app does not reach."));
    }
    Ok(found)
}

#[derive(Debug)]
struct Target {
    scheme: String,
    host: String,
    authority: String,
    port: u16,
}

fn parse(raw: &str) -> Result<Target, String> {
    if raw.len() > MAX_URL {
        return Err("that address is too long.".into());
    }
    let uri: Uri = raw.trim().parse().map_err(|_| "that is not a web address.".to_string())?;
    let scheme = uri.scheme_str().unwrap_or("").to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err("only http and https addresses are read.".into());
    }
    let authority = uri.authority().ok_or("that address names no host.")?;
    if authority.as_str().contains('@') {
        return Err("an address carrying a name or password is not read.".into());
    }
    let host = authority.host().to_ascii_lowercase();
    if host.is_empty() {
        return Err("that address names no host.".into());
    }
    let port = authority.port_u16().unwrap_or(if scheme == "https" { 443 } else { 80 });
    Ok(Target { scheme, host, authority: authority.as_str().to_string(), port })
}

/// Where a redirect leads, from the page that sent it.
fn follow(base: &Target, location: &str) -> Result<String, String> {
    let loc = location.trim();
    let lower = loc.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return Ok(loc.to_string());
    }
    if let Some(rest) = loc.strip_prefix("//") {
        return Ok(format!("{}://{rest}", base.scheme));
    }
    if loc.starts_with('/') {
        return Ok(format!("{}://{}{loc}", base.scheme, base.authority));
    }
    Err("that address redirected somewhere that is not a web page.".into())
}

/// A resolver that answers only for the host that was checked, with the
/// addresses that were checked.
#[derive(Debug)]
struct Pinned {
    host: String,
    addresses: Vec<IpAddr>,
    port: u16,
}

impl Resolver for Pinned {
    fn resolve(&self, uri: &Uri, _config: &Config, _timeout: NextTimeout) -> Result<ResolvedSocketAddrs, ureq::Error> {
        if uri.authority().map(|a| a.host().to_ascii_lowercase()).as_deref() != Some(self.host.as_str()) {
            return Err(ureq::Error::HostNotFound);
        }
        let mut out = self.empty();
        for ip in &self.addresses {
            out.push(SocketAddr::new(*ip, self.port));
        }
        Ok(out)
    }
}

fn agent(t: &Target, addresses: Vec<IpAddr>) -> Agent {
    let config = Config::builder()
        .tls_config(TlsConfig::builder().provider(TlsProvider::NativeTls).build())
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(20)))
        .timeout_connect(Some(Duration::from_secs(10)))
        .user_agent("Hash LMG")
        .build();
    Agent::with_parts(config, DefaultConnector::new(), Pinned { host: t.host.clone(), addresses, port: t.port })
}

fn readable(content_type: &str) -> bool {
    let base = content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    base.is_empty() || base.starts_with("text/") || base.ends_with("+json") || base.ends_with("+xml") || base == "application/json" || base == "application/xml"
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub ok: bool,
    pub reason: Option<String>,
    pub status: u16,
    pub final_url: String,
    pub content_type: String,
    pub text: String,
    pub truncated: bool,
}

fn refused(reason: impl Into<String>) -> Page {
    Page { reason: Some(reason.into()), ..Page::default() }
}

/// Reads one public address as text, with an optional JSON body and key.
pub(crate) fn get(url: &str, post: Option<(&str, &str)>) -> Page {
    let mut current = url.trim().to_string();
    for _ in 0..=MAX_REDIRECTS {
        let target = match parse(&current) {
            Ok(t) => t,
            Err(r) => return refused(r),
        };
        let addresses = match resolve(&target.host) {
            Ok(a) => a,
            Err(r) => return refused(r),
        };
        let agent = agent(&target, addresses);
        let sent = match post {
            Some((body, key)) => agent.post(&current).header("Content-Type", "application/json").header("Authorization", format!("Bearer {key}")).send(body.to_string()),
            None => agent.get(&current).header("Accept", "text/html,text/plain,application/json;q=0.9,*/*;q=0.2").header("Accept-Language", "en").call(),
        };
        let mut response = match sent {
            Ok(r) => r,
            Err(e) => return refused(format!("that page could not be read: {e}")),
        };
        let status = response.status().as_u16();
        if matches!(status, 301 | 302 | 303 | 307 | 308) && post.is_none() {
            let location = response.headers().get("location").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
            current = match follow(&target, &location) {
                Ok(next) => next,
                Err(r) => return refused(r),
            };
            continue;
        }
        let content_type = response.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        if !readable(&content_type) {
            return Page { status, final_url: current, reason: Some(format!("that address is {content_type}, not a page that reads as text.")), content_type, ..Page::default() };
        }
        let mut buf = Vec::new();
        let mut reader = response.body_mut().with_config().limit(MAX_BYTES + 4096).reader();
        if let Err(e) = (&mut reader).take(MAX_BYTES + 1).read_to_end(&mut buf) {
            return refused(format!("that page could not be read: {e}"));
        }
        let truncated = buf.len() as u64 > MAX_BYTES;
        buf.truncate(MAX_BYTES as usize);
        let ok = (200..300).contains(&status);
        return Page { ok, reason: (!ok).then(|| format!("that page answered {status}.")), status, final_url: current, content_type, text: String::from_utf8_lossy(&buf).into_owned(), truncated };
    }
    refused("that address redirected too many times.")
}

#[tauri::command]
pub async fn web_fetch(url: String) -> Page {
    tauri::async_runtime::spawn_blocking(move || get(&url, None)).await.unwrap_or_else(|_| refused("the request ended unexpectedly."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn ip(s: &str) -> IpAddr {
        IpAddr::from_str(s).unwrap()
    }

    #[test]
    fn this_computer_and_its_network_are_not_reached() {
        // The home and office ranges, written as numbers.
        for o in [[10, 0, 0, 5], [192, 168, 1, 1], [172, 16, 0, 1]] {
            assert!(is_private(&IpAddr::from(o)), "{o:?} was treated as public");
        }
        for s in ["127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "64:ff9b::a00:1", "2002:c0a8:101::1"] {
            assert!(is_private(&ip(s)), "{s} was treated as public");
        }
        for s in ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(!is_private(&ip(s)), "{s} was treated as private");
        }
    }

    #[test]
    fn a_literal_private_address_is_refused_before_any_request() {
        assert!(resolve("127.0.0.1").is_err());
        assert!(resolve("[::1]").is_err());
        assert!(!get("http://127.0.0.1:8080/x", None).ok);
    }

    #[test]
    fn only_plain_web_addresses_are_read() {
        assert!(parse("https://example.com/a?b=1").is_ok());
        assert!(parse("file:///etc/hosts").is_err());
        assert!(parse("javascript:alert(1)").is_err());
        assert!(parse("https://user:pass@example.com/").is_err());
        assert!(parse(&format!("https://example.com/{}", "a".repeat(MAX_URL))).is_err());
        assert_eq!(parse("https://example.com:8443/").unwrap().port, 8443);
    }

    #[test]
    fn a_redirect_is_followed_only_to_another_web_address() {
        let base = parse("https://example.com/a/b").unwrap();
        assert_eq!(follow(&base, "/c").unwrap(), "https://example.com/c");
        assert_eq!(follow(&base, "//other.example/x").unwrap(), "https://other.example/x");
        assert!(follow(&base, "mailto:someone@example.com").is_err());
    }

    #[test]
    fn only_text_comes_back() {
        assert!(readable("text/html; charset=utf-8") && readable("application/json") && readable(""));
        assert!(!readable("image/png") && !readable("application/octet-stream"));
    }

}
