# Shared project context

Status: proposed foundation, revised 2026-09-14. This addresses agents on different machines, private session memory and changes made directly through GitHub. It is required before coordinated execution, not a later search feature.

## Decision

Stride must maintain a versioned project context service. It assembles approved intent, verified repository facts and current work into a bounded packet for each contribution. The service is deterministic and does not require an LLM. A connected architect or an optional model can propose improvements, summaries and missing work; a model cannot publish its own interpretation as accepted project truth.

An agent's local conversation is disposable working context. The project must remain understandable and executable if that conversation, laptop or provider disappears. Preserve decisions, source references, acceptance criteria, evidence and explicit handoffs. Do not synchronize every private chat or hidden reasoning trace.

## Authority: one owner for each kind of information

| Information | Authoritative source | Publication rule |
| --- | --- | --- |
| Goals, requirements, acceptance criteria and scope exclusions | Versioned Stride requirement records | Designated human accepts a revision |
| Architecture/engineering decision documents | Named GitHub documents at exact revisions, registered in Stride | Human adopts a specific document version; a branch edit is a proposal |
| Code, dependency locks, API/schema files, PR heads and CI observations | Verified GitHub repository objects | Automatically record facts with branch, commit, observation time and provenance |
| Approved plan, ownership, dependencies, authorizations and work state | Stride application records | Existing human decisions and scoped application rules |
| Operational policy, trusted instructions and data-access rules | Human-controlled versioned policy records and adopted repository instructions | Authorized human publishes; agent content cannot override them |
| Candidate discoveries, suggested requirements and lessons | Attributed proposals with evidence | Remain provisional until accepted or verified under the appropriate rule |
| Summaries, search indexes and component maps | Derived, rebuildable views | Always retain sources, revision and derivation status |
| Private conversation, speculative approaches and local scratch | The operator's tool | Share only a deliberate structured contribution |

GitHub describes what code exists. An implementation does not automatically change what the product is supposed to do. When accepted requirements and observed code disagree, record a discrepancy and determine whether a bug, scope change or outdated document explains it.

Requirements initially imported from the existing `PRODUCT.md`, `REQUIREMENTS.md`, ADRs or GitHub issues retain provenance and await human adoption. For this new capability, the requirement registry owns subsequent requirement edits; repository requirement exports are generated, versioned views. Document edits can propose registry changes, but there are not two independently writable authoritative copies. Architectural documents remain Git-owned under the table above.

A GitHub issue is an external reference or intake proposal until linked to an accepted Stride requirement/ticket. Comments, titles and labels alone never authorize new work. Humans may accept a context change and its linked plan in one explicit review; operator start authorization remains a separate meaning even if the UI combines decisions for the same person.

## Project, task and local context

**Project brief:** purpose, current milestone, accepted scope, exclusions, component/contract map, adopted decisions, repository baselines, approved active work, known blockers and open questions. A human can read this page without reading agent conversations.

**Work packet:** the relevant portion of that brief, its exact requirement/decision versions, required context documents, allowed change scope, dependencies, active overlapping work, repository pins, evidence expectations and stop conditions. Reviewer and QA packets include the same acceptance criteria and exact candidate while supplying role-specific instructions.

**Local context:** the packet plus that agent's own permitted exploration and working memory. Local notes can be useful but cannot supersede the approved packet or expand scope. If local instructions or remembered facts conflict with the packet, the agent reports the conflict. Stride cannot inspect unshared prompts or prove that a model understood a document; receipts establish delivery and declared adoption, not comprehension.

An existing chat with conflicting assumptions should start a fresh task session, or use an explicitly reviewed refresh path supported by its host. Do not overwrite the operator's chat, discard local edits or assume that a new prompt erases all earlier influence.

## Traceability and the minimum required context

Maintain typed links among requirements, acceptance criteria, decisions, components/contracts, work items, PR candidates and evidence. Store this graph as relational records and indexed edges in PostgreSQL initially. A new graph database or vector service is not required.

The packet assembler follows this order:

1. Validate the actor's project/repository/data permissions and the selected work revision.
2. Include mandatory requirements, exclusions, policies, decision versions and acceptance criteria.
3. Follow explicit dependency and contract links to the files, schemas and artifacts needed for this role.
4. Include a concise register of accepted overlapping work, open PRs and known conflicts so the agent does not duplicate an existing effort.
5. Add role-relevant references and optional search results within the content budget. Use exact identifiers and lexical search first; semantic retrieval can be added after evaluation.
6. Return an immutable manifest identifying every included source, revision, hash, provenance and reason for inclusion. Show required inputs that are unavailable and optional inputs omitted by the budget.

Always filter access before retrieval/ranking and again before returning content. Derived material inherits restrictions from every source it incorporates. A summary cannot make a restricted source safe to share. Cache keys include tenant, permission view, work revision and source manifest; revocation must invalidate access to cached packets and search results.

No silent truncation of mandatory instructions or acceptance criteria. If required material cannot fit or be accessed, return `context_incomplete` and split the contribution or obtain a human decision. Use a short mandatory brief with bounded references loaded as needed. The adapter accounts for the actual model context window, reserves room for execution/output and reports uncertainty when token capacity is unknown.

File scope and dependency analysis are imperfect. Explicit interface/schema/decision links are stronger than filename similarity; absence of a graph edge is not proof of no impact. Unclassified changes to a used component require revalidation. Repository-scale restructuring or policy changes may conservatively affect the whole project.

## Immutable snapshots, targeted updates

A project snapshot identifies accepted requirement/decision/policy versions and observed repository pins. A task manifest selects from that snapshot and additionally binds plan/work revisions, consumed contracts, required source hashes and the actor's permission view. A multi-repository manifest is a version vector, not a claim that separate repositories were observed atomically. Ship one repository per project in the first slice.

There is a mutable pointer to the current published project snapshot. Attempts consume immutable manifests, never a moving “latest” document. Packet publication captures a consistent set of stored source revisions in one transaction after required ingestion has completed. Missing or conflicted inputs prevent a packet being labeled ready.

Do not restart every agent for every commit. A new project snapshot marks each affected binding using required-source links and conservative impact rules:

| Change | Effect |
| --- | --- |
| Unrelated optional documentation changes | Advisory notice; current work can continue |
| New overlapping PR or ambiguous component impact | Revalidate the affected work; do not silently rebase or change scope |
| Accepted criterion, consumed interface, trusted instruction or dependency changes | Fence affected work authority until the packet is revalidated; renewed human authorization for material scope/input changes |
| Permission/operator revocation or stricter policy | Immediately deny affected Stride access; request execution stop |
| GitHub unavailable or relevant index reconciliation incomplete | Freshness becomes unknown; block new dependent claims and acceptance |
| Existing leased work while only GitHub observation is unavailable | May continue against its fixed approved input within its existing limits; submitted results remain provisional until reconciliation |

The freshness check runs at claim, reconnection, proposal acceptance, handoff, result submission and final acceptance. It rechecks current Stride versions and required GitHub facts; a prior timestamp is not perpetual clearance. During execution, subscription hints and the watcher identify changes, but server-side checks enforce current authority even if a notice was missed.

Unrelated changes leave the task's material context binding intact. An advisory acknowledgement cannot expand a packet. Meaningful changes produce a replacement packet and any required new attempt. Preserve the old packet and its evidence for comparison rather than rewriting history.

## GitHub reconciliation with direct agent access

Use a project-installed, repository-scoped GitHub App for Stride's product integration. Begin with the minimum metadata/content/PR/check read permissions needed; request check-writing authority only for the protection feature. Agents keep their own permitted GitHub access. Do not collect all operators' personal tokens to build a central index.

Verify webhook signatures, persist a delivery receipt, acknowledge promptly and process asynchronously. Use events as invalidation hints and then retrieve the current permitted GitHub object. GitHub recommends queued processing and explicit handling of missed deliveries, so webhooks alone are insufficient recovery. [GitHub webhook guidance](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks).

Also reconcile on startup/reconnection, before consequential checks and periodically with bounded, rate-aware queries. Capture repository IDs, PR IDs, ref/commit SHAs, checked scope, last successful observation and incomplete/failure state. Event delivery order and client clocks never determine the current branch head. Prevent a slower earlier fetch from overwriting a later observation; serialise refresh generations per ref/PR and compare-and-swap stored versions. Use bounded comparison/tree reads for deletions, renames, force pushes and truncated event payloads.

Changes made outside Stride appear as **external changes** until associated with a work item and authorization. A branch name or commit trailer helps correlation but is not proof of authorization. Preserve the GitHub credential actor separately from the claimed agent profile. If three agents use one person's GitHub account, GitHub evidence alone cannot distinguish them. An authenticated companion's attempt-to-SHA receipt adds an attributed claim; it still does not prove which model authored each line.

When an external PR already solves a proposed ticket, surface it before creating duplicate work. When an unapproved direct push changes a protected baseline, suspend affected acceptance, show the discrepancy and let the responsible human adopt or remediate it. Never automatically reset branches, discard local work, or promote observed implementation into accepted requirements.

| Repository mode | What Stride can claim |
| --- | --- |
| Observed | Detect/reconcile changes and block its own decisions; cannot prevent direct GitHub writes |
| Protected | Required reviews and a trusted Stride context check reduce invalid merges; protection/bypass settings must actually be configured and verified |
| Brokered, later | A controlled merge path revalidates an exact candidate and context binding immediately before execution; requires separate permissions and concurrency design |

GitHub protections support required checks and reviews, but administrative/bypass settings matter. Availability must be verified for the actual repository and account. [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

GitHub checks and Stride publication are not one atomic transaction. Reissue/withdraw affected context checks after a change and show the verification generation. Do not promise zero stale-context merge races from a webhook or a green check alone. Strict release workflows need the brokered path, candidate-bound permissions and explicit recovery for an uncertain external result. Out-of-band administrator actions remain observable exceptions. This proposal does not enable or alter repository protections.

## Requirement and ticket intake

An agent proposing more work supplies the current context receipt, problem/gap, source evidence, linked requirement or explicit new-scope flag, affected component, acceptance example, suggested role and related tickets/PRs. Classify it as an implementation gap, defect, prerequisite, clarification, new feature or context correction.

Compare against accepted scope and existing proposed/active/completed work before scheduling anything. Distinguish “no linked evidence found” from “the feature is missing.” A deterministic match can return an existing ticket; uncertain semantic similarity is a suggestion for human triage, never automatic merging of requirements.

For concurrent proposals, use actor-scoped idempotency and a project-scoped exact-problem fingerprint where its semantics are defined. Recheck scope and duplicate candidates inside acceptance, since two different agents can race. Link duplicates without erasing authorship. Different bugs under one requirement must remain possible.

Out-of-scope work stays proposed. A discovered prerequisite can be adopted into a revised plan, but cannot authorize itself by describing itself as essential. Conflicting requirement proposals are presented with their sources and alternatives to the designated human context steward. The human publishes one accepted revision using version checks; there is no last-writer-wins business decision.

## Cross-machine handoff and recovery

Publish a structured checkpoint after a meaningful milestone, before a requested handoff and when blocking. It includes manifest/requirement revisions, exact branch/commit or reviewed private patch, demonstrated criteria, changed interfaces, test commands/results, unresolved assumptions, risks and a concrete next action. Findings are labeled verified, reported or hypothetical. See [handoff template](templates/HANDOFF.md).

A remote agent cannot recover uncommitted work that was never shared. Show that condition explicitly. Sharing a patch requires a deliberate allowlisted file selection under the packet's grants; do not upload an entire home directory, untracked tree, environment file or raw terminal transcript. Secret scanning is additional protection, not proof that a patch is safe.

On another machine, enroll/authenticate the connection, inspect the handoff, retrieve current approved context and compare it with the checkpoint. Prepare a separate checkout at the required revision and verify the lockfile/toolchain instructions. Never reset or clean an existing dirty user checkout. Obtain the operator's authorization for a new attempt; do not transfer a former machine's lease or silently replay its launch.

During an outage, keep safe local checkpoints. No new authoritative claim or acceptance can occur without Stride; after lease expiry, further local output is unverified recovery material until reconciled. The product cannot physically prevent continued edits made with independent local or GitHub credentials.

## Human ownership and optional model assistance

Every project has a human context steward, initially its owner. This person owns accepted intent and resolves conflicts. The role is a responsibility, not a requirement to manually summarize every commit. Verified source ingestion, packet assembly, invalidation and duplicate exact-match checks are ordinary application services.

An architect/context-review agent may propose maps, requirement gaps and document improvements using the same proposal and human-review path as other agents. No always-running “master LLM” is needed, and that role has no privilege to rewrite the project baseline.

Recommendation: ship without a mandatory OpenRouter or other model API dependency. Use existing connected agents for reasoning. Later, optional asynchronous model assistance can suggest source-linked summaries, duplicates, missing acceptance examples or change impact. Compare its quality with the deterministic baseline before enabling it. An API outage must not block reading accepted context, executing already authorized work or reviewing evidence.

If OpenRouter is added, use an approved provider/model allowlist, bounded inputs/output/cost, recorded generation provenance and an explicit data policy. Its routing supports data-collection and retention filters; those controls need configuration and do not replace a review of the selected provider's policies. Do not silently fall back outside the approved provider set. [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

Generated summaries and semantic edges remain derived evidence. Validate source references, keep immutable source versions, rebuild after changes and never let summaries override required exact criteria. Human adoption of a requirement is explicit. A plausible paragraph is not a project decision.

## Initial implementation

Add context records, requirement versions, typed source links, proposals, immutable snapshots, packet manifests, run bindings, checkpoints and reconciliation cursors to the existing PostgreSQL-backed application. Use private object storage for bounded approved source/checkpoint bodies. Keep indexes disposable and rebuildable from retained authorized sources. Respect source removal, permission revocation and retention policies; an immutable hash is not perpetual permission to read cached content.

Do not scan every repository on every heartbeat. Incrementally refresh by source version, coalesce ref updates, debounce noncritical notifications and cap expensive repository comparisons. Freshness remains unknown until all mandatory sources in a requested packet are verified. A narrow search result or partial index must never be labeled complete project knowledge.

The first cross-machine proof uses two isolated agents: one changes a contract, another holds an older packet. The second must be blocked from authoritative submission until it adopts the appropriate context, while an unrelated task continues. Also prove cold start from a checkpoint, external GitHub changes and concurrent duplicate proposals. [Delivery plan](DELIVERY_PLAN.md) places these foundations before multi-agent launch features.
