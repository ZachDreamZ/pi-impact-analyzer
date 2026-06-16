/**
 * Performance Tests for pi-impact-analyzer v0.3.0
 */

import { GraphBuilder } from "./extensions/graph-builder";
import { ImpactAnalyzer } from "./extensions/impact-analyzer";
import { TreeSitterParser } from "./extensions/parser";

async function runPerfTests() {
	console.log("🚀 Starting Performance Tests for pi-impact-analyzer v0.3.0\n");

	const parser = new TreeSitterParser();
	await parser.initialize();

	const graphBuilder = new GraphBuilder(parser);

	// Test 1: Graph Build Performance
	console.log("📊 Test 1: Graph Build Performance");
	const testFiles = generateTestFiles(100);
	const startTime = Date.now();
	graphBuilder.build(testFiles);
	const buildTime = Date.now() - startTime;
	console.log(`✓ Built graph for ${testFiles.length} files in ${buildTime}ms`);
	console.log(
		`✓ Average: ${(buildTime / testFiles.length).toFixed(2)}ms per file\n`,
	);

	// Test 2: Incremental Index Performance
	console.log("📊 Test 2: Incremental Index Performance");
	const singleFile = generateTestFiles(1)[0];
	const incStartTime = Date.now();
	graphBuilder.addFile(
		`${singleFile.path}.new`,
		`${singleFile.content}\n// Added line`,
	);
	const incTime = Date.now() - incStartTime;
	console.log(`✓ Incremental index: ${incTime}ms\n`);

	// Test 3: Impact Analysis Performance
	console.log("📊 Test 3: Impact Analysis Performance");
	const analyzer = new ImpactAnalyzer(graphBuilder.getGraph());
	const symbols = Array.from(graphBuilder.getGraph().symbolIndex.keys());

	if (symbols.length > 0) {
		const analysisStart = Date.now();
		for (let i = 0; i < Math.min(100, symbols.length); i++) {
			analyzer.analyzeSymbol(symbols[i % symbols.length]);
		}
		const analysisTime = Date.now() - analysisStart;
		console.log(
			`✓ Analyzed ${Math.min(100, symbols.length)} symbols in ${analysisTime}ms`,
		);
		console.log(
			`✓ Average: ${(analysisTime / Math.min(100, symbols.length)).toFixed(2)}ms per analysis\n`,
		);
	}

	// Test 4: Large Graph Performance
	console.log("📊 Test 4: Large Graph Performance (1000 files)");
	const largeFiles = generateTestFiles(1000);
	const largeStart = Date.now();
	graphBuilder.build(largeFiles);
	const largeTime = Date.now() - largeStart;
	console.log(`✓ Built graph for ${largeFiles.length} files in ${largeTime}ms`);
	console.log(
		`✓ Throughput: ${((largeFiles.length / largeTime) * 1000).toFixed(0)} files/second\n`,
	);

	// Test 5: File Hash Performance
	console.log("📊 Test 5: File Hash Performance");
	const crypto = require("crypto");
	const hashTestContent = "x".repeat(10000);
	const hashStart = Date.now();
	for (let i = 0; i < 10000; i++) {
		crypto.createHash("md5").update(hashTestContent).digest("hex");
	}
	const hashTime = Date.now() - hashStart;
	console.log(`✓ 10000 hashes in ${hashTime}ms`);
	console.log(`✓ Average: ${(hashTime / 10000).toFixed(4)}ms per hash\n`);

	// Test 6: Cache Serialization Performance
	console.log("📊 Test 6: Cache Serialization Performance");
	const graph = graphBuilder.getGraph();
	const serializeStart = Date.now();
	const graphData = {
		nodes: Array.from(graph.nodes.entries()).map(([id, node]) => ({
			id,
			symbol: node.symbol,
			callers: Array.from(node.callers),
			callees: Array.from(node.callees),
			fanIn: node.fanIn,
			fanOut: node.fanOut,
			riskScore: node.riskScore,
		})),
		edges: graph.edges,
		files: Array.from(graph.files.entries()).map(([filePath, meta]) => {
			const { path: _path, ...rest } = meta as any;
			return { path: filePath, ...rest };
		}),
		symbolIndex: Array.from(graph.symbolIndex.entries()),
	};
	const serialized = JSON.stringify(graphData);
	const serializeTime = Date.now() - serializeStart;
	console.log(`✓ Serialized graph: ${serializeTime}ms`);
	console.log(`✓ Size: ${(serialized.length / 1024).toFixed(2)} KB\n`);

	// Summary
	console.log(
		"═══════════════════════════════════════════════════════════════",
	);
	console.log("✅ Performance Tests Complete!");
	console.log(
		"═══════════════════════════════════════════════════════════════",
	);
}

function generateTestFiles(
	count: number,
): Array<{ path: string; content: string }> {
	const files: Array<{ path: string; content: string }> = [];

	for (let i = 0; i < count; i++) {
		const content = `
import { helper${i} } from './helper${i}';

export function function${i}(x: number): number {
	const result = helper${i}(x);
	return result * 2;
}

export class Class${i} {
	private value: number;
	
	constructor(value: number) {
		this.value = value;
	}
	
	public method${i}(): number {
		return function${i}(this.value);
	}
}
`;
		files.push({
			path: `/test/file${i}.ts`,
			content,
		});
	}

	return files;
}

runPerfTests().catch(console.error);
