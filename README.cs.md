# ClaudeUsage

[English](README.md) · **Česky**

Malá aplikace do systémové lišty, která ukazuje spotřebu Claude předplatného: aktuální 5hodinovou session, týdenní limit a případné další limity, pokud je vrací claude.ai.

- Ikona v liště: procento aktuální session, buď jako velké barevné číslo (výchozí, nejlépe čitelné), nebo jako kroužek s číslem. Barva je zelená do 80 %, oranžová mezi 80 a 95 % a červená nad 95 %, laděná zvlášť pro světlou a tmavou lištu. Tooltip ukazuje session i týden s odpočtem do resetu.
- Popover po kliknutí: velký ukazatel session, týdenní limit s datem a odpočtem resetu a menší řádky s dalšími limity (jen pokud jsou v datech).
- Rozložení Normální / Kompaktní, vzhled Auto / Světlý / Tmavý, obnova po 1, 3, 5, 10 nebo 15 minutách.
- Graf historie spotřeby (dnes, 24 h, 3 dny, týden, měsíc) pro týdenní limit nebo session. claude.ai historii neposkytuje, takže ji aplikace ukládá sama při každé obnově. Graf tedy obsahuje data jen z doby, kdy aplikace běžela.
- Notifikace při 80 % a 95 %, vždy jen jednou za každé resetovací okno.
- 8 jazyků: čeština, angličtina, ukrajinština, němčina, francouzština, španělština, italština a polština. Ve výchozím stavu podle systému, ručně v Nastavení → Jazyk.
- Spouštění po přihlášení do systému.
- **Bez telemetrie a bez externích serverů.** Aplikace komunikuje jen s `claude.ai`, stejně jako oficiální stránka.

Platformy: **Windows 10/11** (x64 i ARM64, otestováno) a **macOS 11+** (Apple Silicon i Intel, universal `.dmg`). macOS verze se sestavuje přes GitHub Actions a zatím nebyla ručně vyzkoušená na Macu.

## Jak aplikace získává data

Zdroj dat byl ověřen z network requestů oficiální stránky `https://claude.ai/settings/usage` (23. 9. 2026). Stránka volá:

```
GET https://claude.ai/api/organizations/{org_uuid}/usage?cedar_ember=1&skip_spend=1
```

Z odpovědi aplikace čte pole `limits` (`kind`, `group`, `percent`, `resets_at`), tedy stejný seznam, jaký vykresluje oficiální stránka. Pole `five_hour` a `seven_day` slouží jen jako záloha, kdyby `limits` zmizelo. `org_uuid` se bere z cookie `lastActiveOrg` a pokud chybí, z `GET /api/organizations`.

Postup:

1. Při prvním spuštění se otevře okno s `https://claude.ai/login`. Přihlásíš se normálně a session zůstane v perzistentním profilu WebView2 aplikace. Nic se nekopíruje ručně.
2. Skryté webview načte malý dokument na doméně `claude.ai` a spustí v něm `fetch` na výše uvedený endpoint. Požadavek tak nese cookies profilu a vypadá stejně jako požadavek oficiální stránky.
3. Výsledek se vrátí do aplikace přes IPC. Vzdálená stránka smí volat **jediný** příkaz, `usage_report` (viz `src-tauri/capabilities/fetcher.json`).
4. Odpověď 401 (nebo 403 s JSON) znamená stav „Odhlášeno“ s tlačítkem „Přihlásit znovu“. Síťová chyba zobrazí poslední známá data s označením „Offline“.

Endpoint je interní API claude.ai, ne veřejné. Pokud ho Anthropic změní, aplikace ukáže „Neočekávaný formát dat“ a bude potřeba upravit `src-tauri/src/model.rs`.

**Tip k přihlášení:** Nejspolehlivější je „Continue with email“. Google někdy odmítá přihlášení ve vložených prohlížečích.

## Požadavky pro vývoj (Windows)

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (stable, MSVC toolchain): `winget install Rustlang.Rustup`
- Visual Studio Build Tools s komponentou „Desktop development with C++“ (MSVC + Windows SDK). Pro ARM64 build také „MSVC … ARM64 build tools“.
- WebView2 Runtime (součást Windows 11)

```bash
npm install
```

## Vývoj

```bash
npm run tauri dev
```

Spustí Vite na `http://localhost:1420` a aplikaci. Aplikace nemá hlavní okno, hledej ikonu v liště (případně v přetečení šipkou ^).

**Náhled designu bez Tauri:** `npm run dev` a otevři `http://localhost:1420` v prohlížeči. Běží s ukázkovými daty (označenými štítkem) a stavy se přepínají parametry:

```
?s=online|offline|logged_out|loading|nodata  &p=62  &w=84  &x=1  &theme=light|dark  &d=normal|compact
```

Testy datového modelu (parsování reálné ukázky odpovědi):

```bash
cd src-tauri && cargo test
```

Náhled všech variant ikony v liště (PNG do `src-tauri/target/tray-preview/`):

```bash
cd src-tauri && cargo test tray_preview -- --ignored
```

## Build instalátoru (.exe / .msi)

```bash
npm run tauri build
```

Výstupy:

- NSIS instalátor (`.exe`): `src-tauri/target/release/bundle/nsis/ClaudeUsage_0.2.0_<arch>-setup.exe`
- MSI (`.msi`): `src-tauri/target/release/bundle/msi/ClaudeUsage_0.2.0_<arch>_cs-CZ.msi`

Build pro konkrétní architekturu:

```bash
rustup target add x86_64-pc-windows-msvc aarch64-pc-windows-msvc
npm run tauri build -- --target x86_64-pc-windows-msvc
npm run tauri build -- --target aarch64-pc-windows-msvc
```

Jen `.exe` instalátor (bez MSI), zvlášť pro každou architekturu:

```bash
npm run tauri build -- --bundles nsis --target aarch64-pc-windows-msvc
npm run tauri build -- --bundles nsis --target x86_64-pc-windows-msvc
```

Výstup je v `src-tauri/target/<target>/release/bundle/nsis/`.

Poznámky:

- NSIS instalátor se instaluje pro aktuálního uživatele (bez admin práv).
- MSI používá WiX Toolset v3, který Tauri stáhne při prvním buildu. WiX v3 neumí ARM64 MSI, takže pro ARM64 použij NSIS `.exe`.
- Instalátory nejsou podepsané, takže Windows SmartScreen při prvním spuštění zobrazí varování. Pro distribuci doplň code signing podle [dokumentace Tauri](https://v2.tauri.app/distribute/sign/windows/).

## macOS (.dmg)

`.dmg` se dá sestavit jen na macOS. Jsou dvě cesty:

**GitHub Actions:** workflow [`.github/workflows/build.yml`](.github/workflows/build.yml) sestaví universal `.dmg` (Apple Silicon + Intel) a oba Windows `.exe`.

- Ručně: záložka *Actions* → *Build* → *Run workflow*. Instalátory pak najdeš v sekci *Artifacts* daného běhu.
- Tagem: `git tag v0.2.0 && git push --tags` vytvoří koncept (draft) GitHub release s přiloženými instalátory.

**Na vlastním Macu** (Xcode Command Line Tools, Node, Rust):

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm install
npm run tauri build -- --target universal-apple-darwin --bundles dmg
```

Výstup: `src-tauri/target/universal-apple-darwin/release/bundle/dmg/ClaudeUsage_0.2.0_universal.dmg`

Chování na macOS:

- Aplikace žije jen v menu baru, bez ikony v Docku.
- Ikona je monochromatická template ikona (kroužek), takže ladí se světlým i tmavým menu barem. Procento session je jako text vedle ní. Od 80 % se kroužek barví oranžově, nad 95 % červeně.
- Popover má nativní vibrancy (`NSVisualEffectView`, materiál Popover) a zaoblení 14 px.

**Nenotarizovaná aplikace:** build má jen ad-hoc podpis (`signingIdentity: "-"`), ne Apple Developer ID. macOS proto při prvním spuštění hlásí, že aplikaci nelze ověřit:

1. Přetáhni `ClaudeUsage.app` z `.dmg` do *Aplikací* a zkus ji spustit.
2. Otevři *Nastavení systému → Soukromí a zabezpečení*, sjeď dolů a klikni na **Přesto otevřít**. Na macOS 15 a novějším už nefunguje pravé tlačítko → *Otevřít*.

Pokud macOS hlásí, že je aplikace **„poškozená“**, jde o příznak karantény po stažení. Odstraníš ho v Terminálu:

```bash
xattr -cr /Applications/ClaudeUsage.app
```

Po spuštění aplikace nemá okno ani ikonu v Docku. Hledej kroužek s procentem v menu baru vpravo nahoře. Na MacBooku s výřezem ho může schovat plný menu bar. Při prvním spuštění se otevře okno pro přihlášení ke claude.ai.

## Verze a aktualizace

Nová verze se nainstaluje přes starou: instalátor ji rozpozná a nahradí. Nastavení, přihlášení i historie zůstanou zachované. Instalátor sám neaktualizuje, novou verzi je potřeba stáhnout a spustit.

Při vydání nové verze zvyš číslo na třech místech (musí se shodovat):

- `package.json` → `"version"`
- `src-tauri/Cargo.toml` → `version`
- `src-tauri/tauri.conf.json` → `"version"`

Aplikace zobrazuje verzi v patičce Nastavení, čte ji z `tauri.conf.json`.

## Kde jsou data aplikace

| Co | Kde |
|---|---|
| Nastavení | Windows: `%APPDATA%\com.mykola.claudeusage\settings.json`, macOS: `~/Library/Application Support/com.mykola.claudeusage/settings.json` |
| Historie spotřeby (35 dní) | Windows: `%APPDATA%\com.mykola.claudeusage\history.jsonl`, macOS: `~/Library/Application Support/com.mykola.claudeusage/history.jsonl` |
| Záznam odeslaných notifikací | `%APPDATA%\com.mykola.claudeusage\notified.json` |
| Profil WebView2 (přihlášení) | `%LOCALAPPDATA%\com.mykola.claudeusage\EBWebView` |

„Odhlásit se“ v nastavení smaže data profilu WebView2 (cookies, úložiště, cache).

## Struktura projektu

```
ClaudeUsage/
├─ index.html, src/            frontend (vanilla TypeScript + Vite)
│  ├─ main.ts                  popover: render, animace, nastavení, přepínání panelů
│  ├─ lib/                     ipc (+ mock pro náhled), formátování času, DOM helpery
│  └─ styles/                  tokens.css (design tokeny světlý/tmavý), app.css
├─ assets/app-icon.svg         zdroj ikony aplikace (npx tauri icon assets/app-icon.svg -o src-tauri/icons)
└─ src-tauri/
   ├─ src/lib.rs               stav, příkazy, tray, plánovač obnovy
   ├─ src/fetcher.rs           skryté webview claude.ai + přihlašovací okno
   ├─ src/model.rs             datový model odpovědi /usage (+ testy)
   ├─ src/tray_icon.rs         vykreslení ikony v liště (kroužek + %)
   ├─ src/popover.rs           pozice u ikony, acrylic pozadí, zaoblení
   ├─ src/notify.rs            notifikace 80/95 % jednou za okno
   ├─ src/settings.rs          perzistence nastavení
   └─ capabilities/            oprávnění: popover (lokální UI) a fetcher (jen usage_report)
```

## Design

- Design tokeny v `src/styles/tokens.css` pro světlý a tmavý režim. Stavové barvy jsou laděné zvlášť pro každý režim a všechny texty mají kontrast aspoň WCAG AA (4,5 : 1).
- Režim Auto sleduje systém živě, bez restartu. Ruční volba ho přebíjí a ukládá se lokálně. Přepnutí má 220ms přechod.
- Na Windows 11 má okno nativní Acrylic pozadí a zaoblení 8 px od DWM. Windows u průsvitného pozadí jiný poloměr nenabízí. Pokud Acrylic není dostupný, použije se neprůhledný povrch.
- Ikony jsou z [Lucide](https://lucide.dev) (ISC licence).
- Ikona aplikace „CU“ se stylizovanou jiskrou je vlastní kresba. Není to oficiální logo Claude, barva jiskry na něj jen odkazuje. Při veřejné distribuci je potřeba dodržet ochranné známky Anthropicu.
