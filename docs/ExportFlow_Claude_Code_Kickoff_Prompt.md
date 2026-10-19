# ExportFlow --- Claude Code Kickoff Prompt

You are helping build ExportFlow, a mobile-first PWA and future
management-intelligence assistant.

## Read first

Read `CLAUDE.md`, then:

-   `ExportFlow_Complete_Requirements_Bilingual_v1_9.docx` (business
    reference; Section 78 = v1.9 decisions)
-   `ExportFlow_Requirements_English_v1_9.docx` (Section 31)
-   `ExportFlow_Technical_Architecture_Development_Plan_v1_3.docx` and
    its English edition (Section 16 = the only phase plan)

If the documents are not accessible, stop and ask for them. Do not guess
their contents. If no code repository exists yet, say so plainly and do
not pretend an audit of existing code took place; instead deliver the
Phase 1 (Foundation) design from Section 16 for approval.

## Task 1: Read-only repository audit

Do not edit code, install dependencies, create cloud resources, change
Firebase settings, or deploy anything yet.

Inspect the repository and report: 1. Framework, language, package
manager and project structure. 2. Existing features and routes/pages. 3.
Existing Firebase/auth/database/storage/cloud-functions setup, if any
(never reveal secrets). 4. Offline/PWA behavior and limitations. 5.
Existing tests, lint, type-check and build commands. 6.
Deployment/environment setup (do not expose secrets). 7. Risks,
technical debt, missing tests and possible regressions. 8. Whether the
recommended architecture fits or needs a justified adjustment. 9.
Proposed data model outline for orders, products/recipes/workflows,
inventory, procurement, production, quality, daily actions, risks,
approvals, communications and audit history. 10. Phase-by-phase
implementation backlog with dependencies, acceptance criteria, test
strategy and approval gates. 11. Decisions requiring Kareem's approval
or real company data.

## Output

-   Executive summary in simple language.
-   Current-state inventory.
-   Risks and unknowns.
-   Recommended architecture with reasons and trade-offs.
-   Phase-by-phase plan.
-   Questions/decisions requiring approval.
-   Exact recommended next step.

## Rules

-   Do not build the whole app at once.
-   Do not invent company data, production stages, BOMs, benchmarks,
    supplier lead times or communication channels.
-   Do not silently replace the current stack.
-   Do not reuse credentials or a Firebase project from another app.
-   Keep deterministic business rules/calculations separate from AI
    suggestions.
-   Do not claim tests passed unless they were actually run.
-   Wait for user approval before implementing Phase 1.
