# Certification Schemes and Measurement Standards (Candidates)

Status: baseline v0.1, 2026-10-28. **Nothing in this document is confirmed as applicable.** Every entry is a candidate for validation (CS-P5), recorded so that a qualified person can confirm or discard it. This is class **D** in the baseline: regulatory or certification claims requiring verification.

## 1. Rules for using this document
1. A candidate is never cited in a requirement as a binding obligation. Requirements reference a `V-nn` entry in their "Verify (D)" column, which means "this requirement may be shaped by a claim that is not yet verified".
2. Status stays `Candidate` until the verifier in [D-002](DECISION-REGISTER.md) records: the authoritative source consulted (the legal text or standard itself, with edition and date), the conclusion on applicability, and the verifier's name and role. That record goes in an ADR or an evidence note, not in chat.
3. Agents must not state regulatory content (thresholds, formulas, clause numbers, dates, penalties) beyond what is written here. Unknown means "not verified".
4. This document deliberately contains no numerical regulatory values, formulas or deadlines. They would need primary-source verification and would age quickly.
5. Names below were recalled from general knowledge and cross-checked once against secondary web summaries on 2026-10-28. Secondary summaries are not authoritative and disagreed with recall in two places (noted under Section 5). Titles and editions must be confirmed.

## 2. Candidate certification schemes and regulations

| ID | Candidate | Why it might matter here | Claim to verify before relying on it | Related requirements | Status |
|---|---|---|---|---|---|
| V-01 | ISCC EU and ISCC PLUS (voluntary sustainability certification, with mass-balance chain of custody and proofs of sustainability) | Possible source of the "scheme-specific" attributes and of mass-balance rules | Whether the group's fuels fall under it; which version of its documents applies; what its evidence and system-of-record rules require | FR-007, FR-017, FR-021 | Candidate |
| V-02 | RSB (Roundtable on Sustainable Biomaterials) | Alternative or additional voluntary scheme | Same as V-01 | FR-007, FR-017 | Candidate |
| V-03 | Other voluntary schemes recognised by the European Commission for the EU renewable energy rules | Customers may demand a specific scheme | Current list on the European Commission's register of recognised schemes | FR-007 | Candidate |
| V-04 | EU Renewable Energy Directive (Directive (EU) 2018/2001 as amended) and the Union Database for Biofuels | May define sustainability criteria, proofs of sustainability and a registry for transactions | Applicability to marine fuels supplied in Asian ports; any registry duty on the group | FR-003, FR-027 | Candidate |
| V-05 | FuelEU Maritime Regulation (EU) 2023/1805 | Customers' ships may need well-to-wake GHG-intensity data from suppliers | Whether and how customers rely on supplier data for ships calling at EU ports; what documents a supplier must provide | FR-007, FR-022 | Candidate |
| V-06 | EU emissions trading for maritime (Directive 2003/87/EC as amended) and the EU maritime MRV Regulation (EU) 2015/757 as amended | Customers' reporting may depend on fuel emission attributes | Same as V-05 | FR-022 | Candidate |
| V-07 | IMO 2024 Guidelines on life cycle GHG intensity of marine fuels (MEPC.391(81)), including the Fuel Lifecycle Label | Candidate methodology basis and a candidate label format | Status of the guidelines at the time of use; whether any national or customer rule requires them; whether a label is needed | FR-007, FR-008, FR-026 | Candidate |
| V-08 | IMO "Net-Zero Framework" and associated MARPOL Annex VI amendments | Possible future fuel standard and pricing mechanism | **Status unknown.** A secondary summary gave an out-of-date schedule. Check the current IMO position before any use | FR-012 | Candidate, status unknown |
| V-09 | MARPOL Annex VI, including fuel quality provisions, bunker delivery notes and retained samples, and the IMO fuel oil consumption data collection system | Existing delivery documents and sampling duties sit in this regime | Exact regulation numbers and how biofuel blends are treated | FR-004, FR-013 | Candidate |
| V-10 | National and port rules in Asian jurisdictions, for example Singapore: the Maritime and Port Authority's licensing and bunkering requirements and Singapore Standards SS 600, SS 648 and SS 524 | A major bunkering hub with mass-flow-meter rules that may define edge-device, data-logger and dispute procedures | **Not known which jurisdictions are in scope (D-003).** Titles, editions and scope of each standard; whether the 2024 revision of SS 648 covers biofuel blends and edge-device data security. See Section 5 | FR-001, FR-006, FR-013, SEC-001, SEC-013 | Candidate |
| V-11 | ISO 22095 (chain of custody: terminology and models, including the mass-balance model) | Shared vocabulary for mass-balance design | Edition and whether any scheme in scope references it | FR-017 to FR-021 | Candidate |
| V-12 | Scheme-specific calculation rules and default or actual-value sources published by scheme owners | The deterministic methods in CS-CAP-2 must come from somewhere | Authoritative document, version and licence terms for each scheme in scope | FR-007 to FR-012, DATA-005 | Candidate |

## 3. Candidate measurement and quality standards

| ID | Candidate | Why it might matter here | Claim to verify before relying on it | Related requirements | Status |
|---|---|---|---|---|---|
| V-20 | ISO 8217 (marine fuel specifications) | Quality parameters of delivered fuel | Edition; handling of biofuel blends | FR-013 | Candidate |
| V-21 | ISO 13739 (procedures for transfer of bunkers to ships) | Delivery procedure and documentation | Edition and local adoption | FR-004 | Candidate |
| V-22 | OIML R 117 (dynamic measuring systems for liquids other than water) | Legal-metrology basis for flow measurement | Whether local legal metrology rules reference it for bunker meters | FR-001, FR-013 | Candidate |
| V-23 | API Manual of Petroleum Measurement Standards, including chapters on Coriolis meters and calculation of petroleum quantities | Measurement and calculation practice | Which chapters and editions are used by the group's ports | FR-001, DATA-007 | Candidate |
| V-24 | ISO 3170 and ISO 3171 (sampling) and ISO 4259 (precision of test methods and their use in specification disputes) | Quality dispute and sampling practice | Edition and which parts apply | FR-013, FR-014 | Candidate |
| V-25 | ISO/IEC 17025 (testing and calibration laboratories) | Competence of laboratories whose results enter evidence | Whether labs used are accredited and how accreditation is evidenced | FR-013 | Candidate |
| V-26 | National legal metrology authority requirements for meter approval and verification | Meter status at time of delivery is evidence | Authority, rules and certificate formats per jurisdiction | FR-013, DATA-008 | Candidate |

## 4. Candidate security and data standards

| ID | Candidate | Why it might matter here | Claim to verify before relying on it | Related requirements | Status |
|---|---|---|---|---|---|
| V-30 | IEC 62443 (industrial automation and control systems security) | Edge devices attach to operational technology | Which parts suit the edge design; whether any customer or port demands it | SEC-013 | Candidate |
| V-31 | ISO/IEC 27001 | General information security management | Whether customers or schemes require certification | SEC-014 | Candidate |
| V-32 | Trusted timestamping and transparency-log techniques (for example RFC 3161 and RFC 9162) and W3C Verifiable Credentials | Possible building blocks for tamper evidence | Suitability and legal weight; this is design input only, not a compliance claim | SEC-007, SEC-008, NFR-011 | Candidate |
| V-33 | Data protection laws of the in-scope jurisdictions | Applies only if personal data is processed (D-017) | Which laws apply and whether the data is personal | DATA-010 | Candidate |
| V-34 | IMO and classification-society cyber-resilience requirements for ships | Customer ships and bunker vessels may carry obligations that reach our edge devices | Applicability to the group's vessels and to onboard integrations | SEC-013 | Candidate |
| V-35 | Residency and data-localisation laws and contractual terms of each in-scope jurisdiction | This is the legal source behind CS-C1 | Which rules exist, what "within jurisdiction" means, and what exceptions exist (D-009) | SEC-001 to SEC-004, NFR-009 | Candidate |

## 5. Known uncertainties from the one-time cross-check (2026-10-28)
Secondary summaries were obtained through web search. They are listed so that nobody mistakes them for verification.

| Item | What recall said | What the secondary summary said | Handling |
|---|---|---|---|
| SS 524 | Not sure of the title; possibly a biofuel-blend specification | Described as a quality management framework for the bunker supply chain | Title and scope unverified. Do not cite |
| SS 648 revision | A mass-flow-meter code of practice | Said a 2024 revision covers biofuels, edge devices and data loggers, with mandatory dates | Treat as a pointer to check, not a fact |
| IMO Net-Zero Framework | Adoption was delayed in 2025 | Described adoption as still under negotiation with some dated statements already out of date | Status unknown (V-08) |
| FuelEU Maritime | Regulation number and general scope | Consistent; also gave numerical targets | Numbers deliberately not copied here |

## 6. Verification procedure (proposed, to be approved under D-002)
For each candidate that the programme chooses to rely on:
1. Obtain the authoritative text (the legal act, the standard, or the scheme document) and record edition, date and access route.
2. Record whether it applies, to whom, from when, and to which fuels and ports.
3. Extract only the obligations that shape a requirement; cite clause identifiers in the ADR, not here.
4. Name the verifier and role. Mark the entry `Verified (date)` or `Not applicable (reason)`.
5. Re-verify on a schedule, since schemes and regulations change. The schedule is an open point under D-002.
