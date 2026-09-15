# Cross-machine handoff template

Status: proposed structured checkpoint. Share facts and evidence, not a private conversation dump.

- Ticket / work item / attempt / profile / human operator:
- Project snapshot / packet / material binding versions:
- Requirement and acceptance-criterion revisions:
- Approved objective and remaining scope:
- Repository identity / exact base and current commit / PR or private patch:
- Publication status: available remotely, or unshared local work:
- Work demonstrated, linked to evidence:
- Tests actually run: command, environment/lockfile revision, outcome and report:
- Checks not run or still failing:
- Changed interfaces and affected dependent work:
- Accepted decisions relevant to continuing:
- Assumptions or hypotheses requiring validation:
- Known conflicts, security concerns and blockers:
- Minimum relevant files/artifacts and how to access them:
- Active role, adopted template versions and explicit outside-role boundaries:
- Delivery stage, current candidate/artifact and verified target environment:
- Findings with criterion IDs, expected/observed behavior and human disposition:
- Agent recommendation separate from human report acceptance and gate outcome:
- Human decisions, exact revisions and known stale/superseded evidence:
- Recommended next action and receiving role, explicitly unassigned and unauthorized:
- Operator decision required before a new attempt:

The receiving agent validates current context before using this checkpoint. Failed tests stay failed until new evidence replaces them. No secret values, full terminal logs, raw chat history or unselected untracked files belong here. Missing unpublished work must be reported as unavailable, never reconstructed as fact.

Use the [submission contract](../PROMPT_HANDOFFS.md). A receiving packet is generated from reviewed facts and accepted scope, not blindly copied upstream instructions. Humans accept new scope and select profiles; the receiving operator authorizes the new attempt. QA/UAT failure cannot become approval through a handoff.
