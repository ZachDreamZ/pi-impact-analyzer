import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { TreeSitterParser } from "./parser";
import { GraphBuilder } from "./graph-builder";
import { ImpactAnalyzer } from "./impact-analyzer";
import type { ImpactOptions, ImpactResult } from "./types";
import type { CallGraph } from "./types";

/**
 * pi-impact-analyzer
 *
 * AST-based dependency tracing that answers:
 * "If I change this symbol, what else could break?"
 *
 * v0.3.0 - Passive mode with auto-indexing and caching
 */

// ============ Configuration ============

const DEFAULT_CONFIG = {
	/** Auto-index project on session start */
	autoIndex: true,
	/** Cache graph to disk for faster startup */
	cacheEnabled: true,
	/** Cache TTL in milliseconds (5 minutes) */
	cacheTTL: 300_000,
	/** Directories to ignore when scanning */
	ignoreDirs: new Set([
		"node_modules",
		"dist",
		".git",
		".next",
		"build",
		"coverage",
		".cache",
		".nyc_output",
	]),
	/** File extensions to index */
	extensions: new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]),
	/** Enable debug logging */
	debug: false,
};

type Config = typeof DEFAULT_CONFIG;

// ============ Singleton State ============

let parser: TreeSitterParser | null = null;
let graphBuilder: GraphBuilder | null = null;
let impactAnalyzer: ImpactAnalyzer | null = null;
let initialized = false;
let config: Config = { ...DEFAULT_CONFIG };
let indexingInProgress = false;
let lastIndexTime = 0;

// File hash cache for incremental updates
const fileHashes = new Map<string, string>();

// ============ Cache Paths ============

const CACHE_DIR = path.join(os.homedir(), ".pi", "impact-analyzer");
const GRAPH_CACHE_PATH = path.join(CACHE_DIR, "graph.json");
const META_CACHE_PATH = path.join(CACHE_DIR, "meta.json");

// ============ Logging ============

function log(...args: unknown[]): void {
	if (config.debug) {
		console.log("[pi-impact-analyzer]", ...args);
	}
}

// ============ Cache Management ============

interface CacheMeta {
	hash: string;
	fileCount: number;
	timestamp: number;
	rootDir: string;
}

function ensureCacheDir(): void {
	if (!fs.existsSync(CACHE_DIR)) {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
	}
}

function calculateGraphHash(files: Array<{ path: string }>): string {
	const content = files
		.map((f) => f.path)
		.sort()
		.join("\n");
	return crypto.createHash("md5").update(content).digest("hex");
}

function saveCache(graph: CallGraph, rootDir: string): void {
	if (!config.cacheEnabled) return;

	try {
		ensureCacheDir();

		// Serialize graph
		const graphData = {
			nodes: Array.from(graph.nodes.entries()).map(([id, node]) => ({
				id,
				symbol: node.symbol,
				callers: Array.from(node.callers),
				callees: Array.from(node.callees),
				fanIn: node.fanIn,
				fanOut: node.fanOut,
				riskScore: node.riskScore,
			})),
			edges: graph.edges,
			files: Array.from(graph.files.entries()).map(([filePath, meta]) => {
				const { path: _path, ...rest } = meta as any;
				return { path: filePath, ...rest };
			}),
			symbolIndex: Array.from(graph.symbolIndex.entries()),
		};

		fs.writeFileSync(GRAPH_CACHE_PATH, JSON.stringify(graphData, null, 2));

		// Save metadata
		const meta: CacheMeta = {
			hash: calculateGraphHash(
				Array.from(graph.files.keys()).map((p) => ({ path: p })),
			),
			fileCount: graph.files.size,
			timestamp: Date.now(),
			rootDir,
		};
		fs.writeFileSync(META_CACHE_PATH, JSON.stringify(meta, null, 2));

		log("Graph cached successfully");
	} catch (err) {
		log("Failed to cache graph:", err);
	}
}

function loadCache(): CallGraph | null {
	if (!config.cacheEnabled) return null;

	try {
		if (!fs.existsSync(GRAPH_CACHE_PATH) || !fs.existsSync(META_CACHE_PATH)) {
			return null;
		}

		const meta: CacheMeta = JSON.parse(
			fs.readFileSync(META_CACHE_PATH, "utf8"),
		);

		// Check TTL
		if (Date.now() - meta.timestamp > config.cacheTTL) {
			log("Cache expired, rebuilding");
			return null;
		}

		const graphData = JSON.parse(fs.readFileSync(GRAPH_CACHE_PATH, "utf8"));

		// Reconstruct graph
		const graph: CallGraph = {
			nodes: new Map(),
			edges: graphData.edges,
			files: new Map(),
			symbolIndex: new Map(),
		};

		for (const nodeData of graphData.nodes) {
			graph.nodes.set(nodeData.id, {
				id: nodeData.id,
				symbol: nodeData.symbol,
				callers: new Set(nodeData.callers),
				callees: new Set(nodeData.callees),
				fanIn: nodeData.fanIn,
				fanOut: nodeData.fanOut,
				riskScore: nodeData.riskScore,
			});
		}

		for (const fileData of graphData.files) {
			const { path: filePath, ...meta } = fileData;
			graph.files.set(filePath, meta as any);
		}

		for (const [name, nodeIds] of graphData.symbolIndex) {
			graph.symbolIndex.set(name, nodeIds);
		}

		log("Graph loaded from cache");
		return graph;
	} catch (err) {
		log("Failed to load cache:", err);
		return null;
	}
}

// ============ Initialization ============

async function ensureInitialized(): Promise<void> {
	if (initialized) return;

	parser = new TreeSitterParser();
	await parser.initialize();
	graphBuilder = new GraphBuilder(parser);

	// Try to load cached graph
	const cachedGraph = loadCache();
	if (cachedGraph && cachedGraph.nodes.size > 0) {
		// Restore graph state
		for (const [id, node] of cachedGraph.nodes) {
			graphBuilder.getGraph().nodes.set(id, node);
		}
		graphBuilder.getGraph().edges = cachedGraph.edges;
		for (const [path, meta] of cachedGraph.files) {
			graphBuilder.getGraph().files.set(path, meta);
		}
		for (const [name, nodeIds] of cachedGraph.symbolIndex) {
			graphBuilder.getGraph().symbolIndex.set(name, nodeIds);
		}
		log("Restored graph from cache");
	}

	impactAnalyzer = new ImpactAnalyzer(graphBuilder.getGraph());
	initialized = true;
}

// ============ File Operations ============

function calculateFileHash(content: string): string {
	return crypto.createHash("md5").update(content).digest("hex");
}

function isFileChanged(filePath: string, content: string): boolean {
	const newHash = calculateFileHash(content);
	const oldHash = fileHashes.get(filePath);

	if (oldHash === newHash) {
		return false;
	}

	fileHashes.set(filePath, newHash);
	return true;
}

function scanProjectFiles(
	rootDir: string,
): Array<{ path: string; content: string }> {
	const files: Array<{ path: string; content: string }> = [];

	function walk(dir: string): void {
		let entries: string[];
		try {
			entries = fs.readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = path.join(dir, entry);
			let stat: fs.Stats;
			try {
				stat = fs.statSync(fullPath);
			} catch {
				continue;
			}
			if (stat.isDirectory()) {
				if (!config.ignoreDirs.has(entry)) {
					walk(fullPath);
				}
			} else if (stat.isFile()) {
				const ext = path.extname(entry).toLowerCase();
				if (config.extensions.has(ext)) {
					try {
						const content = fs.readFileSync(fullPath, "utf8");
						files.push({ path: fullPath, content });
					} catch {
						// Skip unreadable files
					}
				}
			}
		}
	}

	walk(path.resolve(rootDir));
	return files;
}

// ============ Core Functions ============

export async function scanAndBuildGraph(rootDir?: string): Promise<CallGraph> {
	await ensureInitialized();

	if (indexingInProgress) {
		log("Indexing already in progress, skipping");
		return graphBuilder!.getGraph();
	}

	indexingInProgress = true;
	const startTime = Date.now();

	try {
		const dir = rootDir || process.cwd();
		const files = scanProjectFiles(dir);

		if (files.length === 0) {
			log(`No source files found in ${dir}`);
			return graphBuilder!.getGraph();
		}

		await buildGraph(files);
		lastIndexTime = Date.now();

		// Cache the graph
		saveCache(graphBuilder!.getGraph(), dir);

		const duration = Date.now() - startTime;
		log(`Graph built in ${duration}ms (${files.length} files)`);

		return graphBuilder!.getGraph();
	} finally {
		indexingInProgress = false;
	}
}

export async function buildGraph(
	files: Array<{ path: string; content: string }>,
): Promise<void> {
	await ensureInitialized();

	if (!graphBuilder) {
		throw new Error("Failed to initialize graph builder");
	}

	graphBuilder.build(files);
	impactAnalyzer = new ImpactAnalyzer(graphBuilder.getGraph());
}

export async function indexFile(
	filePath: string,
	content: string,
): Promise<void> {
	await ensureInitialized();

	if (!graphBuilder) {
		throw new Error("Failed to initialize graph builder");
	}

	// Check if file actually changed
	if (!isFileChanged(filePath, content)) {
		log(`File unchanged, skipping: ${filePath}`);
		return;
	}

	// Add file incrementally
	graphBuilder.addFile(filePath, content);
	impactAnalyzer = new ImpactAnalyzer(graphBuilder.getGraph());

	log(`Indexed file: ${filePath}`);
}

export function impactAnalyzeHandler(
	input: {
		type: "symbol" | "file" | "diff";
		target: string;
		options?: ImpactOptions;
	},
	_ctx?: any,
): ImpactResult | string {
	if (!impactAnalyzer) {
		// Return empty result instead of throwing
		return {
			target: input.target,
			type: input.type,
			summary: {
				totalAffected: 0,
				directDependents: 0,
				transitiveDependents: 0,
				testFiles: 0,
				riskScore: 0,
			},
			affected: [],
			recommendations: [
				"Graph not built yet. Auto-indexing will start on session start.",
			],
		};
	}

	let result: ImpactResult;

	switch (input.type) {
		case "file":
			result = impactAnalyzer.analyzeFile(input.target, input.options);
			break;
		case "symbol":
			result = impactAnalyzer.analyzeSymbol(input.target, input.options);
			break;
		case "diff":
			if (input.target === "staged" || input.target === "unstaged") {
				const gitDir = input.options?.rootDir || process.cwd();
				const cmd =
					input.target === "staged" ? "git diff --cached" : "git diff";
				const { execSync } = require("child_process");
				try {
					const diffOutput = execSync(cmd, { cwd: gitDir, encoding: "utf8" });
					result = impactAnalyzer.analyzeDiff(diffOutput, input.options);
				} catch (e: any) {
					throw new Error(
						`Failed to run ${cmd} in ${gitDir}: ${e.message || e}`,
					);
				}
			} else {
				result = impactAnalyzer.analyzeDiff(input.target, input.options);
			}
			break;
		default:
			throw new Error(
				`Unknown analysis type: ${(input as any).type}. Expected "symbol", "file", or "diff".`,
			);
	}

	const format = input.options?.format || "json";
	if (format === "table") {
		return formatAsTable(result);
	} else if (format === "markdown") {
		return formatAsMarkdown(result);
	}

	return result;
}

// ============ Passive Mode Functions ============

/**
 * Auto-index the project directory.
 * Called automatically on session start if autoIndex is enabled.
 */
export async function autoIndex(rootDir?: string): Promise<void> {
	if (!config.autoIndex) return;
	if (indexingInProgress) return;

	// Check if we need to reindex
	if (lastIndexTime > 0 && Date.now() - lastIndexTime < config.cacheTTL) {
		log("Graph still fresh, skipping auto-index");
		return;
	}

	await scanAndBuildGraph(rootDir);
}

/**
 * Check if a file is a source file that should be indexed.
 */
export function isSourceFile(filePath: string): boolean {
	const ext = path.extname(filePath).toLowerCase();
	return config.extensions.has(ext);
}

/**
 * Get indexing status.
 */
export function getIndexingStatus(): {
	initialized: boolean;
	indexing: boolean;
	nodeCount: number;
	fileCount: number;
	lastIndexTime: number;
} {
	return {
		initialized,
		indexing: indexingInProgress,
		nodeCount: graphBuilder?.getGraph().nodes.size || 0,
		fileCount: graphBuilder?.getGraph().files.size || 0,
		lastIndexTime,
	};
}

/**
 * Invalidate cache for a specific file.
 */
export function invalidateFile(filePath: string): void {
	fileHashes.delete(filePath);
	log(`Invalidated cache for: ${filePath}`);
}

/**
 * Clear all caches.
 */
export function clearCache(): void {
	fileHashes.clear();
	if (fs.existsSync(GRAPH_CACHE_PATH)) {
		fs.unlinkSync(GRAPH_CACHE_PATH);
	}
	if (fs.existsSync(META_CACHE_PATH)) {
		fs.unlinkSync(META_CACHE_PATH);
	}
	log("Cache cleared");
}

/**
 * Update configuration.
 */
export function updateConfig(newConfig: Partial<Config>): void {
	config = { ...config, ...newConfig };
	log("Config updated:", config);
}

/**
 * Get current configuration.
 */
export function getConfig(): Readonly<Config> {
	return config;
}

// ============ Formatting ============

function formatAsTable(result: ImpactResult): string {
	const lines: string[] = [];

	lines.push("Impact Analysis for: " + result.target);
	lines.push("=".repeat(50));
	lines.push("");
	lines.push("Summary:");
	lines.push("  Total affected: " + result.summary.totalAffected);
	lines.push("  Direct dependents: " + result.summary.directDependents);
	lines.push("  Transitive dependents: " + result.summary.transitiveDependents);
	lines.push("  Test files: " + result.summary.testFiles);
	lines.push("  Risk score: " + (result.summary.riskScore || 0).toFixed(2));
	lines.push("");

	if (result.affected.length > 0) {
		lines.push("Affected Symbols:");
		lines.push("-".repeat(50));

		for (const item of result.affected) {
			const shortFile = item.file.split("/").pop() || item.file;
			lines.push(
				"  " +
					item.symbol.padEnd(30) +
					" " +
					shortFile.padEnd(20) +
					" depth:" +
					item.depth +
					" risk:" +
					(item.riskScore || 0).toFixed(1),
			);
		}
		lines.push("");
	}

	if (result.recommendations.length > 0) {
		lines.push("Recommendations:");
		for (const rec of result.recommendations) {
			lines.push("  - " + rec);
		}
	}

	return lines.join("\n");
}

function formatAsMarkdown(result: ImpactResult): string {
	const lines: string[] = [];

	lines.push("## Impact Analysis: " + result.target);
	lines.push("");
	lines.push("### Summary");
	lines.push("");
	lines.push("| Metric | Value |");
	lines.push("|--------|-------|");
	lines.push("| Total affected | " + result.summary.totalAffected + " |");
	lines.push("| Direct dependents | " + result.summary.directDependents + " |");
	lines.push(
		"| Transitive dependents | " + result.summary.transitiveDependents + " |",
	);
	lines.push("| Test files | " + result.summary.testFiles + " |");
	lines.push(
		"| Risk score | " + (result.summary.riskScore || 0).toFixed(2) + " |",
	);
	lines.push("");

	if (result.affected.length > 0) {
		lines.push("### Affected Symbols");
		lines.push("");
		lines.push("| Symbol | File | Depth | Risk |");
		lines.push("|--------|------|-------|------|");

		for (const item of result.affected) {
			const shortFile = item.file.split("/").pop() || item.file;
			lines.push(
				"| " +
					item.symbol +
					" | " +
					shortFile +
					" | " +
					item.depth +
					" | " +
					(item.riskScore || 0).toFixed(1) +
					" |",
			);
		}
		lines.push("");
		lines.push(
			"> **Tip**: Use `smart_read` to inspect affected symbols efficiently. Example:",
		);
		lines.push(
			`> \`smart_read({ "path": "...", "options": { "mode": "symbol", "symbol": "..." } })\``,
		);
	}

	if (result.recommendations.length > 0) {
		lines.push("### Recommendations");
		lines.push("");
		for (const rec of result.recommendations) {
			lines.push("- " + rec);
		}
	}

	return lines.join("\n");
}

// ============ Legacy Exports ============

export function scanProject(
	rootDir: string,
	options?: {
		includeNodeModules?: boolean;
		extensions?: string[];
	},
): string[] {
	const {
		includeNodeModules = false,
		extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
	} = options || {};

	const results: string[] = [];
	const resolvedRoot = path.resolve(rootDir);

	function walk(dir: string): void {
		let entries: string[];
		try {
			entries = fs.readdirSync(dir);
		} catch {
			return;
		}

		for (const entry of entries) {
			if (entry.startsWith(".")) continue;

			const fullPath = path.join(dir, entry);
			const stat = fs.statSync(fullPath);

			if (stat.isDirectory()) {
				if (entry === "node_modules" && !includeNodeModules) continue;
				if (entry === "dist" || entry === "build" || entry === ".git") continue;
				walk(fullPath);
			} else if (stat.isFile()) {
				const ext = path.extname(entry);
				if (extensions.includes(ext)) {
					results.push(fullPath);
				}
			}
		}
	}

	walk(resolvedRoot);
	return results;
}

export async function buildGraphFromProject(
	rootDir: string,
	options?: {
		includeNodeModules?: boolean;
		extensions?: string[];
	},
): Promise<void> {
	const filePaths = scanProject(rootDir, options);

	if (filePaths.length === 0) {
		throw new Error(
			`No source files found in ${rootDir}. Make sure the directory contains .ts or .js files.`,
		);
	}

	const files = filePaths.map((fp) => ({
		path: fp,
		content: fs.readFileSync(fp, "utf-8"),
	}));

	await buildGraph(files);
}

export function getRiskiestSymbols(topN: number = 10) {
	if (!impactAnalyzer) {
		throw new Error("Graph not built yet. Call buildGraph() first.");
	}
	return impactAnalyzer.findRiskiestSymbols(topN);
}

export function getOrphans() {
	if (!impactAnalyzer) {
		throw new Error("Graph not built yet. Call buildGraph() first.");
	}
	return impactAnalyzer.findOrphans();
}

// ============ Type Exports ============

export { TreeSitterParser } from "./parser";
export { GraphBuilder } from "./graph-builder";
export { ImpactAnalyzer } from "./impact-analyzer";
export { ASTExtractor } from "./extractor";
export { SymbolResolver } from "./symbol-resolver";
export type {
	ImpactResult,
	ImpactOptions,
	AffectedSymbol,
	SymbolDefinition,
	CallSite,
	CallGraph,
	GraphNode,
} from "./types";

// ============ Pi Extension Factory ============

/**
 * Pi extension factory function.
 * This is the default export that Pi calls to initialize the extension.
 *
 * v0.3.0 - Passive mode with auto-indexing
 */
export default async function piImpactAnalyzer(pi: any): Promise<void> {
	// Register the impact_analyze tool
	pi.registerTool({
		name: "impact_analyze",
		description:
			"Analyze the impact of changing a symbol or file. Given a symbol name or file path, returns all affected code, risk scores, and recommendations.",
		parameters: {
			type: "object",
			properties: {
				type: {
					type: "string",
					enum: ["symbol", "file", "diff"],
					description:
						"Type of analysis: 'symbol' for a function/class name, 'file' for a file path, 'diff' for a git diff string or 'staged'/'unstaged' to run git diff automatically",
				},
				target: {
					type: "string",
					description: "The symbol name or file path to analyze the impact for",
				},
				options: {
					type: "object",
					properties: {
						maxDepth: {
							type: "number",
							description:
								"Maximum depth of transitive dependency traversal (default: 10)",
						},
						includeTests: {
							type: "boolean",
							description: "Include test files in results (default: true)",
						},
						format: {
							type: "string",
							enum: ["json", "table", "markdown"],
							description: "Output format (default: json)",
						},
					},
				},
			},
			required: ["type", "target"],
		},
		handler: impactAnalyzeHandler,
	});

	// ============ Passive Mode Event Handlers ============

	// Auto-index on session start
	pi.on("session_start", async (ctx: any) => {
		log("Session started, auto-indexing...");
		try {
			await autoIndex(ctx?.cwd);
			log("Auto-index complete");
		} catch (err) {
			log("Auto-index failed:", err);
		}
	});

	// Index files when Pi reads them
	pi.on("tool_result", async (event: any, _ctx: any) => {
		if (event?.toolName === "read" && event?.path) {
			const filePath = event.path;
			if (isSourceFile(filePath) && event?.content) {
				try {
					await indexFile(filePath, event.content);
				} catch (err) {
					log("Failed to index file:", filePath, err);
				}
			}
		}
	});

	// Auto-analyze when user mentions code changes
	pi.on("message_end", async (event: any, _ctx: any) => {
		const message = event?.message?.content;
		if (!message || typeof message !== "string") return;

		// Simple heuristic: detect code change mentions
		const changePatterns = [
			/modify\s+(\w+)/i,
			/change\s+(\w+)/i,
			/update\s+(\w+)/i,
			/refactor\s+(\w+)/i,
			/delete\s+(\w+)/i,
		];

		for (const pattern of changePatterns) {
			const match = message.match(pattern);
			if (match && match[1]) {
				const symbolName = match[1];
				try {
					const impact = impactAnalyzer?.analyzeSymbol(symbolName);
					if (impact && impact.summary.totalAffected > 0) {
						log(
							`Impact detected: ${symbolName} affects ${impact.summary.totalAffected} symbols`,
						);
						// Emit impact event for other tools (like smart-reader)
						pi.emit("impact_detected", {
							symbol: symbolName,
							impact,
						});
					}
				} catch {
					// Ignore analysis errors
				}
				break;
			}
		}
	});

	// Save graph on session end
	pi.on("session_shutdown", async () => {
		log("Session ending, saving graph...");
		if (graphBuilder) {
			saveCache(graphBuilder.getGraph(), process.cwd());
		}
	});

	log("Extension loaded (passive mode)");
}
