import { TreeSitterParser } from "./parser";
import { GraphBuilder } from "./graph-builder";
import { ImpactAnalyzer } from "./impact-analyzer";
import type { ImpactOptions, ImpactResult } from "./types";

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

/**
 * Initialize the parser and graph builder.
 */
async function ensureInitialized(): Promise<void> {
	if (!parser) {
		parser = new TreeSitterParser();
		await parser.initialize();
		graphBuilder = new GraphBuilder(parser);
	}
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
	lines.push("  Risk score: " + result.summary.riskScore.toFixed(2));
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
					item.riskScore.toFixed(1),
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
	lines.push("| Risk score | " + result.summary.riskScore.toFixed(2) + " |");
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
					item.riskScore.toFixed(1) +
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
 * Tool handler for impact_analyze.
 */
export async function impactAnalyzeHandler(input: {
	type: "symbol" | "file" | "diff";
	target: string;
	options?: ImpactOptions;
}): Promise<ImpactResult | string> {
	await ensureInitialized();

	if (!graphBuilder || !impactAnalyzer) {
		throw new Error("Failed to initialize impact analyzer");
	}

	// Build graph if not already built
	if (graphBuilder.getGraph().nodes.size === 0) {
		console.log("[pi-impact-analyzer] Graph not built yet. Building...");
		// In a real implementation, we'd scan the project files here
		// For now, assume the graph has been built externally
	}

	const result = impactAnalyzer.analyzeSymbol(input.target, input.options);

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

	// Create analyzer with the built graph
	impactAnalyzer = new ImpactAnalyzer(graphBuilder.getGraph());
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
 */
export default function piImpactAnalyzer(pi: any): void {
	// Register the impact_analyze tool
	pi.registerTool("impact_analyze", impactAnalyzeHandler);
	console.log("[pi-impact-analyzer] Registered impact_analyze tool");
}
