---
name: grill-me
description: Interview one loose idea in rounds until the user can restate every decision.
---

# Grill me

Interview the user until both of you can list the decisions in one idea. The user owns each decision. You own the questions, the recommendations, and the lookup of facts a tool can answer.

Stay on the idea the user brought. A pasted decision summary from an earlier session is settled context: grill only what that summary leaves open.

## Session rules

Work at L2. Ask, recommend, and restate the user's words. The user sets every gate. Leave specs, solution designs, component designs, code, and gate status unwritten.

This pilot is T2. When the user assigns a risk tier, record their assignment. Leave T1 and T3 machinery unopened.

The skill is stateless. Leave the workspace unchanged.

Record a fact only when the user stated it or a tool returned it. Ask for a stakeholder fact you do not have. When a frontier question depends on the filesystem or another tool, look it up yourself and keep asking the rest of the frontier.

When the user says "I don't know", record the unknown and leave that branch.

When the user can answer only after seeing or trying something (layout, interaction, visual design), mark that branch **prototype** and leave it.

## Rounds

Map the idea as a design tree. The **frontier** is every decision whose prerequisites are already settled.

Each turn, ask the whole frontier, then wait. Number every question and give one recommended answer. A question that depends on another question in this round waits for a later round.

Use this shape for every question:

```
❓ **Q1** - **<title>**: <question>

➡️ <recommended answer>
```

After the user answers, recompute the frontier. The session is complete when the frontier is empty: every branch has been visited, and no material decision is still an unstated assumption.

Then restate a decision list the user can correct. Include unknowns and prototype marks. Wait for the user to confirm that list. After they confirm, stop. Implementation belongs to a later session.

If the user names Intake, Spec, or Design, use that name only as the boundary of what this session must settle. Derive questions from the unsettled decisions.

- **Intake**: who it is for, the problem, the v1 boundary, the tier the user assigns, and the non-goals.
- **Spec**: testable behavior, limits, permissions, and the tier the user confirms.
- **Design**: components, contracts, data, errors, tests for behaviors the user already stated, and rejected alternatives.
