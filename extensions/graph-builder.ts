import type { TreeSitterParser } from "./parser";
import { ASTExtractor } from "./extractor";
import { SymbolResolver } from "./symbol-resolver";
import type {
	CallGraph,
	GraphNode,
	FileMetadata,
	SymbolDefinition,
	CallSite,
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
	 */
	public build(files: Array<{ path: string; content: string }>): CallGraph {
		console.log(
			`[pi-impact-analyzer] Building graph from ${files.length} files...`,
		);
		const startTime = Date.now();

		for (const file of files) {
			this.indexFile(file.path, file.content);
		}

		this.resolveAllImports();
		this.linkCallSites();
		this.calculateRiskScores();

		const duration = Date.now() - startTime;
		console.log(`[pi-impact-analyzer] Graph built in ${duration}ms`);
		console.log(`  Nodes: ${this.graph.nodes.size}`);
		console.log(`  Edges: ${this.graph.edges.length}`);
		console.log(`  Files: ${this.graph.files.size}`);

		return this.graph;
	}

	/**
	 * Add a single file to the graph.
	 */
	public addFile(filePath: string, content: string): void {
		this.indexFile(filePath, content);
		this.resolveAllImports();
		this.linkCallSites();
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
		const tree = this.parser.parse(content);
		const rootNode = tree.rootNode;

		const symbols = this.extractor.extractSymbols(rootNode, filePath);
		const callSites = this.extractor.extractCallSites(
			rootNode,
			filePath,
			symbols,
		);
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
			this.createImportEdges(importStmt, exportedSymbols);
		}
	}

	private createImportEdges(
		importStmt: ImportStatement,
		exportedSymbols: SymbolDefinition[],
	): void {
		for (const importSymbol of importStmt.symbols) {
			const matchingExport = this.findMatchingExport(exportedSymbols, importSymbol.name);
			if (!matchingExport) continue;

			const fromId = this.createNodeId(matchingExport);
			const importedNodeIds = this.graph.symbolIndex.get(importSymbol.name) || [];

			for (const toId of importedNodeIds) {
				if (fromId !== toId) {
					this.graph.edges.push({
						from: fromId,
						to: toId,
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
			for (const callSite of metadata.callSites) {
				this.processCallSite(callSite, filePath);
			}
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
			callSite.line <= symbol.line + 50
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
			node.fanOut = adjacencyList.get(nodeId)?.size || 0;
			node.fanIn = reverseAdjacencyList.get(nodeId)?.size || 0;
			node.callees = adjacencyList.get(nodeId) || new Set();
			node.callers = reverseAdjacencyList.get(nodeId) || new Set();
		}

		const pagerank = this.calculatePageRank(reverseAdjacencyList);

		for (const [nodeId, node] of this.graph.nodes) {
			const depth = this.calculateMaxDepth(nodeId, reverseAdjacencyList);
			const rank = pagerank.get(nodeId) || 0;
			node.riskScore = node.fanIn * 10 + depth * 5 + rank * 100;
		}
	}

	private calculatePageRank(
		reverseAdj: Map<string, Set<string>>,
	): Map<string, number> {
		const damping = 0.85;
		const iterations = 50;
		const nodeCount = this.graph.nodes.size;

		const pagerank = new Map<string, number>();
		for (const [nodeId] of this.graph.nodes) {
			pagerank.set(nodeId, 1 / nodeCount);
		}

		for (let i = 0; i < iterations; i++) {
			const newPagerank = new Map<string, number>();

			for (const [nodeId] of this.graph.nodes) {
				let sum = 0;
				const inLinks = reverseAdj.get(nodeId) || new Set();

				for (const inLink of inLinks) {
					const outLinks = this.graph.nodes.get(inLink)?.fanOut || 1;
					sum += (pagerank.get(inLink) || 0) / outLinks;
				}

				newPagerank.set(nodeId, (1 - damping) / nodeCount + damping * sum);
			}

			for (const [nodeId, value] of newPagerank) {
				pagerank.set(nodeId, value);
			}
		}

		return pagerank;
	}

	private calculateMaxDepth(
		nodeId: string,
		reverseAdj: Map<string, Set<string>>,
		visited: Set<string> = new Set(),
	): number {
		if (visited.has(nodeId)) return 0;
		visited.add(nodeId);

		const inLinks = reverseAdj.get(nodeId) || new Set();
		if (inLinks.size === 0) return 0;

		let maxDepth = 0;
		for (const inLink of inLinks) {
			const depth = this.calculateMaxDepth(
				inLink,
				reverseAdj,
				new Set(visited),
			);
			maxDepth = Math.max(maxDepth, depth + 1);
		}

		return maxDepth;
	}

	private createNodeId(symbol: SymbolDefinition): string {
		return `${symbol.file}::${symbol.name}`;
	}
}

// Re-export types for convenience
type ImportStatement = import("./types").ImportStatement;
