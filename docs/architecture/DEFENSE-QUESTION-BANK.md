# Design-Defence Question Bank

Status: v0.1, 2026-10-28. Questions a reviewer or challenger puts to a design, in the style of a VCDX or NPX defence. Each question belongs to one of the ten perspectives in [REVIEW-PERSPECTIVES](REVIEW-PERSPECTIVES.md). Use the `design-defense` skill to run a session.

**Tags** say when a question applies: `ALL` always; `DATA` data placement, residency, isolation; `EDGE` edge and connectivity; `AGENT` agents and autonomy; `CERT` certificates, keys, scheme reliance; `CALC` calculations and methodology; `OPS` operations and support; `INTEG` integration; `COST` cost trade-offs. A design declares its tags; a question applies when the design shares a tag or the question is tagged `ALL`.

**Critical = Yes** means the design cannot be Approved until the review record shows the question as Answered. A critical question that cannot be answered is recorded as Unanswered with the reason (usually an open decision) and blocks approval; it is never skipped.

**What counts as an answer.** A defensible answer points to something that exists: a requirement ID, a design element, a decision, an evidence record. "We will handle that later" and "the model will decide" are not answers. An answer must not contain a figure without a source; an honest "no target exists yet (D-031)" is a good answer.

| ID | Perspective | Tags | Critical | Question | A defensible answer includes | Red flags |
|---|---|---|---|---|---|---|
| DQ-01-01 | PV-01 | ALL | Yes | Which stated business requirement does this design serve, and what measure would show it worked? | BR identifiers; a measure; whether a baseline exists (D-034), stated plainly if it does not | A benefit with no baseline; a figure with no source |
| DQ-01-02 | PV-01 | ALL | No | What does this design make harder for the business, and who bears that cost? | The losers and the burden, linked to a tradeoff row | "There are no downsides" |
| DQ-01-03 | PV-01 | ALL | No | What is the cheapest way to get most of the value, and why is it not the proposal? | A real minimal or do-nothing option, assessed fairly | A straw-man baseline |
| DQ-01-04 | PV-01 | ALL | No | Does anything here add a sixth capability or widen one of the five? | A mapping to the five capabilities; any extension raised as a decision | Silent scope growth |
| DQ-01-05 | PV-01 | DATA | No | Which teams gain or lose access to data because of where it is placed? | Roles and workflows affected, including group reporting | Group needs ignored |
| DQ-01-06 | PV-01 | ALL | No | If the owner halved the scope, what would you drop first and what would break? | A priority order grounded in Must and Should | Everything is essential |
| DQ-02-01 | PV-02 | ALL | Yes | Which parts are deterministic software and which are agents, and why? | A boundary where every number, status and legal fact comes from deterministic code or an authoritative record | A model producing figures or statuses |
| DQ-02-02 | PV-02 | INTEG | No | Who owns each integration, and what is the contract including behaviour when the other side is down? | Named owner, interface description, failure behaviour | An undefined interface |
| DQ-02-03 | PV-02 | EDGE | Yes | What does the edge do when the shore service is unreachable, and when it returns? | Local capture, queuing, ordered and repeat-safe synchronisation, gap reporting | An assumption of connectivity |
| DQ-02-04 | PV-02 | AGENT | No | Where is each agent's action catalogue enforced, and what happens on a request outside it? | Platform-level enforcement with a logged denial | Enforcement only by prompt |
| DQ-02-05 | PV-02 | INTEG | No | Which existing systems are touched, and what data do they own? | An inventory (D-035) | A greenfield assumption |
| DQ-02-06 | PV-02 | ALL | No | What breaks if one component is replaced by a different technology? | Interfaces that survive replacement | Unexamined lock-in |
| DQ-03-01 | PV-03 | DATA | Yes | For each data class in this design, in which zone does it live and what evidence will show it never leaves? | Placement taken from the sovereignty matrix; configuration evidence and a negative test per flow | "It is in the right region" |
| DQ-03-02 | PV-03 | DATA | Yes | What does "within the jurisdiction" mean for each port, and who decided? | A legal source with verified status (D-009), or a plain statement that it is unknown and the design is blocked | An assumed meaning |
| DQ-03-03 | PV-03 | DATA | No | What data does the group need that would cross a border, and is each element on an approved flow? | The items and their legal basis (D-011) | Aggregates assumed safe |
| DQ-03-04 | PV-03 | DATA | No | Where do backups, replicas, logs, telemetry, caches and AI prompts live? | Flows F-01 to F-15 in the sovereignty matrix considered | Only primary storage discussed |
| DQ-03-05 | PV-03 | AGENT | Yes | How is one shipowner's data kept from another's across storage, indexes, caches and agent memory? | The isolation unit (D-015), no shared index or cache, adversarial tests | Isolation by instruction |
| DQ-03-06 | PV-03 | DATA | No | If a port authority asked you to prove residency today, what would you show? | The evidence set and who produces it | Verbal assurance |
| DQ-04-01 | PV-04 | ALL | Yes | Which Azure services and regions does this design rely on, and how was availability in each jurisdiction verified? | A verified source and date, or an explicit "not verified" that blocks approval | Assumed availability; invented resource names |
| DQ-04-02 | PV-04 | ALL | No | What are the landing zone, identity and network model, and who approves changes? | Reference to D-037 and the approving role | Not considered |
| DQ-04-03 | PV-04 | ALL | Yes | Who deploys, and how are deployments kept from being autonomous? | Deployment by humans from reviewed code; agents hold no deployment rights | A pipeline that deploys on an agent commit |
| DQ-04-04 | PV-04 | DATA | No | Does any service you depend on process or store data, metadata or telemetry outside the jurisdiction? | Per-service verification | "The region is pinned, so fine" |
| DQ-04-05 | PV-04 | EDGE | No | What runs at the edge, who owns the hardware, and how is it updated safely? | A view of D-018 and the update path | An assumption that the edge is controllable |
| DQ-04-06 | PV-04 | ALL | No | How is the platform reproduced in a second port without drift? | Parameterised definitions per port | Hand-built environments |
| DQ-05-01 | PV-05 | ALL | Yes | What are the failure modes, and how does the design behave in each? | A list with detection, behaviour and recovery | Only the happy path |
| DQ-05-02 | PV-05 | ALL | Yes | Which availability, recovery and performance targets apply, whose are they, and what is the source? | The source decision (D-031), or an explicit "no target exists yet" | A number with no source |
| DQ-05-03 | PV-05 | EDGE | No | What is the longest disconnection tolerated, and what happens when it is exceeded? | A value from D-020 and defined behaviour at the limit | An unbounded buffer |
| DQ-05-04 | PV-05 | ALL | No | What grows with volume, and where is the first bottleneck? | Capacity drivers (D-032) | "It scales" |
| DQ-05-05 | PV-05 | DATA | No | How does recovery work without placing copies outside the jurisdiction? | An in-jurisdiction recovery design | A recovery copy abroad |
| DQ-05-06 | PV-05 | ALL | No | What is the degraded mode when AI services are unavailable? | Deterministic capture and calculation continue | AI on the critical path |
| DQ-06-01 | PV-06 | ALL | Yes | Which identity performs each action, with which role, and can any agent approve its own work? | Distinct identities, least privilege, no agent approval permission | A shared service account |
| DQ-06-02 | PV-06 | CERT | Yes | Who holds the signing keys, where, and how is custody shown? | Local custody (D-013) and rotation | Keys held elsewhere |
| DQ-06-03 | PV-06 | ALL | No | How is every action reconstructed afterwards? | Append-only logs, correlation identifiers, an agent action log | Logs that can be edited |
| DQ-06-04 | PV-06 | AGENT | No | What stops a malicious document or message from changing an agent's behaviour? | Untrusted-input handling and platform limits | "The prompt says not to" |
| DQ-06-05 | PV-06 | DATA | No | Who can administer the data stores, and from where? | In-jurisdiction administration, denied from outside by default (SEC-002) | A global administrator group |
| DQ-06-06 | PV-06 | ALL | No | Which part of security depends on a human noticing something? | Automated controls first | Reliance on vigilance |
| DQ-07-01 | PV-07 | OPS | Yes | Who operates this in each port, from where, and with what access? | A named role and in-jurisdiction operation (D-033) | A central team with remote administration |
| DQ-07-02 | PV-07 | ALL | Yes | Where do logs, metrics and traces go, and do they contain jurisdiction-bound data? | In-jurisdiction collection with approved export | A global workspace |
| DQ-07-03 | PV-07 | OPS | No | What does a port do when the platform is down at the start of a delivery? | A manual fallback and later reconciliation | Nothing planned |
| DQ-07-04 | PV-07 | ALL | No | Which runbooks are needed first, and who owns them? | A list and owners | Not considered |
| DQ-07-05 | PV-07 | DATA | No | How is data restored after loss, inside the jurisdiction? | A restore design and test plan | A restore never tested |
| DQ-07-06 | PV-07 | OPS | No | How do you know the platform is healthy at a quiet port? | Synthetic checks and heartbeats | Silence taken as health |
| DQ-08-01 | PV-08 | ALL | Yes | What drives cost, by component and port, and is each driver identified without an invented amount? | Named drivers; amounts only with sources; unknowns stated | A total with no source |
| DQ-08-02 | PV-08 | ALL | No | Which licences or data rights constrain this design (factor sets, standards, software)? | The terms checked | Assumed to be free |
| DQ-08-03 | PV-08 | DATA | No | What does one port cost relative to many, when each has its own platform? | Per-port structure and attribution (NFR-019) | Shared-cost fiction |
| DQ-08-04 | PV-08 | ALL | No | What would reversing this decision cost? | The cost drivers of reversal | "Easy to change" |
| DQ-08-05 | PV-08 | COST | No | Which cheaper option was rejected, and why? | A fair comparison | A hidden preference |
| DQ-08-06 | PV-08 | ALL | No | Who pays, and what funding decision is needed? | Reference to D-034 | Unfunded |
| DQ-09-01 | PV-09 | CERT | Yes | Show the chain from a meter reading to a certificate. Which link is weakest? | Each link with its record and evidence | A gap described as "implied" |
| DQ-09-02 | PV-09 | DATA | Yes | How are raw readings protected from alteration between the meter and storage, including while offline? | Source identity, sequence, integrity checks | Manual re-entry without control |
| DQ-09-03 | PV-09 | CERT | Yes | Which standards or schemes does this rely on, and what is the verified status of each? | Status taken from CERTIFICATION-SCHEMES; unverified ones not treated as binding | A candidate treated as binding |
| DQ-09-04 | PV-09 | CALC | No | How would you re-run a historical calculation after the methodology changed? | Stored version, factors and build | Overwritten constants |
| DQ-09-05 | PV-09 | CERT | No | What happens to mass balance when a blend or tank transfer is recorded late? | Event ordering and correction rules | A silent re-balance |
| DQ-09-06 | PV-09 | DATA | No | If a meter is later found faulty, what can you still prove about past deliveries? | Meter status records and sample linkage | Nothing recorded |
| DQ-10-01 | PV-10 | ALL | Yes | What is the strongest argument against this design, and why does it not win? | A real attack and a reasoned answer or a recorded risk | "There is none" |
| DQ-10-02 | PV-10 | ALL | Yes | Which assumption, if wrong, breaks the design, and how will you find out early? | A named assumption and a cheap test | Untested assumptions |
| DQ-10-03 | PV-10 | ALL | Yes | Why is each rejected option rejected, in terms of a requirement or constraint? | Reasons tied to identifiers | Rejection by taste |
| DQ-10-04 | PV-10 | DATA | No | A port authority demands a copy of its data held elsewhere. What now? | A process and a decision owner | Not considered |
| DQ-10-05 | PV-10 | AGENT | No | A customer asks the agent to reveal another customer's delivery. How does the design respond? | A policy-based refusal that is logged | Reliance on model judgement |
| DQ-10-06 | PV-10 | ALL | No | What would you need to see in six months to say this was the wrong choice? | Observable triggers | An unfalsifiable design |
