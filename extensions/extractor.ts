import type {
	SymbolDefinition,
	CallSite,
	ImportStatement,
	ExportStatement,
} from "./types";

// Alias SyntaxNode as Node for readability in extraction logic
import type { SyntaxNode } from "web-tree-sitter";
type Node = SyntaxNode;

/**
 * Extracts symbols, call sites, imports, and exports from an AST.
 */
export class ASTExtractor {
	/**
	 * Extract all function, class, and method definitions from the AST.
	 */
	public extractSymbols(rootNode: Node, filePath: string): SymbolDefinition[] {
		const symbols: SymbolDefinition[] = [];
		this.walkNode(rootNode, (node) => {
			const symbol = this.extractSymbolDefinition(node, filePath);
			if (symbol) {
				symbols.push(symbol);
			}
		});
		return symbols;
	}

	/**
	 * Extract all call sites from the AST.
	 */
	public extractCallSites(rootNode: Node, filePath: string): CallSite[] {
		const callSites: CallSite[] = [];

		this.walkNode(rootNode, (node) => {
			if (node.type === "call_expression") {
				const callSite = this.extractCallSite(node, filePath);
				if (callSite) {
					callSites.push(callSite);
				}
			}
		});

		return callSites;
	}

	/**
	 * Extract all import statements from the AST.
	 */
	public extractImports(rootNode: Node, filePath: string): ImportStatement[] {
		const imports: ImportStatement[] = [];

		this.walkNode(rootNode, (node) => {
			if (node.type === "import_statement") {
				const imp = this.extractImport(node, filePath);
				if (imp) {
					imports.push(imp);
				}
			}
		});

		return imports;
	}

	/**
	 * Extract all export statements from the AST.
	 */
	public extractExports(rootNode: Node, filePath: string): ExportStatement[] {
		const exports: ExportStatement[] = [];

		this.walkNode(rootNode, (node) => {
			if (
				node.type === "export_statement" ||
				node.type === "export_declaration"
			) {
				const exp = this.extractExport(node, filePath);
				if (exp) {
					exports.push(exp);
				}
			}
		});

		return exports;
	}

	// ============ Private Helpers ============

	private walkNode(node: Node, callback: (node: Node) => void): void {
		callback(node);
		for (const child of node.namedChildren) {
			this.walkNode(child, callback);
		}
	}

	private extractSymbolDefinition(
		node: Node,
		filePath: string,
	): SymbolDefinition | null {
		// Skip arrow_function/function when parent is a variable_declarator.
		// The variable_declarator itself will be captured as a "variable" type,
		// preventing duplicate symbols for `const foo = () => {}` (H2 fix).
		if (
			(node.type === "arrow_function" || node.type === "function") &&
			node.parent?.type === "variable_declarator"
		) {
			return null;
		}

		const mapping: Record<string, SymbolDefinition["type"]> = {
			function_declaration: "function",
			function: "function",
			arrow_function: "function",
			method_definition: "method",
			class_declaration: "class",
			class: "class",
			variable_declarator: "variable",
			interface_declaration: "interface",
			type_alias_declaration: "type",
		};

		const type = mapping[node.type];
		if (!type) return null;

		const name = this.getNodeName(node);
		if (!name) return null;

		// Check if exported
		const isExported = this.isExported(node);

		return {
			name,
			type,
			file: filePath,
			line: node.startPosition.row,
			column: node.startPosition.column,
			endLine: node.endPosition.row,
			endColumn: node.endPosition.column,
			startIndex: node.startIndex,
			endIndex: node.endIndex,
			isExported,
		};
	}

	private getNodeName(node: Node): string | null {
		// Try to get name from child with field name "name"
		const nameNode = node.childForFieldName("name");
		if (nameNode) {
			return nameNode.text;
		}

		// For variable declarators, get the identifier
		if (node.type === "variable_declarator") {
			for (const child of node.namedChildren) {
				if (child.type === "identifier") {
					return child.text;
				}
			}
		}

		// For arrow functions assigned to variables
		if (node.type === "arrow_function" || node.type === "function") {
			// Check parent
			const parent = node.parent;
			if (parent?.type === "variable_declarator") {
				return this.getNodeName(parent);
			}
		}

		return null;
	}

	private isExported(node: Node): boolean {
		const parent = node.parent;
		if (!parent) return false;

		// Check if the direct parent is an export statement (handles function, class, interface)
		if (
			parent.type === "export_statement" ||
			parent.type === "export_declaration"
		) {
			return true;
		}

		// For const/let/var: parent chain is variable_declarator → variable_declaration/lexical_declaration → export_statement
		// Walk up to the grandparent to check for export
		if (
			node.type === "variable_declarator" &&
			(parent.type === "variable_declaration" ||
				parent.type === "lexical_declaration")
		) {
			const grandparent = parent.parent;
			return (
				grandparent?.type === "export_statement" ||
				grandparent?.type === "export_declaration"
			);
		}

		return false;
	}

	private extractCallSite(node: Node, filePath: string): CallSite | null {
		// Get the function being called
		const functionNode = node.namedChildren[0];
		if (!functionNode) return null;

		let calleeName: string | null = null;

		// Direct function call: foo()
		if (functionNode.type === "identifier") {
			calleeName = functionNode.text;
		}
		// Method call: obj.method()
		else if (functionNode.type === "member_expression") {
			const property = functionNode.childForFieldName("property");
			if (property) {
				calleeName = property.text;
			}
		}

		if (!calleeName) return null;

		// Find the enclosing function
		const enclosingFunction = this.findEnclosingFunction(node);

		return {
			callerSymbol: enclosingFunction || "module_scope",
			callerFile: filePath,
			calleeName,
			line: node.startPosition.row,
			column: node.startPosition.column,
		};
	}

	private findEnclosingFunction(node: Node): string | null {
		let current: Node | null = node;

		while (current) {
			if (
				current.type === "function_declaration" ||
				current.type === "function" ||
				current.type === "arrow_function" ||
				current.type === "method_definition"
			) {
				const name = this.getNodeName(current);
				if (name) return name;
			}
			current = current.parent;
		}

		return null;
	}

	private extractImport(node: Node, filePath: string): ImportStatement | null {
		const source = this.getImportSource(node);
		if (!source) return null;

		const symbols = this.getImportSymbols(node);

		return {
			source,
			symbols,
			filePath,
			line: node.startPosition.row,
		};
	}

	private getImportSource(node: Node): string | null {
		// Find the string literal for the import source
		// The string child is NOT field-named in the TypeScript grammar
		for (const child of node.namedChildren) {
			if (child.type === "string") {
				// Remove quotes — guard against empty strings
				if (child.text.length < 2) return null;
				return child.text.slice(1, -1);
			}
		}
		return null;
	}

	private getImportSymbols(node: Node): ImportStatement["symbols"] {
		const symbols: ImportStatement["symbols"] = [];

		// Find the import_clause child (TypeScript grammar doesn't use field names for imports)
		const importClause = node.namedChildren.find(
			(c) => c.type === "import_clause",
		);
		if (!importClause) return symbols;

		for (const child of importClause.namedChildren) {
			if (child.type === "namespace_import") {
				// import * as foo from 'bar' — or foo, * as bar from 'baz'
				const identifier = child.namedChildren[0];
				if (identifier) {
					symbols.push({
						name: identifier.text,
						isType: false,
					});
				}
			} else if (child.type === "named_imports") {
				// import { Foo, Bar as Baz } from 'qux'
				for (const spec of child.namedChildren) {
					if (spec.type === "import_specifier") {
						const name = spec.namedChildren.find(
							(c) => c.type === "identifier",
						);
						const alias = spec.namedChildren[1];
						if (name) {
							symbols.push({
								name: name.text,
								alias: alias?.type === "identifier" ? alias.text : undefined,
								isType: false,
							});
						}
					}
				}
			} else if (child.type === "identifier") {
				// import Default from 'bar'
				symbols.push({
					name: child.text,
					isType: false,
				});
			}
		}

		return symbols;
	}

	private extractExport(node: Node, filePath: string): ExportStatement | null {
		const symbols: ExportStatement["symbols"] = [];

		// Determine if this is a default export by checking for the 'default' keyword (M4 fix)
		const isDefaultExport = node.children?.some((c) => c.type === "default");

		// Handle declarations: export function foo() {}, export class Foo {}, export default class Foo {}
		const declaration = node.namedChildren[0];
		if (declaration && declaration.type !== "export_clause") {
			const name = this.getNodeName(declaration);
			if (name) {
				symbols.push({
					name,
					isDefault: isDefaultExport,
				});
			}
		}

		// Collect export specifiers, handling nested export_clause
		this.collectExportSpecifiers(node, symbols);

		if (symbols.length === 0) return null;

		return {
			symbols,
			filePath,
			line: node.startPosition.row,
		};
	}

	/**
	 * Recursively collect export specifiers from the node tree.
	 * Handles: export { foo, bar }, export { foo as bar }, and nested export_clause nodes.
	 */
	private collectExportSpecifiers(
		node: Node,
		symbols: ExportStatement["symbols"],
	): void {
		for (const child of node.namedChildren) {
			if (child.type === "export_specifier") {
				const nameNode = child.childForFieldName("name");
				if (nameNode) {
					symbols.push({
						name: nameNode.text,
						isDefault: false,
					});
				}
			} else if (child.type === "export_clause") {
				// recurse into export_clause to find export_specifiers
				this.collectExportSpecifiers(child, symbols);
			}
		}
	}
}
