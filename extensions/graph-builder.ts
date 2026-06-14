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
	public async build(
		files: Array<{ path: string; content: string }>,
	): Promise<CallGraph> {
		console.log(
			`[pi-impact-analyzer] Building graph from ${files.length} files...`,
		);
		const startTime = Date.now();

		// Phase 1: Extract all symbols, calls, imports, exports
		for (const file of files) {
			await this.indexFile(file.path, file.content);
		}

		// Phase 2: Resolve imports and link symbols
		this.resolveAllImports();

		// Phase 3: Link call sites to symbol definitions
		this.linkCallSites();

		// Phase 4: Calculate initial risk scores
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
	public async addFile(filePath: string, content: string): Promise<void> {
		await this.indexFile(filePath, content);
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

	private async indexFile(filePath: string, content: string): Promise<void> {
		const tree = this.parser.parse(content);
		const rootNode = tree.rootNode;

		// Extract metadata
		const symbols = this.extractor.extractSymbols(rootNode, filePath);
		const callSites = this.extractor.extractCallSites(
			rootNode,
			filePath,
			symbols,
		);
		const imports = this.extractor.extractImports(rootNode, filePath);
		const exports = this.extractor.extractExports(rootNode, filePath);

		// Store file metadata
		const metadata: FileMetadata = {
			path: filePath,
			hash: "", // Could compute SHA-256 for incremental updates
			lastModified: Date.now(),
			symbols,
			callSites,
			imports,
			exports,
		};

		this.graph.files.set(filePath, metadata);
		this.resolver.indexFile(metadata);

		// Create nodes for each symbol
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

			// Index by name
			const existing = this.graph.symbolIndex.get(symbol.name) || [];
			existing.push(nodeId);
			this.graph.symbolIndex.set(symbol.name, existing);
		}
	}

	private resolveAllImports(): void {
		for (const [filePath, metadata] of this.graph.files) {
			for (const importStmt of metadata.imports) {
				const resolvedPath = this.resolver.resolveImportPath(
					importStmt,
					filePath,
				);
				if (!resolvedPath) continue;

				// Get exported symbols from the resolved file
				const exportedSymbols = this.resolver.getExportedSymbols(resolvedPath);

				// Create import edges
				for (const importSymbol of importStmt.symbols) {
					// Find matching exported symbol
					const matchingExport = exportedSymbols.find(
						(e) => e.name === importSymbol.name,
					);

					if (matchingExport) {
						const fromId = this.createNodeId(matchingExport);

						// Import all symbols from this import statement
						const importedNodeIds =
							this.graph.symbolIndex.get(importSymbol.name) || [];
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
			}
		}
	}

	private linkCallSites(): void {
		for (const [filePath, metadata] of this.graph.files) {
			for (const callSite of metadata.callSites) {
				// Find the caller symbol
				const callerNodeId = this.findCallerNode(callSite, filePath);
				if (!callerNodeId) continue;

				// Resolve the callee
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
		}
	}

	private findCallerNode(callSite: CallSite, filePath: string): string | null {
		// Find the symbol that contains this call site
		const metadata = this.graph.files.get(filePath);
		if (!metadata) return null;

		for (const symbol of metadata.symbols) {
			if (
				symbol.file === filePath &&
				callSite.line >= symbol.line &&
				callSite.line <= this.getEndLine(symbol, metadata)
			) {
				return this.createNodeId(symbol);
			}
		}

		// If no containing symbol found, it's in module scope
		// We could create a synthetic "module" node, but for now skip
		return null;
	}

	private getEndLine(
		symbol: SymbolDefinition,
		_metadata: FileMetadata,
	): number {
		// Approximate end line from the symbol's end index
		// In a real implementation, we'd track this from the AST
		return symbol.line + 50; // rough estimate
	}

	private calculateRiskScores(): void {
		// Build adjacency lists for traversal
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

		// Calculate fan-in and fan-out
		for (const [nodeId, node] of this.graph.nodes) {
			node.fanOut = adjacencyList.get(nodeId)?.size || 0;
			node.fanIn = reverseAdjacencyList.get(nodeId)?.size || 0;

			// Update callers and callees sets
			node.callees = adjacencyList.get(nodeId) || new Set();
			node.callers = reverseAdjacencyList.get(nodeId) || new Set();
		}

		// Calculate PageRank (simplified iterative version)
		const pagerank = this.calculatePageRank(reverseAdjacencyList);

		// Calculate final risk scores
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

		// Initialize PageRank values
		const pagerank = new Map<string, number>();
		for (const [nodeId] of this.graph.nodes) {
			pagerank.set(nodeId, 1 / nodeCount);
		}

		// Iterative calculation
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

			// Update pagerank
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
