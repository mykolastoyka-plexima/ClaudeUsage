//! Renders the tray icon: a progress ring with the session percentage inside.

use ab_glyph::{Font, FontVec, PxScale, ScaleFont};
use std::sync::OnceLock;
use tiny_skia::{Color, LineCap, Paint, PathBuilder, Pixmap, Stroke, Transform};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tone {
    Ok,
    Warn,
    Danger,
    /// Offline / logged out / unknown.
    Muted,
}

pub fn tone_for(percent: f64) -> Tone {
    if percent > 95.0 {
        Tone::Danger
    } else if percent >= 80.0 {
        Tone::Warn
    } else {
        Tone::Ok
    }
}

fn font() -> Option<&'static FontVec> {
    static FONT: OnceLock<Option<FontVec>> = OnceLock::new();
    FONT.get_or_init(|| {
        let dir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
        let candidates: Vec<String> = if cfg!(windows) {
            ["segoeuib.ttf", "seguisb.ttf", "arialbd.ttf"].iter().map(|f| format!("{dir}\\Fonts\\{f}")).collect()
        } else {
            ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"].iter().map(|s| s.to_string()).collect()
        };
        candidates
            .iter()
            .find_map(|f| std::fs::read(f).ok())
            .and_then(|b| FontVec::try_from_vec(b).ok())
    })
    .as_ref()
}

/// Status colours tuned per taskbar background. The light-taskbar variants are
/// darker than the UI's so bold digits keep ≥ 4.5:1 against #f3f3f3.
fn colors(tone: Tone, light_taskbar: bool) -> ((u8, u8, u8), (u8, u8, u8)) {
    let fg: (u8, u8, u8) = if light_taskbar { (28, 28, 30) } else { (255, 255, 255) };
    let accent = match (tone, light_taskbar) {
        (Tone::Ok, true) => (18, 122, 68),
        (Tone::Ok, false) => (92, 214, 152),
        (Tone::Warn, true) => (176, 92, 0),
        (Tone::Warn, false) => (246, 180, 80),
        (Tone::Danger, true) => (196, 28, 44),
        (Tone::Danger, false) => (255, 118, 120),
        (Tone::Muted, _) => fg,
    };
    (fg, accent)
}

/// Number-only style: the percentage fills the icon, coloured by status.
pub fn render_number(size: u32, percent: Option<f64>, tone: Tone, light_taskbar: bool) -> Vec<u8> {
    let mut pm = Pixmap::new(size, size).expect("icon size");
    let s = size as f32;
    let (fg, accent) = colors(tone, light_taskbar);
    let (text, color) = match percent {
        Some(p) => {
            let alpha = if tone == Tone::Muted { 150 } else { 255 };
            (format!("{}", p.round().clamp(0.0, 100.0) as i64), Color::from_rgba8(accent.0, accent.1, accent.2, alpha))
        }
        None => ("–".into(), Color::from_rgba8(fg.0, fg.1, fg.2, 170)),
    };
    // Digits are ~0.7 em tall; a 1.25 em size, slightly condensed, fills most of the icon.
    draw_text(&mut pm, &text, s * 1.04, s * 1.25, 0.8, color);
    unpremultiply(pm.take())
}

/// `light_taskbar` picks foreground colours that read on the taskbar behind the icon.
pub fn render(size: u32, percent: Option<f64>, tone: Tone, light_taskbar: bool) -> Vec<u8> {
    let mut pm = Pixmap::new(size, size).expect("icon size");
    let s = size as f32;
    let (fg, accent) = colors(tone, light_taskbar);

    let stroke_w = (s * 0.125).max(1.6);
    let r = s / 2.0 - stroke_w / 2.0 - s * 0.02;
    let c = s / 2.0;

    // Track
    let mut track = Paint::default();
    track.anti_alias = true;
    track.set_color_rgba8(fg.0, fg.1, fg.2, if light_taskbar { 46 } else { 64 });
    if let Some(path) = arc(c, c, r, 0.0, 1.0) {
        pm.stroke_path(&path, &track, &Stroke { width: stroke_w, ..Stroke::default() }, Transform::identity(), None);
    }

    // Progress arc
    if let Some(p) = percent {
        let frac = (p / 100.0).clamp(0.0, 1.0) as f32;
        if frac > 0.0 {
            let mut paint = Paint::default();
            paint.anti_alias = true;
            let alpha = if tone == Tone::Muted { 150 } else { 255 };
            paint.set_color_rgba8(accent.0, accent.1, accent.2, alpha);
            let stroke = Stroke { width: stroke_w, line_cap: LineCap::Round, ..Stroke::default() };
            if let Some(path) = arc(c, c, r, 0.0, frac.max(0.02)) {
                pm.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
            }
        }
    }

    // Number
    let text = match percent {
        Some(p) => format!("{}", p.round().clamp(0.0, 100.0) as i64),
        None => "–".into(),
    };
    let text_alpha = if tone == Tone::Muted && percent.is_some() { 170 } else { 255 };
    draw_text(&mut pm, &text, (r - stroke_w / 2.0) * 2.0 * 0.86, s * 0.56, 1.0, Color::from_rgba8(fg.0, fg.1, fg.2, text_alpha));

    unpremultiply(pm.take())
}

/// macOS menu bar: ring only, the percentage goes into the tray title next to it.
/// Normal states are template images, so macOS tints them for light and dark menu
/// bars; warning and critical states are deliberately coloured. Returns (rgba, is_template).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn render_macos(size: u32, percent: Option<f64>, tone: Tone) -> (Vec<u8>, bool) {
    let mut pm = Pixmap::new(size, size).expect("icon size");
    let s = size as f32;
    let template = matches!(tone, Tone::Ok | Tone::Muted);
    let (track, arc_rgba) = match tone {
        Tone::Warn => ((128, 128, 128, 120), (236, 146, 26, 255)),
        Tone::Danger => ((128, 128, 128, 120), (232, 62, 72, 255)),
        Tone::Muted => ((0, 0, 0, 80), (0, 0, 0, 150)),
        Tone::Ok => ((0, 0, 0, 90), (0, 0, 0, 255)),
    };
    let stroke_w = s * 0.15;
    let r = s / 2.0 - stroke_w / 2.0 - s * 0.04;
    let c = s / 2.0;

    let mut paint = Paint::default();
    paint.anti_alias = true;
    paint.set_color_rgba8(track.0, track.1, track.2, track.3);
    if let Some(path) = arc(c, c, r, 0.0, 1.0) {
        pm.stroke_path(&path, &paint, &Stroke { width: stroke_w, ..Stroke::default() }, Transform::identity(), None);
    }
    if let Some(p) = percent {
        let frac = (p / 100.0).clamp(0.0, 1.0) as f32;
        if frac > 0.0 {
            paint.set_color_rgba8(arc_rgba.0, arc_rgba.1, arc_rgba.2, arc_rgba.3);
            let stroke = Stroke { width: stroke_w, line_cap: LineCap::Round, ..Stroke::default() };
            if let Some(path) = arc(c, c, r, 0.0, frac.max(0.02)) {
                pm.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
            }
        }
    }
    (unpremultiply(pm.take()), template)
}

/// tiny-skia stores premultiplied RGBA; Windows wants straight alpha.
fn unpremultiply(mut out: Vec<u8>) -> Vec<u8> {
    for px in out.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a > 0 && a < 255 {
            for ch in &mut px[..3] {
                *ch = ((*ch as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    out
}

/// Arc from `start` to `end` (fractions of a full turn, 0 = 12 o'clock, clockwise).
fn arc(cx: f32, cy: f32, r: f32, start: f32, end: f32) -> Option<tiny_skia::Path> {
    let steps = 96;
    let mut pb = PathBuilder::new();
    for i in 0..=steps {
        let t = start + (end - start) * i as f32 / steps as f32;
        let a = t * std::f32::consts::TAU - std::f32::consts::FRAC_PI_2;
        let (x, y) = (cx + r * a.cos(), cy + r * a.sin());
        if i == 0 {
            pb.move_to(x, y);
        } else {
            pb.line_to(x, y);
        }
    }
    if end - start >= 1.0 {
        pb.close();
    }
    pb.finish()
}

/// `x_ratio` < 1 condenses glyphs horizontally so digits can be taller.
fn draw_text(pm: &mut Pixmap, text: &str, max_w: f32, px: f32, x_ratio: f32, color: Color) {
    let Some(font) = font() else { return };
    let scale = |size: f32| PxScale { x: size * x_ratio, y: size };
    // Shrink until the string fits the available width.
    let mut size = px;
    let (glyphs, width) = loop {
        let sf = font.as_scaled(scale(size));
        let mut x = 0.0;
        let mut glyphs = Vec::new();
        let mut prev = None;
        for ch in text.chars() {
            let id = sf.glyph_id(ch);
            if let Some(p) = prev {
                x += sf.kern(p, id);
            }
            glyphs.push((id, x));
            x += sf.h_advance(id);
            prev = Some(id);
        }
        if x <= max_w || size < 6.0 {
            break (glyphs, x);
        }
        size -= 0.5;
    };
    let sf = font.as_scaled(scale(size));
    let w = pm.width() as f32;
    let h = pm.height() as f32;
    let x0 = ((w - width) / 2.0).round();
    // Centre on cap height rather than the full ascent so digits sit optically centred.
    let cap = sf.ascent() * 0.70;
    let baseline = ((h + cap) / 2.0).round();
    let stride = pm.width() as usize;
    let data = pm.data_mut();
    let (cr, cg, cb, ca) = (color.red(), color.green(), color.blue(), color.alpha());
    for (id, gx) in glyphs {
        let g = id.with_scale_and_position(scale(size), ab_glyph::point(x0 + gx, baseline));
        if let Some(outline) = font.outline_glyph(g) {
            let bb = outline.px_bounds();
            outline.draw(|x, y, cov| {
                let px = bb.min.x as i32 + x as i32;
                let py = bb.min.y as i32 + y as i32;
                if px < 0 || py < 0 || px >= w as i32 || py >= h as i32 {
                    return;
                }
                let i = (py as usize * stride + px as usize) * 4;
                let a = (cov.min(1.0) * ca).clamp(0.0, 1.0);
                // Source-over in premultiplied space.
                let inv = 1.0 - a;
                data[i] = (cr * a * 255.0 + data[i] as f32 * inv).round() as u8;
                data[i + 1] = (cg * a * 255.0 + data[i + 1] as f32 * inv).round() as u8;
                data[i + 2] = (cb * a * 255.0 + data[i + 2] as f32 * inv).round() as u8;
                data[i + 3] = (a * 255.0 + data[i + 3] as f32 * inv).round() as u8;
            });
        }
    }
}

#[cfg(windows)]
pub fn system_icon_size() -> u32 {
    let dpi = unsafe { windows_sys::Win32::UI::HiDpi::GetDpiForSystem() };
    ((16 * dpi.max(96)) as f32 / 96.0).round() as u32
}

#[cfg(not(windows))]
pub fn system_icon_size() -> u32 {
    32
}

/// Windows reads the taskbar theme separately from the app theme.
#[cfg(windows)]
pub fn taskbar_is_light() -> bool {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    let key: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\0".encode_utf16().collect();
    let val: Vec<u16> = "SystemUsesLightTheme\0".encode_utf16().collect();
    let mut data: u32 = 0;
    let mut len: u32 = 4;
    let rc = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), val.as_ptr(), RRF_RT_REG_DWORD, std::ptr::null_mut(), &mut data as *mut u32 as *mut _, &mut len)
    };
    rc == 0 && data == 1
}

#[cfg(not(windows))]
pub fn taskbar_is_light() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Writes preview PNGs of every style/tone/taskbar combination:
    /// `cargo test tray_preview -- --ignored` → target/tray-preview/*.png
    #[test]
    #[ignore]
    fn tray_preview() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/tray-preview");
        std::fs::create_dir_all(&dir).unwrap();
        for size in [16u32, 24, 28, 32] {
            for (p, tone) in [(Some(29.0), Tone::Ok), (Some(86.0), Tone::Warn), (Some(100.0), Tone::Danger), (Some(42.0), Tone::Muted), (None, Tone::Muted)] {
                for light in [false, true] {
                    for (name, rgba) in [("num", render_number(size, p, tone, light)), ("ring", render(size, p, tone, light))] {
                        let mut pm = Pixmap::new(size, size).unwrap();
                        // Re-premultiply for tiny-skia's PNG encoder.
                        for (dst, src) in pm.data_mut().chunks_exact_mut(4).zip(rgba.chunks_exact(4)) {
                            let a = src[3] as u32;
                            for i in 0..3 {
                                dst[i] = ((src[i] as u32 * a + 127) / 255) as u8;
                            }
                            dst[3] = src[3];
                        }
                        let f = format!("{name}-{size}-{}-{:?}-{}.png", if light { "light" } else { "dark" }, tone, p.map_or(-1, |v| v as i32));
                        pm.save_png(dir.join(f)).unwrap();
                    }
                }
            }
        }
    }
}
