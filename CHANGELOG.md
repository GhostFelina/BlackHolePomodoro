# Changelog

All notable changes to BlackHolock are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-07-19

First public release.

### Added
- **Gargantua**, a physically ray-traced Schwarzschild black hole. Photon
  geodesics are integrated per pixel, so the shadow, photon ring, the accretion
  disc lensed over the top, relativistic Doppler beaming and gravitational
  redshift all emerge from the physics rather than being drawn on top of it.
- **Desktop lensing.** Your real screen is captured into GPU memory and sampled
  along the deflected ray, bending your windows around the hole.
- **Eclipse** and **Void Field** effects, plus a plug-in registry so a new
  effect is one file and one line.
- Focus cycle with configurable focus length, break length and countdown
  window; presets for 25/5, 50/10 and 90/15.
- Three break strictness levels. In the default, the skip control appears after
  a delay and requires a second confirming press.
- Multi-display overlays: every screen is covered.
- 11 languages with instant switching and full right-to-left layout for Arabic.
- Accessibility: reduce-motion, intensity control, and a motion-free effect.
- macOS and Windows installers.

### Security & privacy
- No accounts, servers, analytics, crash reporting or identifiers.
- The only outbound request is an optional, anonymous version check that can be
  switched off.
- Captured screen frames never leave the GPU: never written to disk, never
  encoded, never transmitted.
- The overlay sets content protection, so it is excluded from its own capture.

### Notes
- Builds are currently unsigned. macOS and Windows will warn on first launch
  until code-signing certificates are in place.
