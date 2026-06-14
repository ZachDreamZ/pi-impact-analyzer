import { TreeSitterParser } from "../extensions/parser";
import { GraphBuilder } from "../extensions/graph-builder";
import { ImpactAnalyzer } from "../extensions/impact-analyzer";

let parser: TreeSitterParser;
let graphBuilder: GraphBuilder;
let analyzer: ImpactAnalyzer;

const FILES = [
	{
		path: "src/utils.ts",
		content: `
export function add(a: number, b: number): number {
	return a + b;
}

export function multiply(a: number, b: number): number {
	return a * b;
}
	`,
	},
	{
		path: "src/app.ts",
		content: `
import { add, multiply } from "./utils";

export function calculateTotal(items: number[]): number {
	let sum = 0;
	for (const item of items) {
		sum = add(sum, item);
	}
	return multiply(sum, items.length);
}

export function displayTotal(items: number[]): void {
	const total = calculateTotal(items);
	console.log("Total:", total);
}
	`,
	},
];

beforeAll(async () => {
	parser = new TreeSitterParser();
	await parser.initialize();
	graphBuilder = new GraphBuilder(parser);
	graphBuilder.build(FILES);
	analyzer = new ImpactAnalyzer(graphBuilder.getGraph());
});

describe("ImpactAnalyzer — Diff Analysis", () => {
	it("parses a unified diff and finds affected symbols", () => {
		const diff = [
			"--- a/src/utils.ts",
			"+++ b/src/utils.ts",
			"@@ -1,5 +1,6 @@",
			" export function add(a: number, b: number): number {",
			"-	return a + b;",
			"+	return a + b + 1;",
			" }",
			"",
		].join("\n");

		const result = analyzer.analyzeDiff(diff);

		expect(result.type).toBe("diff");
		expect(result.summary.totalAffected).toBeGreaterThanOrEqual(2);
		// calculateTotal calls add, displayTotal calls calculateTotal
		expect(result.affected.some((a) => a.symbol === "calculateTotal")).toBe(
			true,
		);
		expect(result.affected.some((a) => a.symbol === "displayTotal")).toBe(true);
		expect(result.recommendations.length).toBeGreaterThan(0);
	});

	it("returns empty result for diff with no changes", () => {
		const result = analyzer.analyzeDiff("");

		expect(result.type).toBe("diff");
		expect(result.summary.totalAffected).toBe(0);
		expect(result.recommendations[0]).toContain("Nothing to analyze");
	});

	it("parses diff with file header only (no hunk changes)", () => {
		const diff = ["--- a/src/app.ts", "+++ b/src/app.ts"].join("\n");

		const result = analyzer.analyzeDiff(diff);
		expect(result.summary.totalAffected).toBe(0);
	});

	it("handles diff affecting multiple files", () => {
		const diff = [
			"--- a/src/utils.ts",
			"+++ b/src/utils.ts",
			"@@ -1,5 +1,5 @@",
			" export function add(a: number, b: number): number {",
			"+  return a + b;",
			" }",
			"--- a/src/app.ts",
			"+++ b/src/app.ts",
			"@@ -1,5 +1,6 @@",
			" export function calculateTotal(items: number[]): number {",
			"-	let sum = 0;",
			"+	let sum = 1;",
			" }",
		].join("\n");

		const result = analyzer.analyzeDiff(diff);

		// Both files changed
		expect(result.summary.totalAffected).toBeGreaterThanOrEqual(3);
		// findOrphans not affected because we changed calculateTotal and add
		expect(result.affected.some((a) => a.symbol === "displayTotal")).toBe(true);
	});

	it("generates diff-specific recommendations", () => {
		const diff = [
			"--- a/src/utils.ts",
			"+++ b/src/utils.ts",
			"@@ -5,3 +5,3 @@",
			" export function multiply(a: number, b: number): number {",
			"-	return a * b;",
			"+	return a * b * 2;",
			" }",
		].join("\n");

		const result = analyzer.analyzeDiff(diff);

		expect(result.recommendations.length).toBeGreaterThan(0);
		// Recommendations should mention number of files changed
		expect(result.target).toContain("file(s)");
	});
});
