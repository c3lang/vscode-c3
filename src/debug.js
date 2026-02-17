import vscode from "vscode";
import childProcess from "child_process";
import fs from "fs";
import path from "path";

class C3DebugConfigurationProvider {
	provideDebugConfigurations(folder, token) {
		return [
			{
				type: "c3",
				request: "launch",
				name: "Debug C3 Program",
				program: "${workspaceFolder}/build/${workspaceFolderBasename}",
				args: [],
				cwd: "${workspaceFolder}",
				stopOnEntry: false,
			},
		];
	}

	async resolveDebugConfiguration(folder, config, token) {
		if (!config.type && !config.request && !config.name) {
			if (folder) {
				const programPath = detectProgramPath(folder);
				if (!programPath) return undefined;

				const launchConfig = {
					version: "0.2.0",
					configurations: [
						{
							type: "c3",
							request: "launch",
							name: "Debug C3 Program",
							program: programPath,
							args: [],
							cwd: "${workspaceFolder}",
							stopOnEntry: false,
						},
					],
				};

				const vscodePath = path.join(folder.uri.fsPath, ".vscode");
				const launchPath = path.join(vscodePath, "launch.json");

				if (!fs.existsSync(launchPath)) {
					fs.mkdirSync(vscodePath, { recursive: true });
					fs.writeFileSync(launchPath, JSON.stringify(launchConfig, null, "\t"));
				}

				config = launchConfig.configurations[0];
			} else {
				config.type = "c3";
				config.request = "launch";
				config.name = "Debug C3 Program";
			}
		}

		if (!config.program) {
			config.program = detectProgramPath(folder);
			if (!config.program) {
				return undefined;
			}
		}

		config.cwd = config.cwd || (folder ? folder.uri.fsPath : undefined);
		config.args = config.args || [];

		// Always stop at main so GDB can handle setup requests.
		// If user didn't want stopOnEntry, the adapter will auto-continue.
		config.stopAtBeginningOfMainSubprogram = true;
		config._userStopOnEntry = config.stopOnEntry ?? false;
		delete config.stopOnEntry;

		return config;
	}
}

// Requests that GDB cannot handle while the program is running.
// We intercept these and either buffer them or return stub responses.
const NEEDS_STOPPED_REQUESTS = new Set([
	"setFunctionBreakpoints",
	"setInstructionBreakpoints",
	"setExceptionBreakpoints",
	"breakpointLocations",
	"configurationDone",
]);

class GdbDebugAdapter {
	constructor(gdbPath, userStopOnEntry) {
		this._onDidSendMessage = new vscode.EventEmitter();
		this.onDidSendMessage = this._onDidSendMessage.event;
		this._hasStopped = false;
		this._pendingGdbEvents = [];
		this._pendingVscRequests = [];
		this._userStopOnEntry = userStopOnEntry;

		this._process = childProcess.spawn(gdbPath, ["--interpreter=dap"], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		this._buffer = "";
		this._process.stdout.on("data", (data) => {
			this._buffer += data.toString();
			this._processMessages();
		});

		this._process.stderr.on("data", (data) => {
			console.error("GDB stderr:", data.toString());
		});

		this._process.on("exit", (code) => {
			this._onDidSendMessage.fire({
				type: "event",
				event: "terminated",
			});
		});
	}

	_processMessages() {
		while (true) {
			const headerEnd = this._buffer.indexOf("\r\n\r\n");
			if (headerEnd === -1) break;

			const header = this._buffer.substring(0, headerEnd);
			const match = header.match(/Content-Length:\s*(\d+)/);
			if (!match) break;

			const contentLength = parseInt(match[1], 10);
			const bodyStart = headerEnd + 4;

			if (this._buffer.length < bodyStart + contentLength) break;

			const body = this._buffer.substring(bodyStart, bodyStart + contentLength);
			this._buffer = this._buffer.substring(bodyStart + contentLength);

			try {
				const message = JSON.parse(body);
				this._handleGdbMessage(message);
			} catch (e) {
				console.error("Failed to parse GDB DAP message:", e);
			}
		}
	}

	_handleGdbMessage(message) {
		if (!this._hasStopped && message.type === "event") {
			if (message.event === "stopped") {
				this._hasStopped = true;

				// Flush buffered GDB events (thread, process)
				for (const pending of this._pendingGdbEvents) {
					this._onDidSendMessage.fire(pending);
				}
				this._pendingGdbEvents = [];

				// Replay buffered VS Code requests now that GDB is stopped
				for (const req of this._pendingVscRequests) {
					this._sendToGdb(req);
				}
				this._pendingVscRequests = [];

				if (!this._userStopOnEntry) {
					// User didn't want to stop — send continue and suppress stopped event
					this._sendToGdb({
						command: "continue",
						arguments: { threadId: message.body?.threadId ?? 1 },
						type: "request",
						seq: 99999,
					});
					return;
				}

				this._onDidSendMessage.fire(message);
				return;
			}
			if (message.event === "thread" || message.event === "process") {
				this._pendingGdbEvents.push(message);
				return;
			}
		}

		// Suppress the internal continue response
		if (
			message.type === "response" &&
			message.request_seq === 99999 &&
			message.command === "continue"
		) {
			return;
		}

		this._onDidSendMessage.fire(message);
	}

	handleMessage(message) {
		// Intercept requests that GDB can't handle while the program is loading
		if (
			!this._hasStopped &&
			message.type === "request" &&
			NEEDS_STOPPED_REQUESTS.has(message.command)
		) {
			// Buffer configurationDone to replay after stop
			if (message.command === "configurationDone") {
				this._pendingVscRequests.push(message);
				// Send a fake success response to VS Code immediately
				this._onDidSendMessage.fire({
					type: "response",
					request_seq: message.seq,
					command: message.command,
					success: true,
					seq: 0,
				});
				return;
			}

			// For empty breakpoint requests, return success stubs
			this._onDidSendMessage.fire({
				type: "response",
				request_seq: message.seq,
				command: message.command,
				body: { breakpoints: [] },
				success: true,
				seq: 0,
			});
			return;
		}

		this._sendToGdb(message);
	}

	_sendToGdb(message) {
		const data = JSON.stringify(message);
		this._process.stdin.write(`Content-Length: ${data.length}\r\n\r\n${data}`);
	}

	dispose() {
		this._process.kill();
	}
}

class C3DebugAdapterDescriptorFactory {
	createDebugAdapterDescriptor(session, executable) {
		const gdbPath =
			session.configuration.gdbPath ||
			vscode.workspace.getConfiguration("c3.debug").get("gdbPath") ||
			"gdb";

		const version = getGdbVersion(gdbPath);
		if (version === null) {
			vscode.window.showErrorMessage(
				`GDB not found at '${gdbPath}'. Install GDB 14+ or configure the path in Settings > c3.debug.gdbPath.`,
			);
			return undefined;
		}
		if (version.major < 14) {
			vscode.window.showErrorMessage(
				`GDB 14+ is required for DAP support (--interpreter=dap). Found version ${version.major}.${version.minor}. Please upgrade GDB or set a path to a newer GDB in Settings > c3.debug.gdbPath.`,
			);
			return undefined;
		}

		const userStopOnEntry = session.configuration._userStopOnEntry ?? false;
		return new vscode.DebugAdapterInlineImplementation(new GdbDebugAdapter(gdbPath, userStopOnEntry));
	}
}

function getGdbVersion(gdbPath) {
	try {
		const output = childProcess.execFileSync(gdbPath, ["--version"], {
			encoding: "utf8",
			timeout: 5000,
		});
		const match = output.match(/(\d+)\.(\d+)/);
		if (match) {
			return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) };
		}
		return null;
	} catch {
		return null;
	}
}

function detectProgramPath(folder) {
	if (!folder) {
		vscode.window.showErrorMessage(
			"Open a workspace folder to debug a C3 program, or set 'program' in launch.json.",
		);
		return null;
	}

	const workspacePath = folder.uri.fsPath;
	const projectJsonPath = path.join(workspacePath, "project.json");

	let programName = path.basename(workspacePath);

	try {
		const raw = fs.readFileSync(projectJsonPath, "utf8");
		const project = JSON.parse(raw);
		if (project.name) {
			programName = project.name;
		} else if (project.targets) {
			const exeTarget = Object.keys(project.targets).find(
				(key) => project.targets[key].type === "executable",
			);
			if (exeTarget) {
				programName = exeTarget;
			}
		}
	} catch {
		// No project.json or invalid JSON — use workspace folder name
	}

	const isWindows = process.platform === "win32";
	const exeName = isWindows ? `${programName}.exe` : programName;
	const programPath = path.join(workspacePath, "build", exeName);

	if (!fs.existsSync(programPath)) {
		vscode.window.showErrorMessage(
			`Could not find C3 executable at '${programPath}'. Build your project with 'c3c build -g' first, or set 'program' in launch.json.`,
		);
		return null;
	}

	return programPath;
}

export function setupDebug(context) {
	const provider = new C3DebugConfigurationProvider();
	const factory = new C3DebugAdapterDescriptorFactory();

	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider("c3", provider),
		vscode.debug.registerDebugAdapterDescriptorFactory("c3", factory),
	);
}
