# Changelog

## [1.0.1] - 2026-09-11

### Fixed

- Fixed blank floating and management windows in packaged builds by using relative Vite asset paths.
- Reduced the Windows package size by keeping only English and Simplified Chinese Electron locales.
- Switched the Windows distribution to a tested zip package.

## [1.0.0] - 2026-09-11

### Added

- Desktop floating window for daily work items.
- Monthly management console with daily record editing.
- Item status management for in progress, completed, blocked, and abandoned work.
- AI-generated daily reports and date-range reports through OpenAI-compatible APIs.
- Scheduled daily report generation while the application is running.
- SQLite local persistence with `better-sqlite3`.
- JSON record export/import and full data export/import.
- System tray actions for opening the floating window and management console.
- MIT open-source license and project documentation.
