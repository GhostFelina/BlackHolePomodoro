# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | ✅ |

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/GhostFelina/BlackHolePomodoro/security/advisories/new)
rather than in a public issue.

Expect an acknowledgement within 72 hours and an assessment within a week.

## Threat model

BlackHolock has an unusually small attack surface, which is worth stating
plainly so reports can be aimed well:

- **No network server, no listening ports.** The app never accepts inbound
  connections.
- **One outbound request**, optional and disable-able: an anonymous GET to the
  public GitHub Releases API. It carries no credentials and its only effect is
  displaying a version number.
- **No accounts, no credentials, no tokens** are stored or handled anywhere.
- **No auto-update mechanism.** The app never downloads or executes code.
- **Renderer processes are locked down**: `nodeIntegration` off,
  `contextIsolation` on, and a preload that exposes a fixed list of typed
  methods with no generic IPC passthrough.
- **Screen capture** is the most sensitive capability. Frames are uploaded to a
  GPU texture and never written to disk, encoded, or transmitted. Capture stops
  and the stream is released as soon as the effect leaves the screen.

Areas where a report would be most valuable: any path by which renderer content
could reach the main process outside the declared preload surface, anything that
could cause captured frames to be persisted or transmitted, and any way the
break overlay could deny access to the machine beyond the configured duration.
