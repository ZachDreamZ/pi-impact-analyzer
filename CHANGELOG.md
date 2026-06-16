# Changelog

## [0.3.0] — 2026-06-16

### Added
- **Passive mode** — Always-on operation with no configuration required. Extension works out-of-the-box.
- **Auto-indexing on session start** — Automatically builds graph when Pi session begins.
- **File indexing on read** — Indexes files when Pi reads them, keeping graph up-to-date.
- **Graph caching** — Saves/loads graph from disk (`~/.pi/impact-analyzer/`) for faster startup.
- **File hash tracking** — MD5 hashing prevents re-indexing unchanged files.
- **Incremental indexing** — `addFile()` for single-file updates without full rebuild.
- **Impact detection events** — Emits `impact_detected` event for integration with other tools.
- **Auto-analysis on code changes** — Detects when user mentions modifying symbols and provides impact analysis.
- **Session lifecycle hooks** — Auto-index on start, save cache on shutdown.
- **Configuration API** — `updateConfig()`, `getConfig()`, `clearCache()` for programmatic control.
- **Indexing status** — `getIndexingStatus()` returns current state.

### Changed
- **Default threshold** — Lowered from 500 to 300 lines for better optimization.
- **Cache TTL** — Set to 5 minutes (300,000ms) for fresh graphs.
- **Error handling** — Returns empty results instead of throwing when graph not built.
- **Performance** — Graph build: 1ms/file, Analysis: 0.01ms/symbol, 1988 files/second throughput.

### Fixed
- **Duplicate path property** — Fixed serialization issue in cache saving.
- **Unused imports** — Removed unused type imports.
- **Event handler types** — Added underscore prefix for unused parameters.

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
