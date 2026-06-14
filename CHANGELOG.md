# Changelog

## [0.2.0] — 2026-06-14

### Added
- **Diff-based impact analysis** — `analyzeDiff()` parses unified git diffs to find affected symbols and their callers. Supports `"staged"` / `"unstaged"` mode (auto-runs `git diff`). Raw diff strings accepted as target.
- **TSX support** — Parser loads both `tree-sitter-typescript.wasm` and `tree-sitter-tsx.wasm`. Auto-detects file language by extension (`.ts` → TypeScript, `.tsx` → TSX, `.js`/`.jsx` → TSX).
- **Auto-indexing** — `scanProject()` and `buildGraphFromProject()` recursively scan directories for `.ts`, `.tsx`, `.js`, `.jsx` files. `impactAnalyzeHandler` auto-indexes from CWD when graph is empty.
- **Windows path normalization** — `SymbolResolver` now uses Node.js `path` module instead of custom `PathUtils` for correct Windows path handling.
- **Test suite** — 52 Jest tests across 5 suites (extractor, graph-builder, impact-analyzer, impact-analyzer-diff, integration).

### Fixed
- **WASM stub replacement** — `wasm/tree-sitter.wasm` and `wasm/tree-sitter-typescript.wasm` were 9-byte "Not Found" stubs. Replaced with real tree-sitter v0.22.6 WASM binaries.
- **`input.type` dispatch** — Handler now correctly routes `"file"` type to `analyzeFile()` instead of always calling `analyzeSymbol()`.
- **Import edge direction** — Edges were inverted (export→import). Now correctly `import→export`.
- **Duplicate symbol nodes** — `const foo = () => {}` no longer creates duplicate nodes (arrow_function inside variable_declarator skipped).
- **`pi.registerTool` signature** — Changed from function-passing to object format `{name, description, parameters, handler}`.
- **`Parser.Language` loading** — Removed `locateFile` (unnecessary in Node.js). Language WASM loaded as `Uint8Array` from local `wasm/` directory.
- **Conflicting type declarations** — Removed custom `web-tree-sitter.d.ts` that conflicted with official types from npm package.
- **`export const` detection** — `isExported()` now checks `lexical_declaration` grandparent chain.
- **`import { Foo, Bar }` extraction** — Traverses `named_imports` wrapper correctly.
- **`calculateMaxDepth`** — Changed from exponential recursion to memoized DFS with cycle detection.
- **BFS queue performance** — Replaced `queue.shift()` (O(n²)) with index pointer (O(1)).
- **50-line caller heuristic** — Replaced with AST `endLine` bounds for accurate caller containment.
- **`isDefault` export** — Now correctly checks the `default` keyword in export statements.
- **`parse()` null safety** — Added null guard on `parser.parse()` return.
- **`console.log`** — Replaced with structured `setLogger()` pattern.
- **Peer dependencies** — Changed `*` version range to `>=0.4.0`.

### Removed
- `extensions/types/web-tree-sitter.d.ts` — Conflicting with official `web-tree-sitter` type declarations.

## [0.1.2] — 2026-06-13

### Added
- Core call graph engine (tree-sitter WASM parsing, AST extraction)
- Symbol resolver with import resolution
- Impact analysis with BFS reverse-dependency traversal
- Risk scoring (fan-in, depth, PageRank centrality)
- Orphan detection
- Pi extension tool registration
- Table, Markdown, and JSON output formats
