# Commercial value of trustworthy certification

Status: proposed analysis, Phase 0, 2026-10-29. The business case must not ignore why this programme exists: **a green-fuel claim is only worth what the buyer, the auditor and the regulator are willing to believe.** This document explains where that value sits, how the [business value model](BUSINESS-VALUE-MODEL.md) represents it, what the model deliberately leaves out, and what must be measured before any of it is called a result. All figures are in the model; none is repeated here. Nothing below is verified commercial data: the case study and the owner supplied none (D-034, BR-008).

## 1. Where the money is

| Value pool | Mechanism | Who feels it | In the model? |
|---|---|---|---|
| **The green premium itself** | A buyer pays more for fuel because it is lower-emission. If the claim is disproved, discounted, disputed or cannot be evidenced, the premium is at risk and the feedstock cost is already sunk | Trading head, CEO | Yes: premium protected (`premium_usd_t`, `risk_base`, `risk_tobe`, `loss_profit_impact`) |
| **Customers who will only buy auditable claims** | Large charterers and shipowners with their own reporting duties prefer a supplier whose evidence they can verify without trust | Trading head | Yes, shown separately because it is unproven: incremental volume (`incremental_share`, `margin_usd_t`) |
| **Dispute cost and concessions** | Quantity and quality disagreements consume reviewer time and end in concessions | Commercial reviewers | Yes: dispute rate, hours, concession share |
| **Audit and certification friction** | Evidence assembly for each audit; findings and re-audits | Quality manager, compliance | Yes: audit preparation hours (findings and re-audits are not modelled) |
| **Certificate throughput** | Time and labour to assemble, calculate, approve, file | Quality manager, port operations | Yes: labour and turnaround |
| **Market access and reputation** | A residency or integrity incident can end a licence, a contract or a customer relationship | CEO, compliance | **No.** Too uncertain to number; shown as a risk in the [business case](../context/BUSINESS-CASE.md) |
| **Regulatory exposure** | Penalties or loss of scheme recognition for wrong or unsupported claims | CEO, compliance | **No.** No penalty regime is verified (D-001, D-002); nothing is invented |

## 2. The commercial argument

1. **The premium is a trust product.** The extra price pays for a claim, not for physical difference the buyer can test on delivery. The claim is only as strong as the evidence chain behind it. That chain has four weak points: the measurement, the feedstock documents, the calculation and the custody of the record afterwards. The platform's design targets each: authenticated capture, bound and verified documents, reproducible versioned calculation, and tamper-evident local hosting.
2. **Evidence quality turns a dispute from an argument into a lookup.** A dispute that can be answered with a sensor-backed, independently verifiable pack costs less to resolve and ends with fewer concessions, which is what the dispute inputs represent.
3. **Sovereignty is a commercial constraint, not only a legal one.** A group that operates across jurisdictions can only keep serving each of them if it demonstrably keeps each one's data where the law says. The extra cost of sovereign cells over a centralised design is the **price of staying in business in each jurisdiction**, and the model shows it explicitly (section 5 of the model) rather than hiding it inside a platform number.
4. **Human approval is a feature of the product.** The quality manager's approval, bound to the exact content, is what lets the group stand behind a filing. The platform shortens the preparation, not the responsibility. A design that automated the approval would be cheaper and worthless.

## 3. What the model says and does not say

The model's **base column is a placeholder**, not a forecast. It still teaches three things, which hold structurally and do not depend on any one number:

| Finding | Why it holds structurally | What would change it |
|---|---|---|
| **Labour savings alone do not carry the case.** Removing the premium and incremental lines leaves the case well below break-even in every scenario but the stacked-optimistic one | A sovereign platform has large fixed costs per cell (key custody, standby database, operations people) that a small number of certificates cannot absorb | Much higher certificate volume, or fewer jurisdictions |
| **The case is a premium-protection and dispute case.** The result depends most on volume and on the share of premium revenue currently exposed to evidence failure | That share is the biggest unmeasured number and is multiplied by a large revenue pool | Measured claim, credit-note and discount history (the first discovery request) |
| **Sovereignty has a visible price, and it is mostly people and key custody, not compute** | The workload is tiny (see [05](../target-architecture/05-QUALITY-ATTRIBUTES.md)); the cost drivers are the number of jurisdictions and operations effort | Counsel confirming that several ports share one jurisdiction (D-009) |

The model does **not** say the platform pays back. In the base scenario the three-year result is negative and payback is beyond three years; in the conservative scenario it does not pay back within ten; in the stacked-optimistic scenario it pays back quickly. The spread shows how much the answer depends on numbers nobody has measured. **A reader who quotes only the optimistic column is misreading the document.** The sponsor's decision should be to fund discovery that measures the top five drivers before funding the build.

## 4. What must be measured, and who owns it

| Measure | Why it matters | Owner (candidate) | Needed before |
|---|---|---|---|
| Premium revenue exposed to claims, credits and discounts, last two years | Largest driver; sets the value of evidence quality | Trading head with finance | Any investment decision |
| Green-fuel deliveries, tonnes and invoiced premium by port | Volume and premium pool | Trading head | Any investment decision |
| Hours to assemble, calculate, approve and file a certificate, per port | Labour baseline | Quality manager | Business case sign-off |
| Dispute count, hours, value in dispute, concessions | Dispute baseline | Commercial reviewers | Business case sign-off |
| Audit fees and effort | Audit baseline | Compliance | Business case sign-off |
| Existing costs the platform replaces | Net of replaced cost | Finance, IT | Business case sign-off |
| Per-port residency decision and hosting | Number and kind of cells | Compliance, counsel | Architecture approval |

## 5. How the commercial claim is protected from the platform's own risks

A trust product fails if the platform asserts something it cannot support. The architecture therefore treats the following as commercial controls, not only technical ones: no value from model output (HC-06), no status the authoritative process did not record (FR-028), no autonomous filing (HC-04), no certificate without a bound approval, offline verification by the buyer, and one-step reconstruction for the auditor (FR-029). Each is cheaper to keep than to repair after a public correction.

## 6. Limits

This is an analysis of mechanisms. It contains no market data, no competitor claims, no price forecast, no regulatory penalty estimate and no verified customer demand. The scale benchmark in the model is a published Singapore statistic used for plausibility only.
