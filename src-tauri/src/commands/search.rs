// Searching the web for a film, once the person has said yes.
//
//   web_search { query } -> { ok, reason, source, results: [{ title, url, snippet }] }
//
// With the person's search key (Tavily) when one is saved, else DuckDuckGo's
// plain results page, which needs no key and reaches the whole web, and
// Wikipedia's own search when that finds nothing. Every address is built
// here from the query's words alone, and read through the same checked
// reader as any page (web.rs).

use serde::Serialize;
use tauri::AppHandle;

use super::keys;
use super::web::get;

const MAX_QUERY: usize = 300;

#[derive(Serialize, Default)]
pub struct Hit {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Serialize, Default)]
pub struct Found {
    pub ok: bool,
    pub reason: Option<String>,
    pub source: String,
    pub results: Vec<Hit>,
}

fn clip(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// A query's words as they go in an address: nothing but the words.
fn encode(query: &str) -> String {
    query.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

/// Wikipedia's search address for a query, with the opening of each page.
pub fn wikipedia_url(query: &str) -> String {
    let q = encode(query);
    format!("https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=4&gsrsearch={q}&prop=extracts%7Cinfo&exintro=1&explaintext=1&exlimit=4&inprop=url")
}

/// DuckDuckGo's plain results page for a query: results from the whole web,
/// with no key.
pub fn duckduckgo_url(query: &str) -> String {
    format!("https://html.duckduckgo.com/html/?q={}", encode(query))
}

/// Markup taken out of a bit of a page: tags dropped, the common entities
/// read, space collapsed.
fn plain(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let out = out.replace("&quot;", "\"").replace("&#x27;", "'").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ").replace("&amp;", "&");
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// %XX escapes read back into the text they stand for.
fn unescape(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = |c: u8| (c as char).to_digit(16);
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(if b[i] == b'+' { b' ' } else { b[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The text after the first `start`, up to the next `end`.
fn between<'a>(s: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let a = s.find(start)? + start.len();
    let b = s[a..].find(end)? + a;
    Some(&s[a..b])
}

/// The results on DuckDuckGo's plain page, in order: each title, the real
/// address its link carries, and its snippet. Advertisements and the
/// service's own pages are left out.
pub fn duckduckgo_results(html: &str, most: usize) -> Vec<Hit> {
    let mut out = Vec::new();
    for block in html.split("<div class=\"result ").skip(1) {
        if block[..block.len().min(400)].contains("result--ad") {
            continue;
        }
        let Some(at) = block.find("class=\"result__a\"") else { continue };
        let link = &block[at..];
        let Some(href) = between(link, "href=\"", "\"") else { continue };
        let href = href.replace("&amp;", "&");
        let url = match between(&format!("{href}&"), "uddg=", "&") {
            Some(u) => unescape(u),
            None => href.clone(),
        };
        let lower = url.to_ascii_lowercase();
        if !(lower.starts_with("https://") || lower.starts_with("http://")) || lower.split('/').nth(2).is_some_and(|h| h == "duckduckgo.com" || h.ends_with(".duckduckgo.com")) {
            continue;
        }
        let title = between(link, ">", "</a>").map(plain).unwrap_or_default();
        let snippet = between(block, "class=\"result__snippet\"", "</a>").and_then(|s| s.split_once('>').map(|(_, t)| plain(t))).unwrap_or_default();
        if title.is_empty() {
            continue;
        }
        out.push(Hit { title: clip(&title, 200), url: clip(&url, 500), snippet: clip(&snippet, 600) });
        if out.len() >= most {
            break;
        }
    }
    out
}

fn search(app: &AppHandle, query: &str) -> Found {
    let query = query.trim();
    if query.is_empty() || query.len() > MAX_QUERY {
        return Found { reason: Some("a search is a few words, at most 300 characters.".into()), ..Found::default() };
    }
    if let Some(key) = keys::lookup(app, "tavily") {
        let body = serde_json::json!({ "query": query, "search_depth": "basic", "max_results": 5 }).to_string();
        let page = get("https://api.tavily.com/search", Some((&body, &key)));
        if page.ok {
            let v: serde_json::Value = serde_json::from_str(&page.text).unwrap_or_default();
            let results = v["results"].as_array().map(|a| a.iter().map(|r| Hit { title: clip(r["title"].as_str().unwrap_or(""), 200), url: clip(r["url"].as_str().unwrap_or(""), 500), snippet: clip(r["content"].as_str().unwrap_or(""), 600) }).collect()).unwrap_or_default();
            return Found { ok: true, reason: None, source: "Tavily".into(), results };
        }
    }
    let page = get(&duckduckgo_url(query), None);
    if page.ok {
        let results = duckduckgo_results(&page.text, 6);
        if !results.is_empty() {
            return Found { ok: true, reason: None, source: "DuckDuckGo".into(), results };
        }
    }
    let page = get(&wikipedia_url(query), None);
    if !page.ok {
        return Found { reason: page.reason, ..Found::default() };
    }
    let v: serde_json::Value = serde_json::from_str(&page.text).unwrap_or_default();
    let mut results: Vec<(i64, Hit)> = v["query"]["pages"].as_object().map(|m| m.values().map(|p| (p["index"].as_i64().unwrap_or(99), Hit { title: clip(p["title"].as_str().unwrap_or(""), 200), url: clip(p["fullurl"].as_str().unwrap_or(""), 500), snippet: clip(p["extract"].as_str().unwrap_or(""), 600) })).collect()).unwrap_or_default();
    results.sort_by_key(|(i, _)| *i);
    Found { ok: true, reason: None, source: "Wikipedia".into(), results: results.into_iter().map(|(_, h)| h).collect() }
}

#[tauri::command]
pub async fn web_search(app: AppHandle, query: String) -> Found {
    tauri::async_runtime::spawn_blocking(move || search(&app, &query)).await.unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_keyless_results_are_read_in_order_with_their_real_addresses() {
        let page = r#"<html><body>
<div class="result results_links web-result result--ad"><a class="result__a" href="https://ads.example/x">An advertisement</a></div>
<div class="result results_links web-result "><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbrightway.example%2Fabout&amp;rut=abc">Brightway &amp; <b>friends</b></a></h2>
<a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">An invented planner&#x27;s home, <b>free</b>.</a></div>
<div class="result results_links web-result "><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fsettings">The service's own page</a></div>
<div class="result results_links web-result "><a class="result__a" href="https://docs.brightway.example/start">Getting started</a></div>
</body></html>"#;
        let hits = duckduckgo_results(page, 6);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].title, "Brightway & friends");
        assert_eq!(hits[0].url, "https://brightway.example/about");
        assert_eq!(hits[0].snippet, "An invented planner's home, free.");
        assert_eq!(hits[1].url, "https://docs.brightway.example/start");
        assert!(duckduckgo_results(page, 1).len() == 1);
        assert!(duckduckgo_results("<html>nothing here</html>", 6).is_empty());
        assert_eq!(unescape("a%2Fb%zz%E2%80%94"), "a/b%zz\u{2014}");
    }

    #[test]
    fn the_keyless_search_address_carries_the_query_and_nothing_else() {
        assert_eq!(duckduckgo_url("motion graphics & film"), "https://html.duckduckgo.com/html/?q=motion%20graphics%20%26%20film");
    }

    #[test]
    fn the_search_address_carries_the_query_and_nothing_else() {
        let u = wikipedia_url("motion graphics & film");
        assert!(u.starts_with("https://en.wikipedia.org/w/api.php?"));
        assert!(u.contains("gsrsearch=motion%20graphics%20%26%20film&"));
    }
}
