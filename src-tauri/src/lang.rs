//! Strings the backend shows itself: tray tooltip and menu, notifications and
//! the sign-in window title. Everything inside the popover is translated by the
//! frontend (src/lib/i18n.ts).

use crate::model::Limit;

pub const LANGS: [&str; 8] = ["cs", "en", "uk", "de", "fr", "es", "it", "pl"];

pub struct Strings {
    pub menu_open: &'static str,
    pub menu_refresh: &'static str,
    pub menu_quit: &'static str,
    pub login_title: &'static str,
    pub signed_out: &'static str,
    pub loading: &'static str,
    pub offline: &'static str,
    pub session: &'static str,
    pub week: &'static str,
    /// "{}" is the countdown, e.g. "2 h 14 min".
    pub reset_in: &'static str,
    /// "{}" is the reset time, e.g. "Sat 7:00 (2 d 14 h)".
    pub reset_at: &'static str,
    pub notify_warn: &'static str,
    pub notify_critical: &'static str,
    pub label_session: &'static str,
    pub label_weekly: &'static str,
    /// "{}" is the model name.
    pub label_weekly_model: &'static str,
    /// Day, hour and minute abbreviations.
    pub units: [&'static str; 3],
    /// Monday first.
    pub days: [&'static str; 7],
}

const CS: Strings = Strings {
    menu_open: "Otevřít ClaudeUsage",
    menu_refresh: "Obnovit",
    menu_quit: "Ukončit",
    login_title: "ClaudeUsage – přihlášení",
    signed_out: "Odhlášeno",
    loading: "Načítám…",
    offline: "Offline",
    session: "Session",
    week: "Týden",
    reset_in: "reset za {}",
    reset_at: "reset {}",
    notify_warn: "Blížíš se limitu",
    notify_critical: "Limit je téměř vyčerpán",
    label_session: "Aktuální session",
    label_weekly: "Týdenní limit",
    label_weekly_model: "Týdenní · {}",
    units: ["d", "h", "min"],
    days: ["po", "út", "st", "čt", "pá", "so", "ne"],
};

const EN: Strings = Strings {
    menu_open: "Open ClaudeUsage",
    menu_refresh: "Refresh",
    menu_quit: "Quit",
    login_title: "ClaudeUsage – sign in",
    signed_out: "Signed out",
    loading: "Loading…",
    offline: "Offline",
    session: "Session",
    week: "Week",
    reset_in: "resets in {}",
    reset_at: "resets {}",
    notify_warn: "Approaching your limit",
    notify_critical: "Limit almost used up",
    label_session: "Current session",
    label_weekly: "Weekly limit",
    label_weekly_model: "Weekly · {}",
    units: ["d", "h", "min"],
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};

const UK: Strings = Strings {
    menu_open: "Відкрити ClaudeUsage",
    menu_refresh: "Оновити",
    menu_quit: "Закрити",
    login_title: "ClaudeUsage – вхід",
    signed_out: "Ви не ввійшли",
    loading: "Завантаження…",
    offline: "Офлайн",
    session: "Сесія",
    week: "Тиждень",
    reset_in: "скидання через {}",
    reset_at: "скидання {}",
    notify_warn: "Наближаєтеся до ліміту",
    notify_critical: "Ліміт майже вичерпано",
    label_session: "Поточна сесія",
    label_weekly: "Тижневий ліміт",
    label_weekly_model: "Тижневий · {}",
    units: ["д", "год", "хв"],
    days: ["пн", "вт", "ср", "чт", "пт", "сб", "нд"],
};

const DE: Strings = Strings {
    menu_open: "ClaudeUsage öffnen",
    menu_refresh: "Aktualisieren",
    menu_quit: "Beenden",
    login_title: "ClaudeUsage – Anmeldung",
    signed_out: "Abgemeldet",
    loading: "Lädt…",
    offline: "Offline",
    session: "Sitzung",
    week: "Woche",
    reset_in: "Reset in {}",
    reset_at: "Reset {}",
    notify_warn: "Limit bald erreicht",
    notify_critical: "Limit fast aufgebraucht",
    label_session: "Aktuelle Sitzung",
    label_weekly: "Wochenlimit",
    label_weekly_model: "Woche · {}",
    units: ["T", "Std.", "Min."],
    days: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
};

const FR: Strings = Strings {
    menu_open: "Ouvrir ClaudeUsage",
    menu_refresh: "Actualiser",
    menu_quit: "Quitter",
    login_title: "ClaudeUsage – connexion",
    signed_out: "Déconnecté",
    loading: "Chargement…",
    offline: "Hors ligne",
    session: "Session",
    week: "Semaine",
    reset_in: "réinit. dans {}",
    reset_at: "réinit. {}",
    notify_warn: "Limite bientôt atteinte",
    notify_critical: "Limite presque épuisée",
    label_session: "Session en cours",
    label_weekly: "Limite hebdomadaire",
    label_weekly_model: "Hebdo · {}",
    units: ["j", "h", "min"],
    days: ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"],
};

const ES: Strings = Strings {
    menu_open: "Abrir ClaudeUsage",
    menu_refresh: "Actualizar",
    menu_quit: "Salir",
    login_title: "ClaudeUsage – inicio de sesión",
    signed_out: "Sesión cerrada",
    loading: "Cargando…",
    offline: "Sin conexión",
    session: "Sesión",
    week: "Semana",
    reset_in: "se restablece en {}",
    reset_at: "se restablece {}",
    notify_warn: "Te acercas al límite",
    notify_critical: "Límite casi agotado",
    label_session: "Sesión actual",
    label_weekly: "Límite semanal",
    label_weekly_model: "Semanal · {}",
    units: ["d", "h", "min"],
    days: ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"],
};

const IT: Strings = Strings {
    menu_open: "Apri ClaudeUsage",
    menu_refresh: "Aggiorna",
    menu_quit: "Esci",
    login_title: "ClaudeUsage – accesso",
    signed_out: "Disconnesso",
    loading: "Caricamento…",
    offline: "Offline",
    session: "Sessione",
    week: "Settimana",
    reset_in: "reset tra {}",
    reset_at: "reset {}",
    notify_warn: "Ti stai avvicinando al limite",
    notify_critical: "Limite quasi esaurito",
    label_session: "Sessione attuale",
    label_weekly: "Limite settimanale",
    label_weekly_model: "Settimanale · {}",
    units: ["g", "h", "min"],
    days: ["lun", "mar", "mer", "gio", "ven", "sab", "dom"],
};

const PL: Strings = Strings {
    menu_open: "Otwórz ClaudeUsage",
    menu_refresh: "Odśwież",
    menu_quit: "Zakończ",
    login_title: "ClaudeUsage – logowanie",
    signed_out: "Wylogowano",
    loading: "Wczytywanie…",
    offline: "Offline",
    session: "Sesja",
    week: "Tydzień",
    reset_in: "reset za {}",
    reset_at: "reset {}",
    notify_warn: "Zbliżasz się do limitu",
    notify_critical: "Limit prawie wyczerpany",
    label_session: "Bieżąca sesja",
    label_weekly: "Limit tygodniowy",
    label_weekly_model: "Tygodniowy · {}",
    units: ["d", "godz.", "min"],
    days: ["pon", "wt", "śr", "czw", "pt", "sob", "niedz"],
};

pub fn strings(lang: &str) -> &'static Strings {
    match lang {
        "cs" => &CS,
        "uk" => &UK,
        "de" => &DE,
        "fr" => &FR,
        "es" => &ES,
        "it" => &IT,
        "pl" => &PL,
        _ => &EN,
    }
}

impl Strings {
    pub fn fill(template: &str, value: &str) -> String {
        template.replacen("{}", value, 1)
    }

    pub fn limit_label(&self, l: &Limit) -> String {
        match l.kind.as_str() {
            "session" => self.label_session.into(),
            "weekly_all" => self.label_weekly.into(),
            _ => Self::fill(self.label_weekly_model, l.name.as_deref().unwrap_or(&l.kind)),
        }
    }
}

const DEFAULT_LOCALES: [(&str, &str); 8] =
    [("cs", "cs-CZ"), ("en", "en-US"), ("uk", "uk-UA"), ("de", "de-DE"), ("fr", "fr-FR"), ("es", "es-ES"), ("it", "it-IT"), ("pl", "pl-PL")];

/// Resolves the language setting to (language, BCP 47 locale for date and number
/// formatting). "auto" follows the OS; unsupported languages fall back to English.
/// The system locale is kept when its language matches, so regional formats
/// (en-GB 24 h clock, de-AT, …) survive.
pub fn resolve(pref: &str) -> (String, String) {
    let system = sys_locale::get_locale().unwrap_or_else(|| "en-US".into());
    let system_lang = system.split(['-', '_']).next().unwrap_or("en").to_lowercase();
    let lang = if LANGS.contains(&pref) {
        pref.to_string()
    } else if LANGS.contains(&system_lang.as_str()) {
        system_lang.clone()
    } else {
        "en".to_string()
    };
    let locale = if system_lang == lang {
        system.replace('_', "-")
    } else {
        DEFAULT_LOCALES.iter().find(|(l, _)| *l == lang).map_or("en-US", |(_, loc)| loc).to_string()
    };
    (lang, locale)
}
