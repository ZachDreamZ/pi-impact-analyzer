# pi-impact-analyzer

**If I change this symbol, what else could break?**

[![Pi Package](https://img.shields.io/badge/Pi-Package-blue)](https://pi.dev/packages)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/pi-impact-analyzer.svg)](https://www.npmjs.com/package/pi-impact-analyzer)

## 🚀 What's New in v0.3.0

**Passive mode** — No configuration required! The extension now works out-of-the-box:

- ✅ **Auto-indexes** your project on session start
- ✅ **Indexes files** when Pi reads them
- ✅ **Caches graph** to disk for faster startup
- ✅ **Auto-analyzes** when you mention code changes
- ✅ **Integrates** with pi-smart-reader for optimized workflows

## Problem Statement

When an AI agent modifies a function or class, it often lacks visibility into the full blast radius of that change. This leads to:

- **Silent Breakage**: Changes that compile but cause runtime failures in distant parts of the codebase
- **Missed Call Sites**: Modifying a function signature without updating all callers
- **Test Gaps**: Not knowing which test files need updating after a change
- **Cascade Failures**: A single change triggering a chain of regressions

## Solution

`pi-impact-analyzer` provides AST-based dependency tracing that answers: **"If I change this symbol, what else could break?"**

The tool builds a call graph from the entire project using tree-sitter, then performs reverse-dependency traversal to identify all affected files and functions.

## Key Features

### 🔍 Symbol Impact Analysis

Given a symbol name (function, class, method), return:
- All direct callers across the project
- All transitive callers (callers of callers)
- Risk score based on dependency depth and fan-in

### 📁 File Impact Analysis

Given a file path, return:
- All files that import from this file
- All transitive dependents
- Affected test files

### 📝 Diff Impact Analysis

Given a git diff (staged, unstaged, or raw content), return:
- Which symbols were modified (based on changed line ranges)
- The combined blast radius of all changes
- Affected test files and recommended test suites

### ⚡ Passive Mode (v0.3.0+)

**No configuration required!** The extension automatically:

- **Auto-indexes** your project on session start
- **Indexes files** when Pi reads them
- **Caches graph** to disk for faster startup
- **Auto-analyzes** when you mention code changes
- **Emits events** for integration with other tools

### 📊 Risk Scoring

Assigns risk scores to symbols based on:
- **Fan-in**: Number of direct callers (higher = riskier)
- **Depth**: Transitive dependency depth (deeper = more cascade risk)
- **Centrality**: PageRank-style importance in the call graph

### 🎯 Orphan Detection

Find symbols that are defined but never called, indicating dead code.

### 🌐 Language Support

- TypeScript (`.ts`)
- TypeScript with JSX (`.tsx` — React, JSX elements, generics)
- JavaScript (`.js`, `.jsx`, `.mjs`, `.cjs`)

## Installation

```bash
pi install npm:pi-impact-analyzer
```

## Usage Guide

### Passive Mode (Recommended)

**Just install and use!** The extension automatically:

1. **Indexes your project** when Pi starts
2. **Indexes files** as Pi reads them
3. **Analyzes impact** when you mention code changes
4. **Provides recommendations** for affected files

No commands needed — it just works!

### Active Tool

For explicit analysis, use the `impact_analyze` tool:

#### Before modifying a function

```json
{
  "tool": "impact_analyze",
  "input": {
    "type": "symbol",
    "target": "processPayment",
    "options": { "maxDepth": 5, "format": "table" }
  }
}
```

**Result**: A table showing all affected symbols, their files, depth, and risk scores.

#### After making changes

Check the impact of your diff before committing:

```json
{
  "tool": "impact_analyze",
  "input": {
    "type": "diff",
    "target": "unstaged",
    "options": { "format": "markdown" }
  }
}
```

### Output Formats

**Table format** (human-readable):
```
Impact Analysis for: processPayment
==================================================

Summary:
  Total affected: 12
  Direct dependents: 4
  Transitive dependents: 8
  Test files: 3
  Risk score: 85.42

Affected Symbols:
--------------------------------------------------
  handleCheckout                    checkout.ts      depth:1 risk:85.4
  processOrder                      orders.ts        depth:2 risk:62.1
  sendConfirmationEmail             notifications.ts depth:3 risk:43.2
```

**Markdown format** (for documentation):
```markdown
## Impact Analysis: `processPayment`

### Summary
| Metric | Value |
|--------|-------|
| Total affected | 12 |
| Direct dependents | 4 |
| Risk score | 85.42 |
```

**JSON format** (for programmatic use):
```json
{
  "target": "processPayment",
  "type": "symbol",
  "summary": {
    "totalAffected": 12,
    "directDependents": 4,
    "transitiveDependents": 8,
    "testFiles": 3,
    "riskScore": 85.42
  },
  "affected": [...],
  "recommendations": [...]
}
```

## Performance

| Metric | Value |
|--------|-------|
| Graph Build | 1ms/file |
| Incremental Index | 21ms |
| Impact Analysis | 0.01ms/symbol |
| Throughput | 1988 files/second |
| Hash Performance | 0.0166ms/hash |

## Programmatic API

For use outside the Pi tool system, import the library directly:

```typescript
import { 
  TreeSitterParser, 
  GraphBuilder, 
  ImpactAnalyzer,
  autoIndex,
  indexFile,
  getIndexingStatus
} from "pi-impact-analyzer";

// Initialize parser
const parser = new TreeSitterParser();
await parser.initialize();

// Build graph from project
const builder = new GraphBuilder(parser);
const files = scanProject("./src");
builder.build(files.map(p => ({ path: p, content: fs.readFileSync(p, "utf-8") })));

// Analyze impact
const analyzer = new ImpactAnalyzer(builder.getGraph());
const result = analyzer.analyzeSymbol("myFunction");
console.log(result.summary);

// Passive mode functions
await autoIndex(); // Auto-index current directory
await indexFile("path/to/file.ts", content); // Index single file
const status = getIndexingStatus(); // Get indexing status
```

## Configuration

The extension works with sensible defaults. To customize:

```typescript
import { updateConfig, getConfig } from "pi-impact-analyzer";

// Update configuration
updateConfig({
  autoIndex: true,
  cacheEnabled: true,
  cacheTTL: 300000, // 5 minutes
  debug: false,
});

// Get current config
console.log(getConfig());
```

## Integration with pi-smart-reader

`pi-impact-analyzer` emits `impact_detected` events that `pi-smart-reader` listens to. When impact analysis is performed:

1. `pi-impact-analyzer` analyzes the symbol/file
2. Emits `impact_detected` event with affected files
3. `pi-smart-reader` pre-generates skeletons for affected files
4. Context is optimized for faster access

This integration happens automatically — no configuration needed!

## Technical Architecture

- **Engine**: Powered by `tree-sitter` (WASM) for high-performance, language-aware parsing
- **Graph Construction**: Builds a complete call graph with import resolution
- **Traversal**: BFS reverse-dependency traversal for impact analysis
- **Risk Scoring**: Combines fan-in, depth, and PageRank centrality
- **Auto-Indexing**: Recursive filesystem scanner respecting common ignore patterns
- **Caching**: Disk-based graph caching with file hash tracking

## Compatibility

- **Languages**: TypeScript (.ts), TypeScript+JSX (.tsx), JavaScript (.js, .jsx, .mjs, .cjs)
- **Platforms**: Node.js 18+ (runs as a Pi extension)
- **Pi**: Built for the [Pi coding agent](https://pi.dev/) ecosystem

## Contributing

Contributions are welcome. We are seeking support for:
- Additional language bindings (Python, Go, Rust)
- Incremental graph updates for real-time analysis
- Performance benchmarks at 10K+ files

Please follow the standard Pull Request process: Fork, Branch, Commit, and PR.

## License

Distributed under the MIT License. See the [LICENSE](LICENSE) file for more information.

## Acknowledgments

- [Pi](https://pi.dev/) — The AI coding agent
- [tree-sitter](https://tree-sitter.github.io/) — Parser generator toolkit
- [impact-graph](https://github.com/phoenix-assistant/impact-graph) — Inspiration for risk scoring
- [codegraph](https://github.com/compass-soul/codegraph) — Inspiration for import resolution
