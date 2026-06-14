import type { TreeSitterParser } from "./parser";
import { setLogger } from "./parser";
import { ASTExtractor } from "./extractor";
import { SymbolResolver } from "./symbol-resolver";

// Logger reference — defaults to no-op, shares parser's logging
// Use parser.setLogger() to configure all pi-impact-analyzer logging at once.
let log: (...args: unknown[]) => void = () => {};

/**
 * Override the logger for GraphBuilder.
 * Also updates the parser module logger so both use the same output.
 */
export function setGraphBuilderLogger(
	logger: (...args: unknown[]) => void,
): void {
	log = logger;
	setLogger(logger);
}
import type {
	CallGraph,
	GraphNode,
	FileMetadata,
	SymbolDefinition,
	CallSite,
	ImportStatement,
} from "./types";

/**
 * Builds a call graph from source files using tree-sitter.
 */
export class GraphBuilder {
	private parser: TreeSitterParser;
	private extractor: ASTExtractor;
	private resolver: SymbolResolver;
	private graph: CallGraph;

	constructor(parser: TreeSitterParser) {
		this.parser = parser;
		this.extractor = new ASTExtractor();
		this.resolver = new SymbolResolver();
		this.graph = {
			nodes: new Map(),
			edges: [],
			files: new Map(),
			symbolIndex: new Map(),
		};
	}

	/**
	 * Build the graph from a list of files.
	 * Clears any existing graph first to prevent duplicate nodes.
	 */
	public build(files: Array<{ path: string; content: string }>): CallGraph {
		// Reset graph to prevent duplicate nodes on re-build
		this.graph = {
			nodes: new Map(),
			edges: [],
			files: new Map(),
			symbolIndex: new Map(),
		};
		this.resolver.clear();

		const startTime = Date.now();

		for (const file of files) {
			this.indexFile(file.path, file.content);
		}

		this.resolveAllImports();
		this.linkCallSites();
		this.calculateRiskScores();

		const duration = Date.now() - startTime;
		log(`[pi-impact-analyzer] Graph built in ${duration}ms`);
		log(`  Nodes: ${this.graph.nodes.size}`);
		log(`  Edges: ${this.graph.edges.length}`);
		log(`  Files: ${this.graph.files.size}`);

		return this.graph;
	}

	/**
	 * Add a single file to the graph incrementally.
	 * Only processes imports/call-sites for the new file.
	 */
	public addFile(filePath: string, content: string): void {
		this.indexFile(filePath, content);
		// Only resolve imports for the new file
		const metadata = this.graph.files.get(filePath);
		if (metadata) {
			this.processFileImports(filePath, metadata);
			this.processFileCallSites(filePath, metadata);
		}
		this.calculateRiskScores();
	}

	/**
	 * Get the current graph.
	 */
	public getGraph(): CallGraph {
		return this.graph;
	}

	/**
	 * Get the resolver for external use.
	 */
	public getResolver(): SymbolResolver {
		return this.resolver;
	}

	// ============ Private Methods ============

	private indexFile(filePath: string, content: string): void {
		// Auto-detect language (.ts vs .tsx) and parse with correct grammar
		const tree = this.parser.parseFile(filePath, content);
		if (!tree) {
			log(`[pi-impact-analyzer] Failed to parse ${filePath}`);
			return;
		}
		const rootNode = tree.rootNode;

		const symbols = this.extractor.extractSymbols(rootNode, filePath);
		const callSites = this.extractor.extractCallSites(rootNode, filePath);
		const imports = this.extractor.extractImports(rootNode, filePath);
		const exports = this.extractor.extractExports(rootNode, filePath);

		const metadata: FileMetadata = {
			path: filePath,
			hash: "",
			lastModified: Date.now(),
			symbols,
			callSites,
			imports,
			exports,
		};

		this.graph.files.set(filePath, metadata);
		this.resolver.indexFile(metadata);

		for (const symbol of symbols) {
			const nodeId = this.createNodeId(symbol);
			const node: GraphNode = {
				id: nodeId,
				symbol,
				callers: new Set(),
				callees: new Set(),
				fanIn: 0,
				fanOut: 0,
				riskScore: 0,
			};

			this.graph.nodes.set(nodeId, node);

			const existing = this.graph.symbolIndex.get(symbol.name) || [];
			existing.push(nodeId);
			this.graph.symbolIndex.set(symbol.name, existing);
		}
	}

	private resolveAllImports(): void {
		for (const [filePath, metadata] of this.graph.files) {
			this.processFileImports(filePath, metadata);
		}
	}

	private processFileImports(filePath: string, metadata: FileMetadata): void {
		for (const importStmt of metadata.imports) {
			const resolvedPath = this.resolver.resolveImportPath(
				importStmt,
				filePath,
			);
			if (!resolvedPath) continue;

			const exportedSymbols = this.resolver.getExportedSymbols(resolvedPath);
			this.createImportEdges(importStmt, exportedSymbols, filePath);
		}
	}

	private createImportEdges(
		importStmt: ImportStatement,
		exportedSymbols: SymbolDefinition[],
		_importingFilePath: string,
	): void {
		for (const importSymbol of importStmt.symbols) {
			const matchingExport = this.findMatchingExport(
				exportedSymbols,
				importSymbol.name,
			);
			// If no exact export match, try resolving the symbol name across all indexed files
			if (!matchingExport) {
				const resolved = this.resolver.resolveSymbol(
					importSymbol.name,
					_importingFilePath,
				);
				for (const { symbol: calleeSymbol, confidence } of resolved) {
					const importNodeIds =
						this.graph.symbolIndex.get(importSymbol.name) || [];
					for (const toId of importNodeIds) {
						const fromId = this.createNodeId(calleeSymbol);
						if (fromId !== toId) {
							this.graph.edges.push({
								from: fromId, // exported symbol node
								to: toId, // importing symbol node
								confidence,
								type: "call",
							});
						}
					}
				}
				continue;
			}

			const fromId = this.createNodeId(matchingExport);
			const importingNodeIds =
				this.graph.symbolIndex.get(importSymbol.name) || [];

			for (const toId of importingNodeIds) {
				if (fromId !== toId) {
					// Edge direction: from = export (provider), to = import (consumer).
					// In the call graph convention, "from" is the caller/dependent.
					// The import consumer depends on the export provider, so:
					// from = import node, to = export node.
					this.graph.edges.push({
						from: toId, // importing symbol is the "caller" (depends on export)
						to: fromId, // exported symbol is the "callee" (provider)
						confidence: 1.0,
						type: "import",
					});
				}
			}
		}
	}

	private findMatchingExport(
		exportedSymbols: SymbolDefinition[],
		name: string,
	): SymbolDefinition | undefined {
		return exportedSymbols.find((e) => e.name === name);
	}

	private linkCallSites(): void {
		for (const [filePath, metadata] of this.graph.files) {
			this.processFileCallSites(filePath, metadata);
		}
	}

	private processFileCallSites(filePath: string, metadata: FileMetadata): void {
		for (const callSite of metadata.callSites) {
			this.processCallSite(callSite, filePath);
		}
	}

	private processCallSite(callSite: CallSite, filePath: string): void {
		const callerNodeId = this.findCallerNode(callSite, filePath);
		if (!callerNodeId) return;

		const resolvedSymbols = this.resolver.resolveSymbol(
			callSite.calleeName,
			filePath,
		);

		for (const { symbol: calleeSymbol, confidence } of resolvedSymbols) {
			const calleeNodeId = this.createNodeId(calleeSymbol);

			if (callerNodeId !== calleeNodeId) {
				this.graph.edges.push({
					from: callerNodeId,
					to: calleeNodeId,
					confidence,
					type: "call",
				});
			}
		}
	}

	private findCallerNode(callSite: CallSite, filePath: string): string | null {
		const metadata = this.graph.files.get(filePath);
		if (!metadata) return null;

		for (const symbol of metadata.symbols) {
			if (this.symbolContainsCallSite(symbol, callSite, filePath)) {
				return this.createNodeId(symbol);
			}
		}

		return null;
	}

	private symbolContainsCallSite(
		symbol: SymbolDefinition,
		callSite: CallSite,
		filePath: string,
	): boolean {
		return (
			symbol.file === filePath &&
			callSite.line >= symbol.line &&
			callSite.line <= symbol.endLine
		);
	}

	private calculateRiskScores(): void {
		const adjacencyList = new Map<string, Set<string>>();
		const reverseAdjacencyList = new Map<string, Set<string>>();

		for (const [nodeId] of this.graph.nodes) {
			adjacencyList.set(nodeId, new Set());
			reverseAdjacencyList.set(nodeId, new Set());
		}

		for (const edge of this.graph.edges) {
			adjacencyList.get(edge.from)?.add(edge.to);
			reverseAdjacencyList.get(edge.to)?.add(edge.from);
		}

		for (const [nodeId, node] of this.graph.nodes) {
			// Update both the adjacency sets and the node's own sets
			const callees = adjacencyList.get(nodeId);
			const callers = reverseAdjacencyList.get(nodeId);
			node.fanOut = callees?.size || 0;
			node.fanIn = callers?.size || 0;
			node.callees = callees || new Set();
			node.callers = callers || new Set();
		}

		const pagerank = this.calculatePageRank(reverseAdjacencyList);

		for (const [nodeId, node] of this.graph.nodes) {
			const depth = this.calculateMaxDepth(nodeId, reverseAdjacencyList);
			const rank = Math.max(pagerank.get(nodeId) || 0, 0);
			// Balance risk score components: scale PageRank up to be comparable to fanIn*10
			const nodeCount = this.graph.nodes.size || 1;
			node.riskScore = node.fanIn * 10 + depth * 5 + rank * nodeCount * 100;
		}
	}

	private calculatePageRank(
		reverseAdj: Map<string, Set<string>>,
	): Map<string, number> {
		const damping = 0.85;
		const iterations = 50;
		const nodeCount = this.graph.nodes.size;

		if (nodeCount === 0) return new Map();

		const pagerank = new Map<string, number>();
		const initialRank = 1 / nodeCount;
		for (const [nodeId] of this.graph.nodes) {
			pagerank.set(nodeId, initialRank);
		}

		for (let i = 0; i < iterations; i++) {
			const newPagerank = new Map<string, number>();

			for (const [nodeId] of this.graph.nodes) {
				let sum = 0;
				const inLinks = reverseAdj.get(nodeId) || new Set();

				for (const inLink of inLinks) {
					const outLinks = this.graph.nodes.get(inLink)?.fanOut || 1;
					sum += (pagerank.get(inLink) || 0) / Math.max(outLinks, 1);
				}

				newPagerank.set(nodeId, (1 - damping) / nodeCount + damping * sum);
			}

			for (const [nodeId, value] of newPagerank) {
				pagerank.set(nodeId, value);
			}
		}

		return pagerank;
	}

	/**
	 * Calculate maximum transitive depth using iterative stack (not recursive)
	 * to avoid stack overflow on deep graphs and O(n²) memory from Set copying.
	 */
	private calculateMaxDepth(
		nodeId: string,
		reverseAdj: Map<string, Set<string>>,
	): number {
		// Memoization cache to reuse computed depths
		const memo = new Map<string, number>();
		const visited = new Set<string>();

		function dfs(id: string): number {
			if (memo.has(id)) return memo.get(id)!;

			const inLinks = reverseAdj.get(id);
			if (!inLinks || inLinks.size === 0) {
				memo.set(id, 0);
				return 0;
			}

			// Cycle detection: if currently visiting this node, depth contribution is 0
			if (visited.has(id)) return 0;
			visited.add(id);

			let maxDepth = 0;
			for (const inLink of inLinks) {
				const depth = dfs(inLink);
				maxDepth = Math.max(maxDepth, depth + 1);
			}

			visited.delete(id);
			memo.set(id, maxDepth);
			return maxDepth;
		}

		return dfs(nodeId);
	}

	private createNodeId(symbol: SymbolDefinition): string {
		return `${symbol.file}::${symbol.name}`;
	}
}
