# Changelog

## 2.3.2

### Fixed
- **Chat slash-commands (`/macroname`) broke on Foundry v14.** The `chatMessage` handler guarded on `chatLog.constructor.MESSAGE_PATTERNS.macro`, but v14 turned `ChatLog.MESSAGE_PATTERNS` into a legacy write-only shim, so `.macro` was `undefined`. `String.prototype.match(undefined)` matches the empty string (truthy), which made the handler bail before running any macro — Foundry then rejected the input with "X is not a valid chat message command." The handler now decides whether input is a real command via `ChatLog.parse` (available on v13 and v14) and no longer references `MESSAGE_PATTERNS`.

### Added
- **Macro / built-in command conflict warnings.** The GM is warned in chat (privately) when a macro's name collides with a built-in chat command (e.g. `r`, `w`, `gm`, `me`, `macro`), which would otherwise make the macro silently unreachable via `/name`. Fires at world load and whenever a macro is created or renamed into a conflict. Toggle with the new **Warn on macro/command conflicts** world setting (default on).

### Changed
- Version-adaptive `ChatLog` resolution and a fully guarded chat handler that can never throw out of the hook.
- Declared compatibility raised to **verified 14** (minimum 12).
- Added a `ready` log line reporting the module version and detected Foundry generation.

## 2.3.1
- Prior forked release with Foundry v13 compatibility fixes (upstream mclemente fork).
