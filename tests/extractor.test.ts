import { TreeSitterParser } from "../extensions/parser";
import { ASTExtractor } from "../extensions/extractor";

let parser: TreeSitterParser;
let extractor: ASTExtractor;

beforeAll(async () => {
	parser = new TreeSitterParser();
	await parser.initialize();
	extractor = new ASTExtractor();
});

function parseCode(code: string) {
	return parser.parse(code).rootNode;
}

import fs from "fs";
import path from "path";

describe("ASTExtractor", () => {
	describe("extractSymbols", () => {
		it("extracts function declarations", () => {
			const root = parseCode("function foo(a: number): string { return ''; }");
			const symbols = extractor.extractSymbols(root, "test.ts");

			const fn = symbols.find((s) => s.name === "foo");
			expect(fn).toBeDefined();
			expect(fn!.type).toBe("function");
			expect(fn!.file).toBe("test.ts");
			expect(fn!.line).toBeGreaterThanOrEqual(0);
		});

		it("extracts class declarations", () => {
			const root = parseCode("class MyClass {}");
			const symbols = extractor.extractSymbols(root, "test.ts");

			const cls = symbols.find((s) => s.name === "MyClass");
			expect(cls).toBeDefined();
			expect(cls!.type).toBe("class");
		});

		it("extracts methods from classes", () => {
			const root = parseCode("class Foo { bar() {} }");
			const symbols = extractor.extractSymbols(root, "test.ts");

			const method = symbols.find((s) => s.name === "bar");
			expect(method).toBeDefined();
			expect(method!.type).toBe("method");
		});

		it("extracts variable declarators", () => {
			const root = parseCode("const x = 42;");
			const symbols = extractor.extractSymbols(root, "test.ts");

			const v = symbols.find((s) => s.name === "x");
			expect(v).toBeDefined();
			expect(v!.type).toBe("variable");
		});

		it("does NOT duplicate const arrow functions", () => {
			// `const foo = () => {}` should produce ONE symbol node (variable "foo"),
			// not two (arrow_function + variable_declarator)
			const root = parseCode("const foo = () => { return 1; };");
			const symbols = extractor.extractSymbols(root, "test.ts");

			const foos = symbols.filter((s) => s.name === "foo");
			expect(foos).toHaveLength(1);
			expect(foos[0].type).toBe("variable");
		});

		it("extracts interface declarations", () => {
			const root = parseCode("interface MyInterface { name: string; }");
			const symbols = extractor.extractSymbols(root, "test.ts");

			const inf = symbols.find((s) => s.name === "MyInterface");
			expect(inf).toBeDefined();
			expect(inf!.type).toBe("interface");
		});

		it("extracts type aliases", () => {
			const root = parseCode("type MyType = string;");
			const symbols = extractor.extractSymbols(root, "test.ts");

			const t = symbols.find((s) => s.name === "MyType");
			expect(t).toBeDefined();
			expect(t!.type).toBe("type");
		});

		it("sets isExported for exported declarations", () => {
			const root = parseCode("export function exportedFn() {}");
			const symbols = extractor.extractSymbols(root, "test.ts");

			const fn = symbols.find((s) => s.name === "exportedFn");
			expect(fn).toBeDefined();
			expect(fn!.isExported).toBe(true);
		});

		it("marks non-exported symbols correctly", () => {
			const root = parseCode("function internalFn() {}");
			const symbols = extractor.extractSymbols(root, "test.ts");

			const fn = symbols.find((s) => s.name === "internalFn");
			expect(fn).toBeDefined();
			expect(fn!.isExported).toBe(false);
		});

		it("detects export const via grandparent check", () => {
			const root = parseCode("export const EXPORTED_VAL = 42;");
			const symbols = extractor.extractSymbols(root, "test.ts");

			const v = symbols.find((s) => s.name === "EXPORTED_VAL");
			expect(v).toBeDefined();
			expect(v!.isExported).toBe(true);
		});

		it("returns empty array for empty input", () => {
			const root = parseCode("// just a comment\n");
			const symbols = extractor.extractSymbols(root, "empty.ts");
			expect(symbols).toEqual([]);
		});

		it("reports endLine and endColumn", () => {
			const root = parseCode("function foo() {}");
			const symbols = extractor.extractSymbols(root, "test.ts");

			const fn = symbols.find((s) => s.name === "foo");
			expect(fn).toBeDefined();
			expect(fn!.endLine).toBeGreaterThanOrEqual(fn!.line);
		});
	});

	describe("extractCallSites", () => {
		it("finds direct function calls", () => {
			const root = parseCode("function caller() { target(); }");
			const calls = extractor.extractCallSites(root, "test.ts");

			const call = calls.find((c) => c.calleeName === "target");
			expect(call).toBeDefined();
			expect(call!.callerSymbol).toBe("caller");
			expect(call!.callerFile).toBe("test.ts");
		});

		it("finds method calls", () => {
			const root = parseCode("function caller() { obj.method(); }");
			const calls = extractor.extractCallSites(root, "test.ts");

			const call = calls.find((c) => c.calleeName === "method");
			expect(call).toBeDefined();
		});

		it("assigns module_scope for top-level calls", () => {
			const root = parseCode("topLevelCall();");
			const calls = extractor.extractCallSites(root, "test.ts");

			const call = calls.find((c) => c.calleeName === "topLevelCall");
			expect(call).toBeDefined();
			expect(call!.callerSymbol).toBe("module_scope");
		});
	});

	describe("extractImports", () => {
		it("extracts named imports", () => {
			const root = parseCode('import { Foo, Bar } from "./module";');
			const imports = extractor.extractImports(root, "test.ts");

			const imp = imports.find((i) => i.source === "./module");
			expect(imp).toBeDefined();
			expect(imp!.symbols).toContainEqual(
				expect.objectContaining({ name: "Foo" }),
			);
			expect(imp!.symbols).toContainEqual(
				expect.objectContaining({ name: "Bar" }),
			);
		});

		it("extracts default imports", () => {
			const root = parseCode('import Default from "./module";');
			const imports = extractor.extractImports(root, "test.ts");

			const imp = imports.find((i) => i.source === "./module");
			expect(imp).toBeDefined();
			expect(imp!.symbols).toContainEqual(
				expect.objectContaining({ name: "Default" }),
			);
		});

		it("extracts namespace imports", () => {
			const root = parseCode('import * as Namespace from "./module";');
			const imports = extractor.extractImports(root, "test.ts");

			const imp = imports.find((i) => i.source === "./module");
			expect(imp).toBeDefined();
			expect(imp!.symbols).toContainEqual(
				expect.objectContaining({ name: "Namespace" }),
			);
		});

		it("captures both default and namespace in mixed import", () => {
			// import foo, * as bar from 'baz'
			const root = parseCode('import foo, * as bar from "./module";');
			const imports = extractor.extractImports(root, "test.ts");

			const imp = imports.find((i) => i.source === "./module");
			expect(imp).toBeDefined();
			expect(imp!.symbols).toContainEqual(
				expect.objectContaining({ name: "foo" }),
			);
			expect(imp!.symbols).toContainEqual(
				expect.objectContaining({ name: "bar" }),
			);
		});

		it("records import line numbers", () => {
			const code = `
				import { A } from "./a";
				import { B } from "./b";
			`;
			const root = parseCode(code);
			const imports = extractor.extractImports(root, "test.ts");
			expect(imports.length).toBeGreaterThanOrEqual(2);
			// Each import should have a line number (the first two imports are at lines 2 and 3 if counting from 1)
			imports.forEach((imp) => {
				expect(imp.line).toBeGreaterThanOrEqual(0);
			});
		});
	});

	describe("extractExports", () => {
		it("extracts named export declarations", () => {
			const root = parseCode("export function foo() {}");
			const exports = extractor.extractExports(root, "test.ts");

			const exp = exports.find((e) => e.symbols.some((s) => s.name === "foo"));
			expect(exp).toBeDefined();
		});

		it("marks default exports correctly", () => {
			const root = parseCode("export default class App {}");
			const exports = extractor.extractExports(root, "test.ts");

			const exp = exports.find((e) => e.symbols.some((s) => s.name === "App"));
			expect(exp).toBeDefined();
			const appSymbol = exp!.symbols.find((s) => s.name === "App");
			expect(appSymbol?.isDefault).toBe(true);
		});

		it("marks non-default exports", () => {
			const root = parseCode("export function foo() {}");
			const exports = extractor.extractExports(root, "test.ts");

			const exp = exports.find((e) => e.symbols.some((s) => s.name === "foo"));
			const fooSymbol = exp!.symbols.find((s) => s.name === "foo");
			expect(fooSymbol?.isDefault).toBe(false);
		});

		it("handles export { foo, bar } syntax", () => {
			const root = parseCode(
				"const foo = 1; const bar = 2; export { foo, bar };",
			);
			const exports = extractor.extractExports(root, "test.ts");

			// The export_statement with export_clause should be found
			const exportStmt = exports.find((e) =>
				e.symbols.some((s) => s.name === "foo"),
			);
			expect(exportStmt).toBeDefined();
			expect(exportStmt!.symbols.length).toBeGreaterThanOrEqual(2);
		});
	});
});

describe("TSX Support", () => {
	it("parses TSX fixtures with JSX elements", () => {
		const fixturePath = path.join(__dirname, "__fixtures__", "tsx-sample.tsx");
		const code = fs.readFileSync(fixturePath, "utf-8");
		parser.setLanguageForFile("file.tsx");
		const root = parser.parse(code).rootNode;

		const symbols = extractor.extractSymbols(root, fixturePath);

		// Should find: App, useCounter
		const appSymbol = symbols.find((s) => s.name === "App");
		expect(appSymbol).toBeDefined();
		expect(appSymbol!.isExported).toBe(true);

		const useCounterSymbol = symbols.find((s) => s.name === "useCounter");
		expect(useCounterSymbol).toBeDefined();
	});

	it("extracts imports from TSX", () => {
		const fixturePath = path.join(__dirname, "__fixtures__", "tsx-sample.tsx");
		const code = fs.readFileSync(fixturePath, "utf-8");
		parser.setLanguageForFile("file.tsx");
		const root = parser.parse(code).rootNode;

		const imports = extractor.extractImports(root, fixturePath);

		// Two import statements in the fixture: import type React, import { useState, useEffect }
		const reactImport = imports.find((i) => i.source === "react");
		expect(reactImport).toBeDefined();
		// At minimum: one import for 'react' with at least one symbol
		expect(reactImport!.symbols.length).toBeGreaterThanOrEqual(1);
	});

	it("parses .ts file with TSX grammar (backward-compatible)", () => {
		parser.setLanguageForFile("file.ts");
		const root = parser.parse(
			"function foo<T>(x: T): T { return x; }",
		).rootNode;

		const symbols = extractor.extractSymbols(root, "test.ts");
		const fooSymbol = symbols.find((s) => s.name === "foo");
		expect(fooSymbol).toBeDefined();
		expect(fooSymbol!.type).toBe("function");
	});
});
