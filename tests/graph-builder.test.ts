import { TreeSitterParser } from "../extensions/parser";
import { GraphBuilder } from "../extensions/graph-builder";
import { ASTExtractor } from "../extensions/extractor";

let parser: TreeSitterParser;
let graphBuilder: GraphBuilder;

beforeAll(async () => {
	parser = new TreeSitterParser();
	await parser.initialize();
});

beforeEach(() => {
	graphBuilder = new GraphBuilder(parser);
});

describe("GraphBuilder", () => {
	describe("build()", () => {
		it("returns a CallGraph with nodes for symbols", () => {
			const files = [
				{
					path: "test.ts",
					content: `
						export function greet(name: string): string {
							return \`Hello \${name}\`;
						}
						export class Service {
							run() { greet("world"); }
						}
					`,
				},
			];

			const graph = graphBuilder.build(files);

			expect(graph.nodes.size).toBeGreaterThanOrEqual(2);
			expect(graph.nodes.has("test.ts::greet")).toBe(true);
			expect(graph.nodes.has("test.ts::Service")).toBe(true);
		});

		it("creates edges for call sites", () => {
			const files = [
				{
					path: "test.ts",
					content: `
						function callee() {}
						function caller() { callee(); }
					`,
				},
			];

			const graph = graphBuilder.build(files);

			// Find the call edge
			const callEdge = graph.edges.find(
				(e) => e.from === "test.ts::caller" && e.to === "test.ts::callee",
			);
			expect(callEdge).toBeDefined();
			expect(callEdge!.type).toBe("call");
		});

		it("resets graph when build() called multiple times", () => {
			const file1 = [
				{ path: "a.ts", content: "function a() { b(); }\nfunction b() {}" },
			];
			const file2 = [{ path: "c.ts", content: "function c() {}" }];

			const g1 = graphBuilder.build(file1);
			expect(g1.nodes.size).toBeGreaterThanOrEqual(2);

			const g2 = graphBuilder.build(file2);
			expect(g2.nodes.size).toBeGreaterThanOrEqual(1);
			// Should NOT contain nodes from the first build
			expect(g2.nodes.has("a.ts::a")).toBe(false);
			expect(g2.nodes.has("c.ts::c")).toBe(true);
		});

		it("sets fanIn and fanOut correctly", () => {
			const files = [
				{
					path: "test.ts",
					content: `
						function top() { mid(); }
						function mid() { bottom(); }
						function bottom() {}
					`,
				},
			];

			const graph = graphBuilder.build(files);
			const bottomNode = graph.nodes.get("test.ts::bottom");

			expect(bottomNode).toBeDefined();
			expect(bottomNode!.fanIn).toBeGreaterThanOrEqual(1); // mid calls bottom
		});

		it("returns empty graph for empty file list", () => {
			const graph = graphBuilder.build([]);
			expect(graph.nodes.size).toBe(0);
			expect(graph.edges.length).toBe(0);
			expect(graph.files.size).toBe(0);
		});
	});

	describe("addFile()", () => {
		it("incrementally adds a file to the graph", () => {
			graphBuilder.build([{ path: "a.ts", content: "function a() {}" }]);

			expect(graphBuilder.getGraph().nodes.size).toBe(1);
			expect(graphBuilder.getGraph().nodes.has("a.ts::a")).toBe(true);

			graphBuilder.addFile("b.ts", "function b() {}");

			expect(graphBuilder.getGraph().nodes.size).toBe(2);
			expect(graphBuilder.getGraph().nodes.has("b.ts::b")).toBe(true);
		});
	});

	describe("getGraph()", () => {
		it("returns the current graph state", () => {
			graphBuilder.build([{ path: "x.ts", content: "function x() {}" }]);

			const graph = graphBuilder.getGraph();
			expect(graph.nodes.size).toBe(1);
			expect(graph.files.size).toBe(1);
		});
	});

	describe("getResolver()", () => {
		it("returns a SymbolResolver instance", () => {
			const resolver = graphBuilder.getResolver();
			expect(resolver).toBeDefined();
		});
	});
});
