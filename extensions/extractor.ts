import type { Node } from "web-tree-sitter";
import type {
	SymbolDefinition,
	CallSite,
	ImportStatement,
	ExportStatement,
} from "./types";

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
	public extractCallSites(
		rootNode: Node,
		filePath: string,
		symbols: SymbolDefinition[],
	): CallSite[] {
		const callSites: CallSite[] = [];
		const symbolNames = new Set(symbols.map((s) => s.name));

		this.walkNode(rootNode, (node) => {
			if (node.type === "call_expression") {
				const callSite = this.extractCallSite(node, filePath, symbolNames);
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
			startIndex: node.startIndex,
			endIndex: node.endIndex,
			isExported,
		};
	}

	private getNodeName(node: Node): string | null {
		// Try to get name from child with field name "name"
		const nameNode = node.childByFieldName("name");
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

		return (
			parent.type === "export_statement" || parent.type === "export_declaration"
		);
	}

	private extractCallSite(
		node: Node,
		filePath: string,
		_knownSymbols: Set<string>,
	): CallSite | null {
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
			const property = functionNode.childByFieldName("property");
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
		for (const child of node.namedChildren) {
			if (child.type === "string") {
				// Remove quotes
				return child.text.slice(1, -1);
			}
		}
		return null;
	}

	private getImportSymbols(node: Node): ImportStatement["symbols"] {
		const symbols: ImportStatement["symbols"] = [];

		// import * as foo from 'bar'
		const namespaceImport = node.childByFieldName("namespace_import");
		if (namespaceImport) {
			const identifier = namespaceImport.namedChildren[0];
			if (identifier) {
				symbols.push({
					name: identifier.text,
					isType: false,
				});
			}
			return symbols;
		}

		// import { foo, bar as baz } from 'qux'
		const importClause = node.childByFieldName("import_clause");
		if (importClause) {
			this.extractImportIdentifiers(importClause, symbols, false);
		}

		// import foo from 'bar' (default import)
		const defaultImport = node.namedChildren[0];
		if (defaultImport?.type === "identifier") {
			symbols.push({
				name: defaultImport.text,
				isType: false,
			});
		}

		return symbols;
	}

	private extractImportIdentifiers(
		node: Node,
		symbols: ImportStatement["symbols"],
		isType: boolean,
	): void {
		for (const child of node.namedChildren) {
			if (child.type === "identifier") {
				symbols.push({
					name: child.text,
					isType,
				});
			} else if (child.type === "import_specifier") {
				const name = child.childByFieldName("name");
				const alias = child.childByFieldName("alias");
				if (name) {
					symbols.push({
						name: name.text,
						alias: alias?.text,
						isType,
					});
				}
			} else if (child.type === "import_clause") {
				this.extractImportIdentifiers(child, symbols, isType);
			}
		}
	}

	private extractExport(node: Node, filePath: string): ExportStatement | null {
		const symbols: ExportStatement["symbols"] = [];

		// export function foo() {}
		const declaration = node.namedChildren[0];
		if (declaration) {
			const name = this.getNodeName(declaration);
			if (name) {
				symbols.push({
					name,
					isDefault: false,
				});
			}
		}

		// export { foo, bar as baz }
		// export default function foo() {}
		for (const child of node.namedChildren) {
			if (child.type === "export_specifier") {
				const name = child.childByFieldName("name");
				if (name) {
					symbols.push({
						name: name.text,
						isDefault: false,
					});
				}
			}
		}

		if (symbols.length === 0) return null;

		return {
			symbols,
			filePath,
			line: node.startPosition.row,
		};
	}
}
