import type {
	CallGraph,
	GraphNode,
	ImpactResult,
	ImpactOptions,
	AffectedSymbol,
} from "./types";

/**
 * Analyzes the impact of changing a symbol or file.
 * Uses BFS reverse-dependency traversal to find all affected code.
 */
export class ImpactAnalyzer {
	private graph: CallGraph;

	constructor(graph: CallGraph) {
		this.graph = graph;
	}

	/**
	 * Analyze the impact of changing a specific symbol.
	 */
	public analyzeSymbol(
		symbolName: string,
		options: ImpactOptions = {},
	): ImpactResult {
		const { maxDepth = 10, includeTests = true } = options;

		// Find all nodes matching this symbol name
		const targetNodeIds = this.graph.symbolIndex.get(symbolName) || [];

		if (targetNodeIds.length === 0) {
			return this.createEmptyResult(symbolName, "symbol");
		}

		// BFS to find all affected nodes
		const affected = new Map<string, { node: GraphNode; depth: number }>();
		const queue: Array<{ nodeId: string; depth: number }> = [];

		// Start from all matching nodes
		for (const nodeId of targetNodeIds) {
			queue.push({ nodeId, depth: 0 });
			const node = this.graph.nodes.get(nodeId);
			if (node) {
				affected.set(nodeId, { node, depth: 0 });
			}
		}

		// BFS traversal following reverse edges (callers)
		while (queue.length > 0) {
			const current = queue.shift()!;
			if (current.depth >= maxDepth) continue;

			const node = this.graph.nodes.get(current.nodeId);
			if (!node) continue;

			for (const callerId of node.callers) {
				if (!affected.has(callerId)) {
					const callerNode = this.graph.nodes.get(callerId);
					if (callerNode) {
						affected.set(callerId, {
							node: callerNode,
							depth: current.depth + 1,
						});
						queue.push({ nodeId: callerId, depth: current.depth + 1 });
					}
				}
			}
		}

		// Filter out test files if requested
		const filteredAffected = Array.from(affected.values()).filter(
			({ node }) => {
				if (!includeTests && this.isTestFile(node.symbol.file)) {
					return false;
				}
				return true;
			},
		);

		// Calculate summary
		const summary = this.calculateSummary(filteredAffected);

		// Generate recommendations
		const recommendations = this.generateRecommendations(
			symbolName,
			filteredAffected,
		);

		return {
			target: symbolName,
			type: "symbol",
			summary,
			affected: filteredAffected.map(({ node, depth }) => ({
				symbol: node.symbol.name,
				type: node.symbol.type,
				file: node.symbol.file,
				line: node.symbol.line,
				depth,
				riskScore: node.riskScore,
			})),
			recommendations,
		};
	}

	/**
	 * Analyze the impact of changing a specific file.
	 */
	public analyzeFile(
		filePath: string,
		options: ImpactOptions = {},
	): ImpactResult {
		const { maxDepth = 10, includeTests = true } = options;

		// Find all symbols defined in this file
		const fileMetadata = this.graph.files.get(filePath);
		if (!fileMetadata) {
			return this.createEmptyResult(filePath, "file");
		}

		// BFS to find all affected nodes
		const affected = new Map<string, { node: GraphNode; depth: number }>();
		const queue: Array<{ nodeId: string; depth: number }> = [];

		// Start from all symbols in the file
		for (const symbol of fileMetadata.symbols) {
			const nodeId = `${filePath}::${symbol.name}`;
			const node = this.graph.nodes.get(nodeId);
			if (node) {
				queue.push({ nodeId, depth: 0 });
				affected.set(nodeId, { node, depth: 0 });
			}
		}

		// BFS traversal following reverse edges
		while (queue.length > 0) {
			const current = queue.shift()!;
			if (current.depth >= maxDepth) continue;

			const node = this.graph.nodes.get(current.nodeId);
			if (!node) continue;

			for (const callerId of node.callers) {
				if (!affected.has(callerId)) {
					const callerNode = this.graph.nodes.get(callerId);
					if (callerNode) {
						affected.set(callerId, {
							node: callerNode,
							depth: current.depth + 1,
						});
						queue.push({ nodeId: callerId, depth: current.depth + 1 });
					}
				}
			}
		}

		// Filter out test files if requested
		const filteredAffected = Array.from(affected.values()).filter(
			({ node }) => {
				if (!includeTests && this.isTestFile(node.symbol.file)) {
					return false;
				}
				return true;
			},
		);

		const summary = this.calculateSummary(filteredAffected);
		const recommendations = this.generateRecommendations(
			filePath,
			filteredAffected,
		);

		return {
			target: filePath,
			type: "file",
			summary,
			affected: filteredAffected.map(({ node, depth }) => ({
				symbol: node.symbol.name,
				type: node.symbol.type,
				file: node.symbol.file,
				line: node.symbol.line,
				depth,
				riskScore: node.riskScore,
			})),
			recommendations,
		};
	}

	/**
	 * Find the highest-risk symbols in the codebase.
	 */
	public findRiskiestSymbols(topN: number = 10): AffectedSymbol[] {
		const sortedNodes = Array.from(this.graph.nodes.values())
			.sort((a, b) => b.riskScore - a.riskScore)
			.slice(0, topN);

		return sortedNodes.map((node) => ({
			symbol: node.symbol.name,
			type: node.symbol.type,
			file: node.symbol.file,
			line: node.symbol.line,
			depth: 0,
			riskScore: node.riskScore,
		}));
	}

	/**
	 * Find orphan symbols (defined but never called).
	 */
	public findOrphans(): AffectedSymbol[] {
		const orphans: AffectedSymbol[] = [];

		for (const [, node] of this.graph.nodes) {
			if (node.fanIn === 0 && !this.isTestFile(node.symbol.file)) {
				orphans.push({
					symbol: node.symbol.name,
					type: node.symbol.type,
					file: node.symbol.file,
					line: node.symbol.line,
					depth: 0,
					riskScore: 0,
				});
			}
		}

		return orphans;
	}

	// ============ Private Helpers ============

	private calculateSummary(
		affected: Array<{ node: GraphNode; depth: number }>,
	): ImpactResult["summary"] {
		const directDependents = affected.filter((a) => a.depth === 1).length;
		const transitiveDependents = affected.filter((a) => a.depth > 1).length;
		const testFiles = affected.filter((a) =>
			this.isTestFile(a.node.symbol.file),
		).length;

		const maxRiskScore = Math.max(...affected.map((a) => a.node.riskScore), 0);

		return {
			totalAffected: affected.length,
			directDependents,
			transitiveDependents,
			testFiles,
			riskScore: maxRiskScore,
		};
	}

	private generateRecommendations(
		target: string,
		affected: Array<{ node: GraphNode; depth: number }>,
	): string[] {
		const recommendations: string[] = [];

		if (affected.length === 0) {
			recommendations.push(
				`No dependents found for ${target}. Safe to modify.`,
			);
			return recommendations;
		}

		const directCount = affected.filter((a) => a.depth === 1).length;
		const transitiveCount = affected.filter((a) => a.depth > 1).length;
		const testCount = affected.filter((a) =>
			this.isTestFile(a.node.symbol.file),
		).length;

		if (directCount > 0) {
			recommendations.push(
				`${directCount} direct caller(s) will be affected. Review them before making changes.`,
			);
		}

		if (transitiveCount > 0) {
			recommendations.push(
				`${transitiveCount} transitive dependent(s) could be affected indirectly.`,
			);
		}

		if (testCount > 0) {
			recommendations.push(`${testCount} test file(s) may need updating.`);
		}

		const highRisk = affected.filter((a) => a.node.riskScore > 50);
		if (highRisk.length > 0) {
			recommendations.push(
				`High-risk symbols detected: ${highRisk.map((a) => a.node.symbol.name).join(", ")}. Consider additional review.`,
			);
		}

		return recommendations;
	}

	private isTestFile(filePath: string): boolean {
		return (
			filePath.includes(".test.") ||
			filePath.includes(".spec.") ||
			filePath.includes("__test__") ||
			filePath.includes("__tests__") ||
			filePath.includes("/test/") ||
			filePath.includes("/tests/")
		);
	}

	private createEmptyResult(
		target: string,
		type: "symbol" | "file",
	): ImpactResult {
		return {
			target,
			type,
			summary: {
				totalAffected: 0,
				directDependents: 0,
				transitiveDependents: 0,
				testFiles: 0,
				riskScore: 0,
			},
			affected: [],
			recommendations: [`No dependents found for ${target}. Safe to modify.`],
		};
	}
}
