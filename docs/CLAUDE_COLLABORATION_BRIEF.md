# Claude collaboration brief

## Requested roles

- Claude Opus 5.5, High reasoning: independently review the current implementation and confer with Codex on the next development plan. Initial consultation is read-only.
- Claude Sonnet 5.5, High or Medium reasoning: assist with implementation after the plan is reviewed, using disjoint file ownership. Use High for numerical/model work and Medium for bounded interface or documentation work. Verify the actual returned model identity; do not silently substitute models.

## Proposed consultation material

Share this brief, AGENTS.md, docs/CODEX_NEXT_TASK.md, docs/CLAUDE_REVIEW_BRIEF.md, docs/MODEL_SPEC.md, docs/TEACHING_GUIDE.md, relevant source files, tests, browser results and the current source-code diff with Anthropic through the installed Claude Code client. Exclude credentials, account settings, environment variables, unrelated local files and patient data. The initial consultant may inspect source through Read/Glob/Grep but may not edit files, execute shell commands, commit, push, deploy, or contact anyone.

## Current local increment

The interface now displays ARDS Sim without the edition label and follows VA_coupling_sim colors, typography, monitor panels and light/dark mode. Lessons include objectives, prediction and reflection prompts. Comparison text identifies setting and outcome changes, explains model mechanisms and tradeoffs, and flags multiple-control changes. Guided adjustments restore baseline controls before applying a one-variable change. Twelve numerical checks, five teaching tests, and browser checks pass. A supervised learner session has not occurred. Expanded physiology has not been implemented.

## Questions for Opus

1. Identify confirmed learner/comparison defects separately from uncertainties, with file/function evidence and meaningful verification.
2. Critique the next increment: record actual computed last-breath regional trajectories; animate and inspect inspiration/expiration with pause, phase controls and reduced-motion support. Label the quasi-static visualization separately from a resisted dynamic solve. Clarify instantaneous expiratory pressure reduction, trajectory times, pressure-limited delivery, summary metric semantics and worker races.
3. Propose acceptance criteria for later regional resistance, filling/emptying, an explicitly defined emptying ratio, and respiratory RC time constants. Include analytic reference, mass balance, timestep refinement, pressure limits and heterogeneous/chest-wall coupling checks.
4. Plan a developed adult cardiovascular-engine evaluation before coupling respiratory pressures or showing heart-rate predictions. Separate surrounding, intravascular and transmural pressures and document one-way/two-way coupling.
5. Recommend the next coding increment and disjoint file assignments for Sonnet collaborators.

## Integration

Codex critically evaluates findings, records accepted/rejected recommendations and rationale, integrates changes, and runs the repository checks. Numerical checks are not clinical validation. No external publication or deployment is included in this consultation request.

## Status

The user explicitly authorized transmission, integration/merging and commits on 2026-10-05. Opus 5.5 / High completed the read-only source review and a planning follow-up; Sonnet 5.5 / High and Medium completed disjoint coding assignments. Codex critically assessed, revised and verified their changes. See DEVELOPMENT_PLAN.md and CLAUDE_REVIEW_DECISIONS.md; raw model identity/usage/effort records and reports are in benchmarks/results-claude-consultation.json. The review is not validation of expanded physiology, which remains unimplemented.
