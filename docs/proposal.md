# pi-impact-analyzer — Proposal

## Problem Statement

When an AI agent modifies a function or class, it often lacks visibility into the full blast radius of that change. The agent may:

- Modify a function signature without updating all call sites
- Break downstream dependencies in files it hasn't read
- Introduce regressions in unrelated modules
- Miss test files that need updating

This leads to "silent breakage" — changes that compile but cause runtime failures in distant parts of the codebase.

## Solution

`pi-impact-analyzer` provides AST-based dependency tracing that answers: **"If I change this symbol, what else could break?"**

The tool builds a call graph from the entire project using tree-sitter, then performs reverse-dependency traversal to identify all affected files and functions.

## Key Features

### 1. Symbol Impact Analysis

Given a symbol name (function, class, method), return:
- All direct callers across the project
- All transitive callers (callers of callers)
- Risk score based on dependency depth and fan-in

### 2. File Impact Analysis

Given a file path, return:
- All files that import from this file
- All transitive dependents
- Affected test files

### 3. Diff Impact Analysis

Given a git diff (staged or unstaged), return:
- Which symbols were modified
- The combined blast radius of all changes
- Recommended test files to run

### 4. Risk Scoring

Assign risk scores to symbols based on:
- **Fan-in**: Number of direct callers (higher = riskier)
- **Depth**: Transitive dependency depth (deeper = more cascade risk)
- ** centrality**: PageRank-style importance in the call graph

## Technical Architecture

### Core Components

```
pi-impact-analyzer/
├── extensions/
│   ├── index.ts           # Main entry point, tool registration
│   ├── graph-builder.ts   # AST parsing, call graph construction
│   ├── symbol-resolver.ts # Import/export resolution, symbol lookup
│   ├── impact-analyzer.ts # BFS traversal, risk scoring
│   └── types/
│       └── index.ts       # Type definitions
└── wasm/
    ├── tree-sitter.wasm
    └── tree-sitter-typescript.wasm
```

### Data Flow

```
1. Index Phase (on demand or startup)
   ├── Parse all .ts/.js files with tree-sitter
   ├── Extract: function defs, class defs, method defs
   ├── Extract: call sites, import statements, export statements
   ├── Resolve imports to actual file paths
   └── Build adjacency graph (caller → callee edges)

2. Query Phase (on tool invocation)
   ├── Accept symbol name or file path
   ├── Perform BFS/DFS reverse traversal
   ├── Calculate risk scores
   └── Return structured impact report
```

### Import Resolution Strategy

Following the approach from `codegraph`:

1. **Import-aware** (confidence: 1.0): Explicit imports with path
   - `import { foo } from './bar'` → resolves to `bar.ts`

2. **Same-file** (confidence: 1.0): Definitions in the current file

3. **Path alias resolution**: Read `tsconfig.json` paths
   - `@utils/foo` → `src/utils/foo.ts`

4. **Index file resolution**: Follow directory index files
   - `import { foo } from './utils'` → `./utils/index.ts`

5. **Name-based fallback** (confidence: 0.5): Match by symbol name across codebase

### Risk Scoring Algorithm

Based on `impact-graph`'s approach:

```
risk_score = (fan_in × 10) + (depth × 5) + (pagerank × 100)
```

Where:
- `fan_in`: Direct caller count
- `depth`: Maximum transitive depth
- `pagerank`: Iterative PageRank value (85% damping, 50 iterations)

## Tool API

### `impact_analyze`

```typescript
{
  tool: "impact_analyze",
  input: {
    type: "symbol" | "file" | "diff",
    target: string,           // symbol name, file path, or "staged"/"unstaged"
    options?: {
      maxDepth?: number,      // default: 10
      includeTests?: boolean, // default: true
      format?: "table" | "json" | "markdown"
    }
  }
}
```

### Response Format

```typescript
{
  target: string,
  type: "symbol" | "file" | "diff",
  summary: {
    totalAffected: number,
    directDependents: number,
    transitiveDependents: number,
    testFiles: number,
    riskScore: number
  },
  affected: Array<{
    symbol: string,
    file: string,
    line: number,
    depth: number,
    riskScore: number,
    type: "function" | "class" | "method" | "file"
  }>,
  recommendations: string[]
}
```

## Performance Targets

Based on benchmarks from similar tools:

| Metric | Target | Notes |
|--------|--------|-------|
| Index time (1000 files) | < 5 seconds | Incremental re-indexing |
| Query time | < 100ms | BFS on in-memory graph |
| Memory usage | < 100MB | For 10K symbols |
| Accuracy | > 95% | For import-resolved calls |

## Language Support

### Initial Release (v0.1.0)

- TypeScript (.ts, .tsx)
- JavaScript (.js, .jsx, .mjs, .cjs)

### Future Expansion

- Python (.py)
- Go (.go)
- Rust (.rs)

## Integration with Pi Ecosystem

### Tool Registration

```typescript
// In index.ts
export function register(context: PiContext) {
  context.registerTool("impact_analyze", impactAnalyzeHandler);
}
```

### Usage in Agent Workflow

```markdown
Before modifying a function:
1. Call `impact_analyze` with the function name
2. Review the affected files and risk score
3. If high risk, read affected files first
4. Make the change
5. Call `impact_analyze --diff` to verify scope
```

## Competitive Advantages

| Feature | pi-impact-analyzer | impact-graph | blast-radius | codegraph |
|---------|-------------------|--------------|--------------|-----------|
| Pi-native tool | Yes | No | No | No |
| WASM-based | Yes | No | No | No |
| Incremental indexing | Planned | No | Yes | Yes |
| Risk scoring | Yes | Yes (PageRank) | No | No |
| Diff analysis | Yes | Yes | Yes | Yes |
| TypeScript support | Yes | Yes | No | Yes |
| Zero dependencies | Yes | No | No | No |

## Implementation Plan

### Phase 1: Core Engine (v0.1.0)

- [ ] Tree-sitter WASM integration
- [ ] AST extraction for function/class/method definitions
- [ ] Call site extraction
- [ ] Import statement extraction
- [ ] Basic call graph construction

### Phase 2: Resolution (v0.1.0)

- [ ] Import path resolution (relative, absolute, aliases)
- [ ] Index file resolution
- [ ] Cross-file symbol linking

### Phase 3: Analysis (v0.1.0)

- [ ] BFS reverse-dependency traversal
- [ ] Risk score calculation
- [ ] Tool API implementation

### Phase 4: Enhancement (v0.2.0)

- [ ] Incremental indexing
- [ ] PageRank scoring
- [ ] Diff impact analysis
- [ ] Git integration

## Success Criteria

1. **Accuracy**: Correctly identifies >95% of direct callers
2. **Performance**: Indexes 1000-file project in <5 seconds
3. **Usability**: Agent can invoke with single tool call
4. **Reliability**: No false negatives for import-resolved calls
