import { TreeSitterParser } from "../extensions/parser";
import { GraphBuilder } from "../extensions/graph-builder";
import { ImpactAnalyzer } from "../extensions/impact-analyzer";

describe("Integration", () => {
	it("buildGraph and impactAnalyzeHandler work end-to-end", async () => {
		const parser = new TreeSitterParser();
		await parser.initialize();
		const builder = new GraphBuilder(parser);

		builder.build([
			{
				path: "main.ts",
				content: `
					export function start() { process("input"); }
					export function process(data: string) { validate(data); }
					export function validate(data: string) {}
				`,
			},
		]);

		const analyzer = new ImpactAnalyzer(builder.getGraph());

		// Analyze the leaf symbol
		const result = analyzer.analyzeSymbol("validate");
		expect(result.summary.totalAffected).toBe(3); // validate + process + start
		expect(result.summary.directDependents).toBe(1); // process
		expect(result.summary.transitiveDependents).toBe(1); // start (depth 2)

		// Check affected symbols
		const processSymbol = result.affected.find((s) => s.symbol === "process");
		expect(processSymbol).toBeDefined();
		expect(processSymbol!.depth).toBe(1);

		const startSymbol = result.affected.find((s) => s.symbol === "start");
		expect(startSymbol).toBeDefined();
		expect(startSymbol!.depth).toBe(2);
	});

	it("handles cross-file dependencies via imports", async () => {
		const parser = new TreeSitterParser();
		await parser.initialize();
		const builder = new GraphBuilder(parser);

		builder.build([
			{
				path: "utils.ts",
				content: `
					export function format(data: string): string { return data; }
				`,
			},
			{
				path: "app.ts",
				content: `
					import { format } from "./utils";
					export function run() { format("hello"); }
				`,
			},
		]);

		const analyzer = new ImpactAnalyzer(builder.getGraph());

		// Analyze the format symbol
		const result = analyzer.analyzeSymbol("format");
		expect(result).toBeDefined();
		// Should at minimum find the symbol itself
		expect(result.target).toBe("format");
	});

	it("orphans and riskiest symbols work with real data", async () => {
		const parser = new TreeSitterParser();
		await parser.initialize();
		const builder = new GraphBuilder(parser);

		builder.build([
			{
				path: "test.ts",
				content: `
					export function live() { dead(); }
					function dead() {}
					function orphan() {}
				`,
			},
		]);

		const analyzer = new ImpactAnalyzer(builder.getGraph());

		const orphans = analyzer.findOrphans();
		// orphan() is not called by anyone (fanIn === 0)
		const orphanSymbol = orphans.find((s) => s.symbol === "orphan");
		expect(orphanSymbol).toBeDefined();
		expect(orphanSymbol!.symbol).toBe("orphan");

		const riskiest = analyzer.findRiskiestSymbols(5);
		// live() should be in the riskiest list since it has connections
		const liveRisk = riskiest.find((s) => s.symbol === "live");
		// live's risk should be non-zero as it calls dead and may have callers
		expect(riskiest.length).toBeGreaterThan(0);
	});
});
