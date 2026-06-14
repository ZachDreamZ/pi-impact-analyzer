import * as path from "path";
import type { SymbolDefinition, ImportStatement, FileMetadata } from "./types";

/**
 * Configuration for path resolution
 */
export interface ResolverConfig {
	baseUrl?: string;
	paths?: Record<string, string[]>;
	rootDir?: string;
}

/**
 * Resolves imports to actual file paths and symbols.
 * Uses priority-based resolution with confidence scoring.
 */
export class SymbolResolver {
	private config: ResolverConfig;
	private fileIndex: Map<string, FileMetadata> = new Map();
	private symbolIndex: Map<string, SymbolDefinition[]> = new Map();

	constructor(config: ResolverConfig = {}) {
		this.config = {
			baseUrl: config.baseUrl || ".",
			paths: config.paths || {},
			rootDir: config.rootDir || ".",
		};
	}

	/**
	 * Index a file's metadata for resolution.
	 */
	public indexFile(metadata: FileMetadata): void {
		this.fileIndex.set(metadata.path, metadata);

		// Index symbols by name
		for (const symbol of metadata.symbols) {
			const existing = this.symbolIndex.get(symbol.name) || [];
			existing.push(symbol);
			this.symbolIndex.set(symbol.name, existing);
		}
	}

	/**
	 * Resolve an import to a file path.
	 */
	public resolveImportPath(
		importStmt: ImportStatement,
		fromFile: string,
	): string | null {
		const source = importStmt.source;

		// 1. Try path aliases from tsconfig
		const aliasResolved = this.resolvePathAlias(source);
		if (aliasResolved) return aliasResolved;

		// 2. Try relative imports
		if (source.startsWith(".")) {
			return this.resolveRelativePath(source, fromFile);
		}

		// 3. Try absolute imports (from baseUrl)
		const absoluteResolved = this.resolveAbsolutePath(source);
		if (absoluteResolved) return absoluteResolved;

		// 4. Node modules or external - skip
		return null;
	}

	/**
	 * Resolve a symbol name to its definition(s).
	 * Returns results with confidence scores.
	 */
	public resolveSymbol(
		symbolName: string,
		fromFile: string,
	): Array<{ symbol: SymbolDefinition; confidence: number }> {
		const results: Array<{ symbol: SymbolDefinition; confidence: number }> = [];
		const candidates = this.symbolIndex.get(symbolName) || [];

		for (const candidate of candidates) {
			const confidence = this.calculateConfidence(candidate, fromFile);
			results.push({ symbol: candidate, confidence });
		}

		// Sort by confidence (highest first)
		results.sort((a, b) => b.confidence - a.confidence);

		return results;
	}

	/**
	 * Find all symbols exported from a file.
	 */
	public getExportedSymbols(filePath: string): SymbolDefinition[] {
		const metadata = this.fileIndex.get(filePath);
		if (!metadata) return [];

		return metadata.symbols.filter((s) => s.isExported);
	}

	/**
	 * Get all files that could provide a symbol by name.
	 */
	public getFilesProvidingSymbol(symbolName: string): string[] {
		const symbols = this.symbolIndex.get(symbolName) || [];
		return [...new Set(symbols.map((s) => s.file))];
	}

	/**
	 * Clear all indexed data.
	 */
	public clear(): void {
		this.fileIndex.clear();
		this.symbolIndex.clear();
	}

	// ============ Private Helpers ============

	private resolvePathAlias(source: string): string | null {
		if (!this.config.paths) return null;

		for (const [alias, targets] of Object.entries(this.config.paths)) {
			// Convert tsconfig pattern: "@utils/*" -> ["src/utils/*"]
			const aliasPattern = alias.replace("*", "");
			const sourceWithoutAlias = source.replace(aliasPattern, "");

			if (source.startsWith(aliasPattern)) {
				for (const target of targets) {
					const targetPath = target.replace("*", sourceWithoutAlias);

					// Try different extensions
					for (const ext of [
						"",
						".ts",
						".tsx",
						".js",
						".jsx",
						"/index.ts",
						"/index.js",
					]) {
						const fullPath = path.join(
							this.config.rootDir || ".",
							targetPath + ext,
						);
						if (this.fileIndex.has(fullPath)) {
							return fullPath;
						}
					}
				}
			}
		}

		return null;
	}

	private resolveRelativePath(source: string, fromFile: string): string | null {
		const fromDir = path.dirname(fromFile);
		const resolved = path.join(fromDir, source);

		// Try different extensions
		for (const ext of [
			"",
			".ts",
			".tsx",
			".js",
			".jsx",
			"/index.ts",
			"/index.js",
		]) {
			const fullPath = resolved + ext;
			if (this.fileIndex.has(fullPath)) {
				return fullPath;
			}
		}

		return null;
	}

	private resolveAbsolutePath(source: string): string | null {
		// Try from baseUrl
		const basePath = path.join(this.config.baseUrl || ".", source);

		for (const ext of [
			"",
			".ts",
			".tsx",
			".js",
			".jsx",
			"/index.ts",
			"/index.js",
		]) {
			const fullPath = basePath + ext;
			if (this.fileIndex.has(fullPath)) {
				return fullPath;
			}
		}

		return null;
	}

	private calculateConfidence(
		candidate: SymbolDefinition,
		fromFile: string,
	): number {
		// 1. Same file - highest confidence
		if (candidate.file === fromFile) {
			return 1.0;
		}

		const candidateDir = path.dirname(candidate.file);
		const fromDir = path.dirname(fromFile);

		// 2. Same directory
		if (candidateDir === fromDir) {
			return 0.9;
		}

		// 3. Sibling directory
		const candidateParent = path.dirname(candidateDir);
		const fromParent = path.dirname(fromDir);
		if (candidateParent === fromParent) {
			return 0.7;
		}

		// 4. Same project (within 2 levels)
		const candidateDepth = candidateDir.split(path.sep).length;
		const fromDepth = fromDir.split(path.sep).length;
		if (Math.abs(candidateDepth - fromDepth) <= 2) {
			return 0.5;
		}

		// 5. Global fallback
		return 0.3;
	}
}
