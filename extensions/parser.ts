import Parser from "web-tree-sitter";
import path from "path";
import fs from "fs";

export interface ParserConfig {
	languagePath?: string;
	/** Language type: "typescript" (default) or "tsx" */
	language?: "typescript" | "tsx";
}

/**
 * Log function that can be overridden for different environments
 */
let logFn: (...args: unknown[]) => void = () => {
	// Default no-op to avoid console dependency
};

export function setLogger(logger: (...args: unknown[]) => void): void {
	logFn = logger;
}

/**
 * Resolve path to a WASM file relative to the package root.
 * Tries both dist/extensions/ (built) and extensions/ (ts-jest in-place) modes.
 */
function resolveWasmPath(wasmFile: string): string {
	const locations = [
		path.join(__dirname, "..", "..", "wasm", wasmFile),
		path.join(__dirname, "..", "wasm", wasmFile),
	];
	for (const loc of locations) {
		if (fs.existsSync(loc)) return loc;
	}
	return locations[0]; // return first as default (will throw at load time)
}

function readWasm(filePath: string): Uint8Array {
	return new Uint8Array(fs.readFileSync(filePath));
}

export class TreeSitterParser {
	private parser: Parser | null = null;
	private languages: Map<string, Parser.Language> = new Map();
	private currentLanguageName: string = "typescript";
	private initialized = false;

	/**
	 * Initializes the tree-sitter parser with TypeScript and TSX support.
	 *
	 * Loads both grammars from the local wasm/ directory.
	 * The core tree-sitter WASM is resolved automatically from the npm package.
	 */
	public async initialize(config?: ParserConfig): Promise<void> {
		if (this.initialized) return;

		try {
			await Parser.init();
			this.parser = new Parser();

			// Load TypeScript grammar
			const tsWasm = this.loadLanguageWasm(
				"tree-sitter-typescript.wasm",
				config?.languagePath,
			);
			const tsLang = await Parser.Language.load(tsWasm);
			this.languages.set("typescript", tsLang);

			// Load TSX grammar
			const tsxWasm = this.loadLanguageWasm("tree-sitter-tsx.wasm");
			const tsxLang = await Parser.Language.load(tsxWasm);
			this.languages.set("tsx", tsxLang);

			// Set default language to TypeScript
			this.parser.setLanguage(tsLang);
			this.currentLanguageName = "typescript";
			this.initialized = true;
		} catch (error) {
			logFn("[pi-impact-analyzer] Initialization failed:", error);
			throw new Error(`Failed to initialize tree-sitter: ${error}`);
		}
	}

	/**
	 * Parses source code using the currently active language.
	 * Backward-compatible: works exactly like the old parse().
	 */
	public parse(source: string) {
		if (!this.parser) {
			throw new Error("Parser not initialized. Call initialize() first.");
		}
		return this.parser.parse(source);
	}

	/**
	 * Auto-detect the language for a file path and parse its content.
	 * Switches the parser language if needed.
	 */
	public parseFile(filePath: string, content: string) {
		this.setLanguageForFile(filePath);
		return this.parse(content);
	}

	/**
	 * Switch the parser language based on file extension.
	 * - .ts, .tsx → TSX grammar (TSX handles both .ts and .tsx)
	 * - .js, .jsx, .mjs, .cjs → TSX grammar (JS is a subset)
	 */
	public setLanguageForFile(filePath: string): void {
		if (!this.parser) {
			throw new Error("Parser not initialized. Call initialize() first.");
		}

		const ext = path.extname(filePath).toLowerCase();
		const langName = ext === ".tsx" || ext === ".jsx" ? "tsx" : "typescript";

		if (this.currentLanguageName !== langName) {
			const lang = this.languages.get(langName);
			if (lang) {
				this.parser.setLanguage(lang);
				this.currentLanguageName = langName;
			}
		}
	}

	/**
	 * Returns the currently active language.
	 */
	public getLanguage(): Parser.Language | null {
		return this.languages.get(this.currentLanguageName) || null;
	}

	/**
	 * Returns a specific language by name ("typescript" or "tsx").
	 */
	public getLanguageByName(name: string): Parser.Language | undefined {
		return this.languages.get(name);
	}

	/**
	 * Returns the name of the currently active language.
	 */
	public getCurrentLanguageName(): string {
		return this.currentLanguageName;
	}

	/**
	 * Checks if parser is ready.
	 */
	public isInitialized(): boolean {
		return this.initialized;
	}

	// ============ Private Helpers ============

	/**
	 * Load a grammar WASM file as a Uint8Array.
	 */
	private loadLanguageWasm(
		wasmFile: string,
		overridePath?: string,
	): Uint8Array {
		// Explicit path provided via config (only for first language)
		if (overridePath && wasmFile === "tree-sitter-typescript.wasm") {
			try {
				return readWasm(path.resolve(overridePath));
			} catch {
				// fall through to default locations
			}
		}

		const wasmPath = resolveWasmPath(wasmFile);
		try {
			return readWasm(wasmPath);
		} catch {
			throw new Error(
				`Could not load grammar WASM: ${wasmFile}. ` +
					`Ensure the file is present in the wasm/ directory. ` +
					`Tried: ${wasmPath}`,
			);
		}
	}
}
