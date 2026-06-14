import { ImpactAnalyzer } from "../extensions/impact-analyzer";
import type {
	CallGraph,
	GraphNode,
	SymbolDefinition,
	FileMetadata,
} from "../extensions/types";

/** Build a minimal test graph from symbol definitions */
function buildGraph(
	symbols: SymbolDefinition[],
	edges: Array<{ from: string; to: string }>,
): CallGraph {
	const nodes = new Map<string, GraphNode>();
	const symbolIndex = new Map<string, string[]>();
	const files = new Map<string, FileMetadata>();

	for (const sym of symbols) {
		const id = `${sym.file}::${sym.name}`;
		nodes.set(id, {
			id,
			symbol: sym,
			callers: new Set(),
			callees: new Set(),
			fanIn: 0,
			fanOut: 0,
			riskScore: 0,
		});

		const existing = symbolIndex.get(sym.name) || [];
		existing.push(id);
		symbolIndex.set(sym.name, existing);

		if (!files.has(sym.file)) {
			files.set(sym.file, {
				path: sym.file,
				hash: "",
				lastModified: 0,
				symbols: [],
				callSites: [],
				imports: [],
				exports: [],
			});
		}
		files.get(sym.file)!.symbols.push(sym);
	}

	const graphEdges = edges.map((e) => ({
		from: e.from,
		to: e.to,
		confidence: 1.0,
		type: "call" as const,
	}));

	// Wire up caller/callee sets
	for (const edge of graphEdges) {
		const fromNode = nodes.get(edge.from);
		const toNode = nodes.get(edge.to);
		if (fromNode) {
			fromNode.callees.add(edge.to);
			fromNode.fanOut = fromNode.callees.size;
		}
		if (toNode) {
			toNode.callers.add(edge.from);
			toNode.fanIn = toNode.callers.size;
		}
	}

	return { nodes, edges: graphEdges, files, symbolIndex };
}

describe("ImpactAnalyzer", () => {
	describe("analyzeSymbol", () => {
		it("finds direct callers of a symbol", () => {
			const symbols: SymbolDefinition[] = [
				{
					name: "helper",
					type: "function",
					file: "utils.ts",
					line: 1,
					column: 0,
					endLine: 3,
					endColumn: 0,
					startIndex: 0,
					endIndex: 10,
					isExported: true,
				},
				{
					name: "app",
					type: "function",
					file: "app.ts",
					line: 1,
					column: 0,
					endLine: 5,
					endColumn: 0,
					startIndex: 0,
					endIndex: 20,
					isExported: true,
				},
			];

			const graph = buildGraph(symbols, [
				{ from: "app.ts::app", to: "utils.ts::helper" },
			]);
			const analyzer = new ImpactAnalyzer(graph);
			const result = analyzer.analyzeSymbol("helper");

			expect(result.summary.totalAffected).toBe(2); // helper + app
			expect(result.summary.directDependents).toBe(1);
			expect(result.affected.some((a) => a.symbol === "app")).toBe(true);
		});

		it("finds transitive callers via BFS", () => {
			const symbols: SymbolDefinition[] = [
				{
					name: "leaf",
					type: "function",
					file: "leaf.ts",
					line: 1,
					column: 0,
					endLine: 3,
					endColumn: 0,
					startIndex: 0,
					endIndex: 10,
					isExported: true,
				},
				{
					name: "mid",
					type: "function",
					file: "mid.ts",
					line: 1,
					column: 0,
					endLine: 3,
					endColumn: 0,
					startIndex: 0,
					endIndex: 10,
					isExported: true,
				},
				{
					name: "top",
					type: "function",
					file: "top.ts",
					line: 1,
					column: 0,
					endLine: 3,
					endColumn: 0,
					startIndex: 0,
					endIndex: 10,
					isExported: true,
				},
			];

			const graph = buildGraph(symbols, [
				{ from: "mid.ts::mid", to: "leaf.ts::leaf" },
				{ from: "top.ts::top", to: "mid.ts::mid" },
			]);
			const analyzer = new ImpactAnalyzer(graph);
			const result = analyzer.analyzeSymbol("leaf");

			expect(result.summary.totalAffected).toBe(3);
			expect(result.summary.directDependents).toBe(1); // mid
			expect(result.summary.transitiveDependents).toBe(1); // top
		});

		it("respects maxDepth option", () => {
			const symbols: SymbolDefinition[] = [
				{
					name: "leaf",
					type: "function",
					file: "leaf.ts",
					line: 1,
					column: 0,
					endLine: 3,
					endColumn: 0,
					startIndex: 0,
					endIndex: 10,
					isExported: true,
				},
				{
					name: "mid",
					type: "function",
					file: "mid.ts",
					line: 1,
					column: 0,
					endLine: 3,
					endColumn: 0,
					startIndex: 0,
					endIndex: 10,
					isExported: true,
				},
				{
					name: "top",
					type: "function",
					file: "top.ts",
					line: 1,
					column: 0,
					endLine: 3,
					endColumn: 0,
					startIndex: 0,
					endIndex: 10,
					isExported: true,
				},
			];

			const graph = buildGraph(symbols, [
				{ from: "mid.ts::mid", to: "leaf.ts::leaf" },
				{ from: "top.ts::top", to: "mid.ts::mid" },
			]);
			const analyzer = new ImpactAnalyzer(graph);
			const result = analyzer.analyzeSymbol("leaf", { maxDepth: 1 });

			expect(result.summary.totalAffected).toBe(2); // leaf + mid only
			expect(result.summary.directDependents).toBe(1);
			expect(result.summary.transitiveDependents).toBe(0);
		});

		it("handles empty graph", () => {
			const symbols: SymbolDefinition[] = [];
			const graph = buildGraph(symbols, []);
			const analyzer = new ImpactAnalyzer(graph);
			const result = analyzer.analyzeSymbol("nonexistent");

			expect(result.summary.totalAffected).toBe(0);
			expect(result.recommendations.length).toBeGreaterThan(0);
		});

		it("excludes test files when includeTests is false", () => {
			const symbols: SymbolDefinition[] = [
				{
					name: "helper",
					type: "function",
					file: "utils.spec.ts",
					line: 1,
					column: 0,
					endLine: 3,
					endColumn: 0,
					startIndex: 0,
					endIndex: 10,
					isExported: true,
				},
				{
					name: "app",
					type: "function",
					file: "helper.ts",
					line: 1,
					column: 0,
					endLine: 3,
					endColumn: 0,
					startIndex: 0,
					endIndex: 10,
					isExported: true,
				},
			];

			const graph = buildGraph(symbols, [
				{ from: "utils.spec.ts::helper", to: "helper.ts::app" },
			]);
			const analyzer = new ImpactAnalyzer(graph);
			const result = analyzer.analyzeSymbol("app", { includeTests: false });

			expect(result.summary.totalAffected).toBe(1); // only app, not test file
		});
	});

	describe("analyzeFile", () => {
		it("analyzes impact of all symbols in a file", () => {
			const symbols: SymbolDefinition[] = [
				{
					name: "fn1",
					type: "function",
					file: "lib.ts",
					line: 1,
					column: 0,
					endLine: 3,
					endColumn: 0,
					startIndex: 0,
					endIndex: 10,
					isExported: true,
				},
				{
					name: "fn2",
					type: "function",
					file: "lib.ts",
					line: 5,
					column: 0,
					endLine: 7,
					endColumn: 0,
					startIndex: 20,
					endIndex: 30,
					isExported: true,
				},
				{
					name: "consumer",
					type: "function",
					file: "consumer.ts",
					line: 1,
					column: 0,
					endLine: 3,
					endColumn: 0,
					startIndex: 0,
					endIndex: 10,
					isExported: true,
				},
			];

			const graph = buildGraph(symbols, [
				{ from: "consumer.ts::consumer", to: "lib.ts::fn1" },
				{ from: "consumer.ts::consumer", to: "lib.ts::fn2" },
			]);
			// Add files metadata
			graph.files.set("lib.ts", {
				path: "lib.ts",
				hash: "",
				lastModified: 0,
				symbols: [symbols[0], symbols[1]],
				callSites: [],
				imports: [],
				exports: [],
			});

			const analyzer = new ImpactAnalyzer(graph);
			const result = analyzer.analyzeFile("lib.ts");

			expect(result.summary.totalAffected).toBeGreaterThanOrEqual(2);
		});
	});

	describe("findRiskiestSymbols", () => {
		it("returns symbols sorted by risk score", () => {
			const symbols: SymbolDefinition[] = [];
			for (let i = 0; i < 5; i++) {
				symbols.push({
					name: `fn${i}`,
					type: "function",
					file: "app.ts",
					line: i,
					column: 0,
					endLine: i + 3,
					endColumn: 0,
					startIndex: 0,
					endIndex: 10,
					isExported: true,
				});
			}

			const graph = buildGraph(symbols, [
				{ from: "app.ts::fn1", to: "app.ts::fn0" },
				{ from: "app.ts::fn2", to: "app.ts::fn1" },
				{ from: "app.ts::fn3", to: "app.ts::fn2" },
				{ from: "app.ts::fn4", to: "app.ts::fn3" },
			]);
			const analyzer = new ImpactAnalyzer(graph);
			const riskiest = analyzer.findRiskiestSymbols(3);

			expect(riskiest.length).toBeLessThanOrEqual(3);
			expect(riskiest[0].riskScore).toBeGreaterThanOrEqual(
				riskiest[riskiest.length - 1].riskScore,
			);
		});

		it("handles empty graph", () => {
			const graph = buildGraph([], []);
			const analyzer = new ImpactAnalyzer(graph);
			const result = analyzer.findRiskiestSymbols(5);
			expect(result).toEqual([]);
		});
	});

	describe("findOrphans", () => {
		it("finds symbols with no callers", () => {
			const symbols: SymbolDefinition[] = [
				{
					name: "called",
					type: "function",
					file: "lib.ts",
					line: 1,
					column: 0,
					endLine: 3,
					endColumn: 0,
					startIndex: 0,
					endIndex: 10,
					isExported: true,
				},
				{
					name: "orphan",
					type: "function",
					file: "lib.ts",
					line: 5,
					column: 0,
					endLine: 7,
					endColumn: 0,
					startIndex: 20,
					endIndex: 30,
					isExported: true,
				},
			];

			const graph = buildGraph(symbols, []);
			const analyzer = new ImpactAnalyzer(graph);
			const orphans = analyzer.findOrphans();

			expect(orphans.length).toBe(2); // both have zero callers
			expect(orphans.map((o) => o.symbol).sort()).toEqual(["called", "orphan"]);
		});
	});
});
