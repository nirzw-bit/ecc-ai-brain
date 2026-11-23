# ECC OrBIt — ChatGPT / VS Code Handoff

## Purpose
Coordinate work between ChatGPT and VS Code / GitHub Codespaces using this repository as the shared, version-controlled project record.

## Source-of-truth rules
1. The current Git branch and committed files are the evidence for repository state.
2. ChatGPT discussions are proposals and analysis until decisions or changes are committed here.
3. VS Code edits are not shared with ChatGPT until committed and pushed.
4. Never treat an uncommitted workspace change as available to another environment.
5. Record consequential decisions and verified test outcomes in repository files.

## Handoff template
For each task, record:

- Date (UTC):
- Task / objective:
- Starting branch and commit:
- Evidence inspected:
- Files changed:
- Decisions and rationale:
- Commands / tests run:
- Results: PASS / FAIL / BLOCKED / NOT RUN
- Remaining risks or blockers:
- Next action:
- Approval required before:

## Collaboration cycle
1. ChatGPT researches, plans, reviews evidence, and drafts a bounded implementation handoff.
2. The developer opens the same repository in Codespaces and reviews the proposed changes.
3. Implement on a feature branch; inspect the diff before committing.
4. Run relevant tests and record actual results.
5. Push the branch so ChatGPT can inspect the committed state.
6. Use a pull request for review before merging changes into the default branch.
7. Production, database, secrets, billing, and deployment actions remain separately gated.

## Important limitation
GitHub synchronization shares committed files and history. It does not automatically synchronize live ChatGPT conversation memory, VS Code chat history, local uncommitted edits, or backend database memory.
