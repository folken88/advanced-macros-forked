# Advanced Macros (Forked)

Call macros directly from chat with arguments, run macros as other users, and run world scripts on startup — updated for **Foundry VTT v13 and v14**.

This is the Folken fork of [mclemente's Advanced Macros fork](https://github.com/mclemente), itself a continuation of the original *Advanced Macros* module. It keeps the module working across the v13/v14 chat and sidebar rewrites and adds a safety warning for macro names that collide with built-in commands.

## Features

### Chat slash-commands (`/macroname`)
With the **Chat Slash Command** setting enabled, type `/<macroName> [args]` in chat to run a macro without the `/macro` prefix — e.g. `/per` runs a macro named `per`. Multi-word macro names are supported (`/ser toche perception`). Built-in commands (`/roll`, `/whisper`, `/gm`, `/macro`, …) are always left to Foundry, so the feature only ever handles names Foundry itself doesn't recognize.

### Run macros as specific users
On a script macro's config sheet, choose who executes it — the GM, every player, everyone-but-you, or a single named user — via a secure `query` round-trip. GM-only execution is restricted to macros authored by a GM and not editable by players.

### World scripts
Flag a macro as a **World Script (Setup)** or **World Script (Ready)** to have it run automatically at the corresponding Foundry lifecycle hook.

### Macro / command conflict warnings *(new)*
If a macro's name matches a built-in chat command (for example a macro literally named `r`, `w`, `gm`, or `me`), typing `/name` runs the **built-in command**, not the macro — so the macro is unreachable from chat. With the **Warn on macro/command conflicts** setting enabled (default on), the GM receives a private chat warning listing any such macros, both at world load and whenever a macro is created or renamed into a conflict.

## Version compatibility

The module is version-adaptive: it resolves the `ChatLog` class and uses `ChatLog.parse` (present on both v13 and v14) to decide whether input is a real command, rather than depending on the `ChatLog.MESSAGE_PATTERNS` API that v14 turned into a legacy write-only shim. The chat handler is fully guarded so a parsing hiccup can never cause Foundry to reject a legitimate message.

- **Minimum:** Foundry v12
- **Verified:** Foundry v14

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Chat Slash Command | off | Run macros by typing `/macroName` in chat. |
| Warn on macro/command conflicts | on | Warn the GM in chat about macros shadowed by built-in commands. |

## License

Inherits the license of the upstream Advanced Macros module. See `LICENSE` if present in the upstream repository.
