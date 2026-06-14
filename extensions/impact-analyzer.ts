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

		// BFS to find all affected nodes (using index pointer, not shift())
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
		// Using index pointer instead of shift() for O(1) dequeue
		let idx = 0;
		while (idx < queue.length) {
			const current = queue[idx++];
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

		// BFS traversal following reverse edges (using index pointer)
		let idx = 0;
		while (idx < queue.length) {
			const current = queue[idx++];
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
	 * Analyze the impact of a git diff (unified format).
	 *
	 * Parses changed file paths and line ranges from the diff, finds all symbols
	 * overlapping those ranges, then runs BFS reverse-dependency traversal on each
	 * to find the combined blast radius.
	 */
	public analyzeDiff(
		diffContent: string,
		options: ImpactOptions = {},
	): ImpactResult {
		const { maxDepth = 10, includeTests = true } = options;

		// Parse the diff to extract changed files and their line ranges
		const changedRanges = this.parseDiff(diffContent);

		if (changedRanges.size === 0) {
			return {
				target: "<diff>",
				type: "diff",
				summary: {
					totalAffected: 0,
					directDependents: 0,
					transitiveDependents: 0,
					testFiles: 0,
					riskScore: 0,
				},
				affected: [],
				recommendations: [
					"No changed files detected in the diff. Nothing to analyze.",
				],
			};
		}

		// Find symbols that overlap with the changed line ranges
		const changedSymbolIds = new Set<string>();
		for (const [filePath, lineRanges] of changedRanges) {
			const metadata = this.graph.files.get(filePath);
			if (!metadata) continue;

			for (const symbol of metadata.symbols) {
				for (const [rangeStart, rangeEnd] of lineRanges) {
					if (symbol.line <= rangeEnd && symbol.endLine >= rangeStart) {
						const nodeId = `${filePath}::${symbol.name}`;
						if (this.graph.nodes.has(nodeId)) {
							changedSymbolIds.add(nodeId);
						}
					}
				}
			}
		}

		if (changedSymbolIds.size === 0) {
			return {
				target: "<diff>",
				type: "diff",
				summary: {
					totalAffected: 0,
					directDependents: 0,
					transitiveDependents: 0,
					testFiles: 0,
					riskScore: 0,
				},
				affected: [],
				recommendations: [
					"No indexed symbols overlap with the changed lines. Safe to proceed.",
				],
			};
		}

		// Run BFS for each changed symbol, merging all results
		const allAffected = new Map<string, { node: GraphNode; depth: number }>();

		for (const nodeId of changedSymbolIds) {
			const node = this.graph.nodes.get(nodeId);
			if (!node) continue;
			if (!allAffected.has(nodeId)) {
				allAffected.set(nodeId, { node, depth: 0 });
			}

			const queue: Array<{ nodeId: string; depth: number }> = [
				{ nodeId, depth: 0 },
			];
			let idx = 0;
			while (idx < queue.length) {
				const current = queue[idx++];
				if (current.depth >= maxDepth) continue;

				const currentRow = this.graph.nodes.get(current.nodeId);
				if (!currentRow) continue;

				for (const callerId of currentRow.callers) {
					if (!allAffected.has(callerId)) {
						const callerNode = this.graph.nodes.get(callerId);
						if (callerNode) {
							allAffected.set(callerId, {
								node: callerNode,
								depth: current.depth + 1,
							});
							queue.push({ nodeId: callerId, depth: current.depth + 1 });
						}
					}
				}
			}
		}

		// Filter out test files if requested
		const filteredAffected = Array.from(allAffected.values()).filter(
			({ node }) => {
				if (!includeTests && this.isTestFile(node.symbol.file)) {
					return false;
				}
				return true;
			},
		);

		const summary = this.calculateSummary(filteredAffected);
		const changedFiles = Array.from(changedRanges.keys());
		const recommendations = this.generateRecommendations(
			`diff (${changedFiles.length} file(s) changed)`,
			filteredAffected,
		);
		recommendations.unshift(
			`${changedSymbolIds.size} symbol(s) directly modified in diff.`,
		);
		recommendations.unshift(`Changed files: ${changedFiles.join(", ")}`);

		return {
			target: `<diff> (${changedFiles.length} file(s))`,
			type: "diff",
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

	/**
	 * Parse a git unified diff into { filePath: [lineStart, lineEnd][] }.
	 * Matches:
	 *   +++ b/path/to/file.ts
	 *   @@ -oldStart,oldCount +newStart,newCount @@
	 */
	private parseDiff(diffContent: string): Map<string, Array<[number, number]>> {
		const result = new Map<string, Array<[number, number]>>();
		let currentFile: string | null = null;

		const lines = diffContent.split("\n");
		for (const line of lines) {
			// Match +++ b/file.ts
			const fileMatch = line.match(/^\+\+\+\s+b\/(.+)$/);
			if (fileMatch) {
				currentFile = fileMatch[1];
				if (!result.has(currentFile)) {
					result.set(currentFile, []);
				}
				continue;
			}

			// Match @@ -x,y +a,b @@
			const rangeMatch = line.match(
				/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/,
			);
			if (rangeMatch && currentFile) {
				const start = parseInt(rangeMatch[1], 10);
				const count = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : 1;
				if (count > 0) {
					const fileRanges = result.get(currentFile) || [];
					fileRanges.push([start, start + count]);
					result.set(currentFile, fileRanges);
				}
			}
		}

		return result;
	}

	private calculateSummary(
		affected: Array<{ node: GraphNode; depth: number }>,
	): ImpactResult["summary"] {
		const directDependents = affected.filter((a) => a.depth === 1).length;
		const transitiveDependents = affected.filter((a) => a.depth > 1).length;
		const testFiles = affected.filter((a) =>
			this.isTestFile(a.node.symbol.file),
		).length;

		let maxRiskScore = 0;
		for (const a of affected) {
			if (a.node.riskScore > maxRiskScore) {
				maxRiskScore = a.node.riskScore;
			}
		}

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
