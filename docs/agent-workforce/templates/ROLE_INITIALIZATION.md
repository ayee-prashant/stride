# Role initialization record

Template version: 1. Proposed until a designated human adopts it. Pair with the [role catalog](../ROLE_CATALOG.md) and [base prompt](roles/BASE.md).

## Human/server configuration before any agent execution

- Project and workspace: {{project_id}} / {{workspace_id}}
- Persistent profile UUID / display alias: {{profile_id}} / {{profile_alias}}
- Responsible human operator: {{operator_id}}
- Enrolled connection / capability evidence: {{connection_id}} / {{capability_references}}
- Exactly one active role: {{role_id}}
- Adopted base and role-template version/hash: {{base_template_ref}} / {{role_template_ref}}
- Role/project grant and current policy epoch: {{grant_reference}} / {{policy_epoch}}
- Human outcome owner / output reviewer: {{owner_id}} / {{reviewer_id}}
- Required independence and declared shared identities: {{independence_policy}}
- Work-item, packet and context-manifest revisions: {{work_revision}} / {{packet_ref}} / {{context_manifest_ref}}
- Accepted requirement and decision references: {{accepted_inputs}}
- Exact repository/base or candidate and environment, if applicable: {{target_identity}}
- Read paths/resources: {{read_allowlist}}
- Write paths/artifact classes: {{write_allowlist}}
- Allowed commands, network targets, test data and reset operations: {{execution_allowlist}}
- Runtime, cost, output and retry limits: {{limits}}
- Manual assignment decision: {{assignment_decision_ref}}
- Operator start authorization: server attaches a validated reference after human review; never an agent-written approval.

No unresolved required value is permitted at claim. Fields genuinely not applicable must say why under the selected role policy. A local role file is not evidence that the human approved access.

## Trusted preparation before launch

The approved adapter checks identity, source availability, target checkout/candidate and packet completeness within its own narrowly authorized preparation capabilities. It must not run project scripts, start an LLM or alter a worktree simply to obtain acknowledgement. Existing local changes are preserved; unsafe or conflicting preparation becomes a visible blocker.

## Agent's first authorized response

State this before substantive work:

- My active role is {{role}} for {{ticket/work item}}.
- My objective is {{bounded outcome}}.
- I am responsible for {{role responsibilities within this packet}}.
- Outside my role: {{explicit exclusions, including who owns each excluded action}}.
- My accepted inputs are {{exact requirement/decision/source versions}}.
- I may read {{scope}}, write {{scope}} and execute {{scope}} on {{target}}.
- I will produce {{deliverables and evidence}} for {{human reviewer}}.
- Missing, stale or conflicting inputs: {{none or precise blockers}}.
- Readiness: ready within this authorized attempt, or blocked with a decision request.

This statement is an attributed declaration. It is not proof of comprehension, a permission grant, a human decision or permission to infer missing facts. The server and adapter enforce actual constraints.

## Reinitialize when

Profile, connection authority, role, material scope/context, target candidate or policy changes; the attempt loses its lease; or a fresh machine needs a replacement attempt. Use a published checkpoint and new validation/authorization where required. Do not carry an old start grant into a new role or attempt.
