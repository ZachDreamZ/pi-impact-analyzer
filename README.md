# pi-impact-analyzer

**If I change this symbol, what else could break?**

[![Pi Package](https://img.shields.io/badge/Pi-Package-blue)](https://pi.dev/packages)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/pi-impact-analyzer.svg)](https://www.npmjs.com/package/pi-impact-analyzer)

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

### Symbol Impact Analysis

Given a symbol name (function, class, method), return:
- All direct callers across the project
- All transitive callers (callers of callers)
- Risk score based on dependency depth and fan-in

### File Impact Analysis

Given a file path, return:
- All files that import from this file
- All transitive dependents
- Affected test files

### Diff Impact Analysis

Given a git diff (staged, unstaged, or raw content), return:
- Which symbols were modified (based on changed line ranges)
- The combined blast radius of all changes
- Affected test files and recommended test suites

Supports `"staged"` (equivalent to `git diff --cached`) and `"unstaged"` (equivalent to `git diff`) modes for seamless integration into git workflows.

### Auto-Indexing

Automatically scans your project directory for `.ts`, `.tsx`, `.js`, and `.jsx` files when no graph has been built yet. Respects `node_modules/`, `dist/`, `.git/`, `build/`, and other common ignore directories.

### Risk Scoring

Assign risk scores to symbols based on:
- **Fan-in**: Number of direct callers (higher = riskier)
- **Depth**: Transitive dependency depth (deeper = more cascade risk)
- **Centrality**: PageRank-style importance in the call graph

### Orphan Detection

Find symbols that are defined but never called, indicating dead code.

### Language Support

- TypeScript (`.ts`)
- TypeScript with JSX (`.tsx` — React, JSX elements, generics)
- JavaScript (`.js`, `.jsx`, `.mjs`, `.cjs`)

## Installation

```bash
pi install npm:pi-impact-analyzer
```

## Usage Guide

The extension provides the `impact_analyze` tool.

### Scenario: Before modifying a function

**Step 1: Check impact**
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

**Step 2: Review affected files**
Based on the impact analysis, read the affected files before making changes.

**Step 3: Make changes with confidence**
After reviewing the blast radius, proceed with modifications knowing exactly what needs updating.

### Diff Analysis

After making changes, check the impact of your diff before committing:

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

Or analyze a specific diff string:

```json
{
  "tool": "impact_analyze",
  "input": {
    "type": "diff",
    "target": "@@ -5,6 +5,8 @@\n function greet(name: string) {\n-  return 'hello';\n+  return 'hello ' + name;\n }\n",
    "options": { "format": "json" }
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

## Programmatic API

For use outside the Pi tool system, import the library directly:

```typescript
import { TreeSitterParser, GraphBuilder, ImpactAnalyzer } from "pi-impact-analyzer";

// Initialize parser
const parser = new TreeSitterParser();
await parser.initialize();

// Build graph from project
const builder = new GraphBuilder(parser);
const files = scanProject("./src");  // returns file paths
builder.build(files.map(p => ({ path: p, content: fs.readFileSync(p, "utf-8") })));

// Analyze impact
const analyzer = new ImpactAnalyzer(builder.getGraph());
const result = analyzer.analyzeSymbol("myFunction");
console.log(result.summary);
```

## Technical Architecture

- **Engine**: Powered by `tree-sitter` (WASM) for high-performance, language-aware parsing
- **Graph Construction**: Builds a complete call graph with import resolution
- **Traversal**: BFS reverse-dependency traversal for impact analysis
- **Risk Scoring**: Combines fan-in, depth, and PageRank centrality
- **Auto-Indexing**: Recursive filesystem scanner respecting common ignore patterns

## Compatibility

- **Languages**: TypeScript (.ts), TypeScript+JSX (.tsx), JavaScript (.js, .jsx, .mjs, .cjs)
- **Platforms**: Node.js 18+ (runs as a Pi extension)
- **Pi**: Built for the [Pi coding agent](https://pi.dev/) ecosystem

## Contributing

Contributions are welcome. We are seeking support for:
- Additional language bindings (Python, Go, Rust)
- Incremental indexing for faster re-analysis
- Performance benchmarks at 10K+ files

Please follow the standard Pull Request process: Fork, Branch, Commit, and PR.

## License

Distributed under the MIT License. See the [LICENSE](LICENSE) file for more information.

## Acknowledgments

- [Pi](https://pi.dev/) — The AI coding agent
- [tree-sitter](https://tree-sitter.github.io/) — Parser generator toolkit
- [impact-graph](https://github.com/phoenix-assistant/impact-graph) — Inspiration for risk scoring
- [codegraph](https://github.com/compass-soul/codegraph) — Inspiration for import resolution
