import Parser from "web-tree-sitter";

export interface ParserConfig {
	wasmPath?: string;
	languagePath?: string;
}

export class TreeSitterParser {
	private parser: Parser | null = null;
	private language: any | null = null;
	private initialized = false;

	/**
	 * Initializes the tree-sitter parser with TypeScript support.
	 */
	public async initialize(config?: ParserConfig): Promise<void> {
		if (this.initialized) return;

		try {
			await Parser.init({
				wasmPath: config?.wasmPath || "./wasm/tree-sitter.wasm",
			});
			this.parser = new Parser();
			const lang = await Parser.Language.load(
				config?.languagePath || "./wasm/tree-sitter-typescript.wasm",
			);
			this.parser.setLanguage(lang);
			this.language = lang;
			this.initialized = true;
		} catch (error) {
			console.error("[pi-impact-analyzer] Initialization failed:", error);
			throw new Error(`Failed to initialize tree-sitter: ${error}`);
		}
	}

	/**
	 * Parses source code into an AST.
	 */
	public parse(source: string) {
		if (!this.parser) {
			throw new Error("Parser not initialized. Call initialize() first.");
		}
		return this.parser.parse(source);
	}

	/**
	 * Returns the loaded language for query creation.
	 */
	public getLanguage() {
		return this.language;
	}

	/**
	 * Checks if parser is ready.
	 */
	public isInitialized(): boolean {
		return this.initialized;
	}
}
