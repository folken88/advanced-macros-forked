const MODULE_ID = "advanced-macros-forked";
const MODULE_VERSION = "2.3.3";

/**
 * Resolve the ChatLog application class across Foundry versions.
 * v13+ namespaces it under foundry.applications.sidebar.tabs.ChatLog; older cores expose ui.chat.constructor.
 * @returns {typeof foundry.applications.sidebar.tabs.ChatLog | undefined}
 */
function getChatLogClass() {
	return ui.chat?.constructor ?? foundry.applications?.sidebar?.tabs?.ChatLog ?? globalThis.ChatLog;
}

/**
 * Ask core whether a slash-command string maps to a registered command.
 * Uses ChatLog.parse, which works on both v13 and v14 (v14 returns ["invalid", …] for unknown commands).
 * @param {string} text - Full chat input, e.g. "/per".
 * @returns {string} The command rule name, or "invalid"/"none".
 */
function parseCommand(text) {
	const ChatLogCls = getChatLogClass();
	try {
		const parsed = ChatLogCls?.parse?.(text);
		if (Array.isArray(parsed)) return parsed[0] ?? "none";
		return parsed?.[0] ?? "none";
	} catch (err) {
		return "invalid";
	}
}

Hooks.once("init", () => {
	class AdvancedMacro extends CONFIG.Macro.documentClass {
		static metadata = Object.freeze(foundry.utils.mergeObject(super.metadata, {
			preserveOnImport: ["_id", "sort", "ownership", "author"]
		}, {inplace: false}));

		canUserExecute(user) {
			if (!this.testUserPermission(user, "LIMITED")) return false;
			return this.type === "script" ? user.can("MACRO_SCRIPT") || (this.canRunAsGM && !user.isGM) : true;
		}

		/**
		 * Defines whether a Macro can run as a GM.
		 * For security reasons, only macros authored by the GM, and not editable by users
		 * can be run as GM
		 */
		get canRunAsGM() {
			const author = game.users.get(this.author?.id);
			const permissions = foundry.utils.deepClone(this.ownership) || {};

			for (const user of game.users.contents) {
				if (user.isGM || user.id === author?.id) delete permissions[user.id];
			}
			const highestPermissionLevel = Math.max(...Object.values(permissions));
			return author?.isGM && highestPermissionLevel < CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
		}

		async execute(scope = {}, callFromSocket = false) {
			if (!this.canExecute) {
				return ui.notifications.warn(`You do not have permission to execute Macro "${this.name}".`);
			}
			switch (this.type) {
				case "chat":
					return super.execute(scope);
				case "script": {
					const queryData = { macro: this.id, scope };
					const runFor = this.getFlag("advanced-macros-forked", "runForSpecificUser");
					const runQuery = (user) => user.query("advanced-macros-forked.executeMacro", queryData, { timeout: 30000 });
					if (callFromSocket || !runFor || runFor === "runAsWorldScript" || runFor === "runAsWorldScriptSetup" || !this.canRunAsGM) {
						return super.execute(scope);
					} else if (runFor === "GM") {
						if (game.users.activeGM?.isSelf) return super.execute(scope);
						return runQuery(game.users.activeGM);
					} else if (runFor === "runForEveryone") {
						return game.users.filter((u) => u.active).forEach(runQuery);
					} else if (runFor === "runForEveryoneElse") {
						return game.users.filter((u) => u.active && u.id !== game.user.id).forEach(runQuery);
					} else if (runFor) {
						return runQuery(game.users.find((u) => u.id === runFor));
					}
				}
			}
		}
	}

	CONFIG.Macro.documentClass = AdvancedMacro;
	game.settings.register("advanced-macros-forked", "legacySlashCommand", {
		name: "advanced-macros.setting.legacySlashCommand.name",
		hint: "advanced-macros.setting.legacySlashCommand.hint",
		scope: "world",
		config: true,
		default: false,
		type: Boolean,
	});
	game.settings.register("advanced-macros-forked", "warnCommandConflicts", {
		name: "Warn on macro/command conflicts",
		hint: "When enabled, the GM is warned in chat if any macro's name matches a built-in Foundry chat command (e.g. a macro named \"r\" or \"w\"), which makes it unreachable via /name.",
		scope: "world",
		config: true,
		default: true,
		type: Boolean,
	});
	CONFIG.queries["advanced-macros-forked.executeMacro"] = (queryData) => {
		const { macro, scope } = queryData;
		return game.macros.get(macro)?.execute(scope, true);
	};
});

/**
 * Chat slash-command handler.
 * When the "legacySlashCommand" setting is on, typing "/<macroName> [args]" runs a matching macro if the
 * command is not one of Foundry's built-in chat commands. Version-adaptive and fully guarded so it can
 * never throw out of the hook (which would let core reject the message as an invalid command).
 */
Hooks.on("chatMessage", (chatLog, message, chatData) => {
	try {
		if (!game.settings.get("advanced-macros-forked", "legacySlashCommand")) return true;
		const raw = typeof message === "string" ? message : "";
		// The v13+ ProseMirror chat input serializes plain input to HTML (e.g. "<p>/per</p>").
		// Extract the plain text so slash detection and macro-name parsing see "/per", not the markup.
		let text = raw;
		try {
			const div = document.createElement("div");
			div.innerHTML = raw;
			text = div.textContent ?? raw;
		} catch (_) { /* fall back to the raw string */ }
		text = text.trim();
		if (!text.startsWith("/")) return true;

		// If core recognizes this as a real command (roll, whisper, macro, …), don't interfere.
		const command = parseCommand(text);
		if (command !== "invalid" && command !== "none") return true;

		// Unrecognized "/command": try to resolve a macro by name, supporting multi-word names.
		const parts = text.slice(1).split(/\s+/);
		let macroName = parts[0];
		let macro = game.macros.getName(macroName);
		for (const token of parts.slice(1)) {
			if (macro) break;
			macroName += ` ${token}`;
			macro = game.macros.getName(macroName);
		}
		if (macro) {
			macro.execute();
			return false; // Prevent core from raising "not a valid chat message command".
		}
	} catch (err) {
		console.error(`${MODULE_ID} | error in chat slash-command handler`, err);
	}
	return true;
});

/* -------------------------------------------- */
/*  Macro ↔ built-in command conflict warnings                        */
/* -------------------------------------------- */

/**
 * Find macros whose name collides with a built-in chat command, making "/name" unreachable.
 * @returns {{name: string, command: string}[]}
 */
function findCommandConflicts() {
	const seen = new Map();
	for (const macro of game.macros) {
		const name = macro?.name?.trim();
		if (!name || seen.has(name)) continue;
		// Probe with a dummy argument so commands that require one (e.g. /r <expr>) still match.
		const command = parseCommand(`/${name} 1`);
		if (command !== "invalid" && command !== "none") seen.set(name, command);
	}
	return [...seen.entries()].map(([name, command]) => ({ name, command }));
}

/**
 * Whisper the GM(s) a warning listing macro/command conflicts.
 * @param {{name: string, command: string}[]} conflicts
 */
async function warnCommandConflicts(conflicts) {
	if (!conflicts.length) return;
	if (!game.settings.get("advanced-macros-forked", "warnCommandConflicts")) return;
	const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
	if (!gmIds.length) return;
	const items = conflicts
		.map((c) => `<li><strong>${foundry.utils.escapeHTML?.(c.name) ?? c.name}</strong> &rarr; shadowed by the built-in <code>/${c.command}</code> command</li>`)
		.join("");
	const content =
		`<div class="advanced-macros-conflict-warning">` +
		`<p><i class="fas fa-triangle-exclamation"></i> <strong>Advanced Macros:</strong> ` +
		`${conflicts.length} macro name${conflicts.length === 1 ? "" : "s"} conflict with built-in chat commands ` +
		`and cannot be triggered via <code>/name</code>:</p><ul>${items}</ul>` +
		`<p><em>Rename these macros if you want to run them from chat.</em></p></div>`;
	const ChatMessageCls = foundry.documents?.ChatMessage?.implementation ?? ChatMessage;
	await ChatMessageCls.create({
		content,
		whisper: gmIds,
		speaker: { alias: "Advanced Macros" },
	});
}

function runWorldScripts(key) {
		const worldScripts = game.macros.contents.filter(
			(macro) => macro.getFlag("advanced-macros-forked", "runForSpecificUser") === key
		);
	for (const macro of worldScripts) {
		try {
			macro.execute();
			console.debug(`Advanced Macros | Executed "${macro.name}" world script (ID: ${macro.id})`);
		} catch(err) {
			console.error(`Advanced Macros | Error executing "${macro.name}" world script (ID: ${macro.id})`, err);
		}
	}
}

Hooks.once("setup", () => runWorldScripts("runAsWorldScriptSetup"));

Hooks.once("ready", () => {
	const gen = game.release?.generation ?? "?";
	console.log(`${MODULE_ID} | v${MODULE_VERSION} ready (Foundry generation ${gen})`);

	// Warn the GM about any macros shadowed by built-in commands.
	if (game.user.isGM) {
		try {
			warnCommandConflicts(findCommandConflicts());
		} catch (err) {
			console.error(`${MODULE_ID} | conflict scan failed`, err);
		}
	}

	// Warn immediately when a macro is created or renamed into a conflict.
	const checkOne = (macro) => {
		if (!game.user.isGM) return;
		const name = macro?.name?.trim();
		if (!name) return;
		const command = parseCommand(`/${name} 1`);
		if (command !== "invalid" && command !== "none") warnCommandConflicts([{ name, command }]);
	};
	Hooks.on("createMacro", (macro) => checkOne(macro));
	Hooks.on("updateMacro", (macro, changes) => { if ("name" in (changes ?? {})) checkOne(macro); });

	Hooks.on("renderMacroConfig", (obj, html, data) => {
		if (!game.user.isGM) return;
		const macro = obj.document;
		// A re-render will cause the html object to be the internal element, which is the form itself.
		const typeSelect = html.querySelector("select[name=type]");
		const typeGroup = typeSelect.closest(".form-group");
		const options = [
			{
				value: "GM",
				label: game.i18n.localize("USER.RoleGamemaster")
			},
			...["runForEveryone", "runForEveryoneElse"].map((run) => ({
				value: run,
				label: game.i18n.localize(`advanced-macros.MACROS.${run}`),
				group: "DOCUMENT.Users"
			})),
			...["runAsWorldScriptSetup", "runAsWorldScript"].map((run) => ({
				value: run,
				label: game.i18n.localize(`advanced-macros.MACROS.${run}`),
				group: "advanced-macros.MACROS.WorldScript"
			})),
			...game.users.players
				.map((user) => ({
					value: user.id,
					label: user.name,
					group: "PLAYERS.Title",
				})),
		];

		const select = foundry.applications.fields.createSelectInput({
			name: "flags.advanced-macros-forked.runForSpecificUser",
			options,
			value: macro.getFlag("advanced-macros-forked", "runForSpecificUser"),
			blank: "",
			labelAttr: "label",
			localize: true,
			disabled: !macro.canRunAsGM
		});

		const specificOneDiv = $(`
			<div class="form-group" ${macro.type === "chat" ? 'style="display: none"' : ""}>
				<label>${game.i18n.localize("advanced-macros.MACROS.runForSpecificUser")}</label>
				<div class="form-fields">${select.outerHTML}</div>
			</div>
		`);

		specificOneDiv.insertAfter(typeGroup);

		typeSelect.addEventListener("change", (event) => {
			if (event.target.value === "chat") specificOneDiv.hide();
			else specificOneDiv.show();
		});
	});
	runWorldScripts("runAsWorldScript");
});
