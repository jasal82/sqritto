// Bettet unter Windows Programmsymbol, Versionsinformationen und das
// Anwendungsmanifest (DPI-Bewusstsein, moderne Steuerelemente) in die EXE ein.

fn main() {
    println!("cargo:rerun-if-changed=assets/icon/sqritto.ico");
    println!("cargo:rerun-if-changed=assets/icon/sqritto.manifest");
    println!("cargo:rerun-if-changed=build.rs");

    #[cfg(windows)]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("assets/icon/sqritto.ico");
        res.set_manifest_file("assets/icon/sqritto.manifest");
        res.set("ProductName", "Sqritto");
        res.set("FileDescription", "Sqritto – Docs-as-Code-Dokumentenwerkstatt");
        res.set("InternalName", "sqritto");
        res.set("OriginalFilename", "sqritto.exe");
        res.set("CompanyName", "Sqritto");
        res.set("LegalCopyright", "© 2026 Johannes Asal · Apache-2.0");
        if let Err(e) = res.compile() {
            println!("cargo:warning=Windows-Ressourcen konnten nicht eingebettet werden: {e}");
        }
    }
}
