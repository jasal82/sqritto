//! Syntaxhervorhebung für Codeblöcke im HTML-Export. Typst nutzt im PDF
//! dieselben Grammatiken (syntect + two-face), daher sind beide Ausgaben
//! konsistent.

use std::sync::LazyLock;

use syntect::html::{ClassStyle, ClassedHTMLGenerator, css_for_theme_with_class_style};
use syntect::parsing::SyntaxSet;
use syntect::util::LinesWithEndings;
use two_face::theme::EmbeddedThemeName;

static SYNTAXES: LazyLock<SyntaxSet> = LazyLock::new(two_face::syntax::extra_newlines);

const STYLE: ClassStyle = ClassStyle::SpacedPrefixed { prefix: "hl-" };

fn alias(lang: &str) -> &str {
    match lang {
        "sh" | "shell" | "zsh" | "console" => "bash",
        "ps" | "ps1" | "pwsh" => "powershell",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "yml" => "yaml",
        "rs" => "rust",
        "py" => "python",
        "md" | "mdoc" | "markdoc" => "markdown",
        "dockerfile" => "Dockerfile",
        "c++" => "cpp",
        "cs" | "c#" => "C#",
        "jsonc" | "json5" => "json",
        "tf" | "hcl" => "terraform",
        "html" | "htm" | "xhtml" => "html",
        "plaintext" | "txt" | "text" => "txt",
        other => other,
    }
}

/// Liefert hervorgehobenes HTML (ohne `<pre>`), oder `None`, wenn die
/// Sprache unbekannt ist.
pub fn highlight_html(code: &str, lang: &str) -> Option<String> {
    let lower = lang.trim().to_ascii_lowercase();
    if lower.is_empty() || lower == "txt" || lower == "text" || lower == "plaintext" {
        return None;
    }
    if matches!(lower.as_str(), "typ" | "typst" | "typc") {
        return Some(highlight_typst(code, lower == "typc"));
    }
    let ss = &*SYNTAXES;
    let name = alias(&lower);
    let syntax = ss
        .find_syntax_by_token(name)
        .or_else(|| ss.find_syntax_by_name(name))
        .or_else(|| ss.find_syntax_by_extension(name))?;
    let mut generator = ClassedHTMLGenerator::new_with_class_style(syntax, ss, STYLE);
    for line in LinesWithEndings::from(code) {
        generator.parse_html_for_line_which_includes_newline(line).ok()?;
    }
    let mut html = generator.finalize();
    if html.ends_with('\n') && !code.ends_with('\n') {
        html.pop();
    }
    Some(html)
}

fn highlight_typst(code: &str, code_mode: bool) -> String {
    let root = if code_mode { typst::syntax::parse_code(code) } else { typst::syntax::parse(code) };
    let html = typst::syntax::highlight_html(&root);
    // `highlight_html` umschließt das Ergebnis mit <pre>; nur den Inhalt verwenden.
    let inner = html
        .strip_prefix("<pre>")
        .and_then(|s| s.strip_suffix("</pre>"))
        .unwrap_or(&html);
    inner.to_string()
}

/// CSS für helles und dunkles Farbschema.
pub fn theme_css() -> String {
    static CSS: LazyLock<String> = LazyLock::new(|| {
        let themes = two_face::theme::extra();
        let light = css_for_theme_with_class_style(themes.get(EmbeddedThemeName::InspiredGithub), STYLE)
            .unwrap_or_default();
        let dark = css_for_theme_with_class_style(themes.get(EmbeddedThemeName::OneHalfDark), STYLE)
            .unwrap_or_default();
        let scoped_dark = scope(&dark, ":root[data-theme=\"dark\"]");
        let auto_dark = scope(&dark, ":root:not([data-theme=\"light\"])");
        format!(
            "/* Syntaxhervorhebung (hell) */\n{}\n/* dunkel */\n{}\n@media (prefers-color-scheme: dark) {{\n{}\n}}\n{}",
            strip_backgrounds(&light),
            strip_backgrounds(&scoped_dark),
            strip_backgrounds(&auto_dark),
            TYPST_CSS
        )
    });
    CSS.clone()
}

/// Hintergründe der Themes entfernen; die Site bestimmt sie selbst.
fn strip_backgrounds(css: &str) -> String {
    css.lines()
        .filter(|l| !l.trim_start().starts_with("background-color"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn scope(css: &str, prefix: &str) -> String {
    let mut out = String::new();
    for line in css.lines() {
        let t = line.trim_start();
        if t.starts_with('.') && (t.ends_with('{') || t.ends_with(',')) {
            out.push_str(prefix);
            out.push(' ');
            out.push_str(t);
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

const TYPST_CSS: &str = r#"
.typ-comment { color: #6a737d; font-style: italic; }
.typ-punct, .typ-op { color: #57606a; }
.typ-escape, .typ-str { color: #0a7d33; }
.typ-strong { font-weight: 700; }
.typ-emph { font-style: italic; }
.typ-link { color: #0969da; text-decoration: underline; }
.typ-raw { color: #6e7781; }
.typ-label, .typ-ref { color: #8250df; }
.typ-heading { font-weight: 700; color: #0550ae; }
.typ-marker { color: #953800; }
.typ-term { font-weight: 700; }
.typ-math-delim, .typ-math-op { color: #8250df; }
.typ-key { color: #cf222e; }
.typ-num { color: #0550ae; }
.typ-func { color: #6639ba; }
.typ-pol { color: #953800; }
:root[data-theme="dark"] .typ-func, :root[data-theme="dark"] .typ-label { color: #d2a8ff; }
:root[data-theme="dark"] .typ-key { color: #ff7b72; }
:root[data-theme="dark"] .typ-str, :root[data-theme="dark"] .typ-escape { color: #7ee787; }
:root[data-theme="dark"] .typ-heading, :root[data-theme="dark"] .typ-num { color: #79c0ff; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .typ-func, :root:not([data-theme="light"]) .typ-label { color: #d2a8ff; }
  :root:not([data-theme="light"]) .typ-key { color: #ff7b72; }
  :root:not([data-theme="light"]) .typ-str, :root:not([data-theme="light"]) .typ-escape { color: #7ee787; }
  :root:not([data-theme="light"]) .typ-heading, :root:not([data-theme="light"]) .typ-num { color: #79c0ff; }
}
"#;

#[cfg(test)]
mod tests {
    #[test]
    fn highlights_rust() {
        let html = super::highlight_html("fn main() {}", "rust").unwrap();
        assert!(html.contains("hl-"));
    }
}
