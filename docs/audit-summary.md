# pi-impact-analyzer — Audit & Fix Summary

## Completed Work

### Phase 1: 5 Parallel Subagent Audits
- Null safety, logical flow, functional correctness, pi integration, code quality
- All major bugs identified and fixed by subagents

### Phase 2: Manual Fixes & Verification
- Removed conflicting `web-tree-sitter.d.ts` (official types used now)
- Fixed import types to match official tree-sitter API
- Simplified WASM path resolution (works in both built and ts-jest modes)
- Verified end-to-end: parser init, graph building, impact analysis
- Cleaned up unused `_knownSymbols` parameter
- Updated peer deps from `*` to `>=0.4.0`

### Phase 3: Test Suite (44 tests, all passing)
| Test File | Tests | Coverage |
|-----------|-------|----------|
| `tests/extractor.test.ts` | 24 | Symbol extraction, deduplication, call sites, imports, exports |
| `tests/graph-builder.test.ts` | 8 | Build, addFile, edges, fan-in/fan-out, graph reset |
| `tests/impact-analyzer.test.ts` | 9 | Symbol/file analysis, BFS depth, orphans, riskiest symbols |
| `tests/index.test.ts` | 3 | End-to-end import resolution, cross-file analysis |
| **Total** | **44** | **All passing** |

### Build Verification
- TypeScript strict mode: 0 errors
- `tsc` builds dist/ with declarations + sourcemaps
- `npm test` runs all 44 tests

## Files Changed
```
extensions/parser.ts          — Simplified WASM loading, removed dead code
extensions/extractor.ts       — Removed unused _knownSymbols param
extensions/types/web-tree-sitter.d.ts — DELETED (conflicted with official types)
package.json                  — Added jest deps, test script, updated peer deps
jest.config.js                — Created with ts-jest preset
tests/extractor.test.ts       — New: 24 tests
tests/graph-builder.test.ts   — New: 8 tests
tests/impact-analyzer.test.ts — New: 9 tests
tests/index.test.ts           — New: 3 integration tests
```

## Remaining Gaps
- Auto-indexing (filesystem scanning) — not yet implemented for Pi integration
- Windows path normalization in SymbolResolver.PathUtils — low priority
- No diff-based impact analysis yet (throws explicit error)
- `tree-sitter-tsx.wasm` present but unused
