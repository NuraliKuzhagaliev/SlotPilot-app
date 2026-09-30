# SlotPilot 0.3.2 for Windows

An English-language desktop client for the existing SlotPilot AI booking service.

- English tabs, menus, loading/error screens, microphone dialogs and installer.
- Home, Book a visit, Admin and Demo in one native window.
- Immediate tab switching without navigation confirmation dialogs; the previous document stays loaded.
- Restricted audio-only microphone permission, isolated HTTPS pages and server-held provider credentials.
- Per-user Windows x64 installer and portable executable, both unsigned.

Choose **Setup** to install with shortcuts, or **Portable** to run without installation. Close an older running SlotPilot version first.

No API key setup is needed in the client. An internet connection, a SlotPilot account and microphone consent are required for voice use. The existing server owns the permanent credentials; voice depends on the provider's availability and credits.

Local validation: 6 policy tests, syntax checks, real Electron loading/isolation/tab/reconnect checks and both Windows builds. Live microphone conversation, audible interruption latency and complete voice booking acceptance are still unverified. No production-readiness claim is made.

`SHA256SUMS-0.3.2.txt` covers the two executables included in this release. Read `INSTALL_WINDOWS_EN.txt` for setup instructions.
