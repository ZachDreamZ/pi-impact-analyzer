import path from "path";
import fs from "fs";
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
 */

// Singleton instances
let parser: TreeSitterParser | null = null;
let graphBuilder: GraphBuilder | null = null;
let impactAnalyzer: ImpactAnalyzer | null = null;
let initialized = false;

/**
 * Initialize the parser, graph builder, and impact analyzer.
 * Creates a lazy analyzer that will build its graph on first use if needed.
 */
async function ensureInitialized(): Promise<void> {
	if (initialized) return;

	parser = new TreeSitterParser();
	await parser.initialize();
	graphBuilder = new GraphBuilder(parser);
	impactAnalyzer = new ImpactAnalyzer(graphBuilder.getGraph());
	initialized = true;
}

/**
 * Format impact result as a table string.
 */
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

/**
 * Format impact result as markdown.
 */
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

/**
 * Scan a project directory recursively for .ts/.tsx/.js/.jsx files.
 * Respects common ignore patterns: node_modules, dist, .git, etc.
 */
function scanProjectFiles(
	rootDir: string,
): Array<{ path: string; content: string }> {
	const IGNORE_DIRS = new Set([
		"node_modules",
		"dist",
		".git",
		".next",
		"build",
		"coverage",
		".cache",
		".nyc_output",
	]);
	const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
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
				if (!IGNORE_DIRS.has(entry)) {
					walk(fullPath);
				}
			} else if (stat.isFile()) {
				const ext = path.extname(entry).toLowerCase();
				if (EXTENSIONS.has(ext)) {
					try {
						const content = fs.readFileSync(fullPath, "utf8");
						files.push({ path: fullPath, content });
					} catch {
						// Skip unreadable files (binary, permissions, etc.)
					}
				}
			}
		}
	}

	walk(path.resolve(rootDir));
	return files;
}

/**
 * Scan a project directory and build the impact graph from all discovered files.
 */
export async function scanAndBuildGraph(rootDir?: string): Promise<CallGraph> {
	await ensureInitialized();

	const dir = rootDir || process.cwd();
	const files = scanProjectFiles(dir);

	if (files.length === 0) {
		throw new Error(
			`No source files found in ${dir}. Ensure the directory contains .ts, .tsx, .js, or .jsx files.`,
		);
	}

	await buildGraph(files);

	if (!graphBuilder) {
		throw new Error("Failed to initialize graph builder");
	}
	return graphBuilder.getGraph();
}

/**
 * Tool handler for impact_analyze.
 * Dispatches to the correct analysis method based on input.type.
 * Auto-indexes from CWD if the graph hasn't been built yet.
 */
export async function impactAnalyzeHandler(
	input: {
		type: "symbol" | "file" | "diff";
		target: string;
		options?: ImpactOptions;
	},
	_ctx?: any,
): Promise<ImpactResult | string> {
	await ensureInitialized();

	if (!impactAnalyzer) {
		throw new Error("Failed to initialize impact analyzer");
	}

	if (!graphBuilder || graphBuilder.getGraph().nodes.size === 0) {
		// Auto-index from current directory if no graph has been built yet
		try {
			await scanAndBuildGraph();
		} catch {
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
					"No files indexed and auto-scan failed. Call buildGraph() with project files manually.",
				],
			};
		}
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
			// If target is "staged" or "unstaged", run git diff automatically
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

	// Format output based on options
	const format = input.options?.format || "json";
	if (format === "table") {
		return formatAsTable(result);
	} else if (format === "markdown") {
		return formatAsMarkdown(result);
	}

	return result;
}

/**
 * Build the impact graph from files.
 */
export async function buildGraph(
	files: Array<{ path: string; content: string }>,
): Promise<void> {
	await ensureInitialized();

	if (!graphBuilder) {
		throw new Error("Failed to initialize graph builder");
	}

	graphBuilder.build(files);

	// Create analyzer with the built graph (picks up the latest graph reference)
	impactAnalyzer = new ImpactAnalyzer(graphBuilder.getGraph());
}

/**
 * Recursively scan a directory for supported source files.
 * Returns relative file paths matching .ts, .tsx, .js, .jsx, .mjs, .cjs extensions.
 */
export function scanProject(
	rootDir: string,
	options?: {
		includeNodeModules?: boolean;
		extensions?: string[];
	},
): string[] {
	const fs = require("fs");
	const path = require("path");

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
			return; // skip unreadable directories
		}

		for (const entry of entries) {
			if (entry.startsWith(".")) continue; // skip hidden files/dirs

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

/**
 * Scan a directory and build the impact graph from all found source files.
 * Combines scanProject() and buildGraph() in one step.
 */
export async function buildGraphFromProject(
	rootDir: string,
	options?: {
		includeNodeModules?: boolean;
		extensions?: string[];
	},
): Promise<void> {
	const fs = require("fs");

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

/**
 * Get the riskiest symbols in the codebase.
 */
export function getRiskiestSymbols(topN: number = 10) {
	if (!impactAnalyzer) {
		throw new Error("Graph not built yet. Call buildGraph() first.");
	}
	return impactAnalyzer.findRiskiestSymbols(topN);
}

/**
 * Get orphan symbols (defined but never called).
 */
export function getOrphans() {
	if (!impactAnalyzer) {
		throw new Error("Graph not built yet. Call buildGraph() first.");
	}
	return impactAnalyzer.findOrphans();
}

// Export types and classes for programmatic use
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

/**
 * Pi extension factory function.
 * This is the default export that Pi calls to initialize the extension.
 * Async — matches the convention used by pi-smart-reader and other Pi extensions.
 */
export default async function piImpactAnalyzer(pi: any): Promise<void> {
	// Register the impact_analyze tool using the object format
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
}
