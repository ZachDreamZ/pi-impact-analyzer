/**
 * Core types for pi-impact-analyzer
 */

/** A symbol definition in the codebase */
export interface SymbolDefinition {
	name: string;
	type: "function" | "class" | "method" | "variable" | "interface" | "type";
	file: string;
	line: number;
	column: number;
	endLine: number;
	endColumn: number;
	startIndex: number;
	endIndex: number;
	isExported: boolean;
}

/** A call site in the codebase */
export interface CallSite {
	callerSymbol: string;
	callerFile: string;
	calleeName: string;
	line: number;
	column: number;
}

/** An import statement */
export interface ImportStatement {
	source: string;
	symbols: Array<{
		name: string;
		alias?: string;
		isType: boolean;
	}>;
	filePath: string;
	line: number;
}

/** An export statement */
export interface ExportStatement {
	symbols: Array<{
		name: string;
		isDefault: boolean;
	}>;
	filePath: string;
	line: number;
}

/** A node in the call graph */
export interface GraphNode {
	id: string;
	symbol: SymbolDefinition;
	callers: Set<string>; // IDs of symbols that call this one
	callees: Set<string>; // IDs of symbols this one calls
	fanIn: number; // Number of direct callers
	fanOut: number; // Number of direct callees
	riskScore: number; // Computed risk score
}

/** An edge in the call graph */
export interface GraphEdge {
	from: string; // caller ID
	to: string; // callee ID
	confidence: number; // 0-1, how confident we are in this link
	type: "call" | "import" | "extends" | "implements";
}

/** Impact analysis result for a single affected symbol */
export interface AffectedSymbol {
	symbol: string;
	type: "function" | "class" | "method" | "variable" | "interface" | "type";
	file: string;
	line: number;
	depth: number;
	riskScore: number;
}

/** Full impact analysis result */
export interface ImpactResult {
	target: string;
	type: "symbol" | "file" | "diff";
	summary: {
		totalAffected: number;
		directDependents: number;
		transitiveDependents: number;
		testFiles: number;
		riskScore: number;
	};
	affected: AffectedSymbol[];
	recommendations: string[];
}

/** Options for impact analysis */
export interface ImpactOptions {
	maxDepth?: number;
	includeTests?: boolean;
	format?: "table" | "json" | "markdown";
	/** Root directory for resolving relative file paths (used in diff analysis) */
	rootDir?: string;
}

/** File metadata for indexing */
export interface FileMetadata {
	path: string;
	hash: string;
	lastModified: number;
	symbols: SymbolDefinition[];
	callSites: CallSite[];
	imports: ImportStatement[];
	exports: ExportStatement[];
}

/** The complete graph data structure */
export interface CallGraph {
	nodes: Map<string, GraphNode>;
	edges: GraphEdge[];
	files: Map<string, FileMetadata>;
	symbolIndex: Map<string, string[]>; // symbol name -> node IDs
}
