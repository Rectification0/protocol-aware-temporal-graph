# ML design: training and evaluating the T-GNN

**Status: SIGNED OFF 2026-10-19** (tasks.md 9.1). The developer accepted the
recommendation for every decision D1–D10, and answered the open questions in
§7 (see §8). Each decision below still lists its options and trade-offs, as
the record of why.

---

## 1. Where things stand

| Piece | Today |
|---|---|
| Model | `src/t_gnn/tgnn.py` `DynamicTGNN`: two `SAGEConv` layers (hidden 16) and a linear score head over the live `ActiveGraphStore`. Node input is an 8-dim per-entity embedding (`EntityFeatureTable`) plus the entity's latest z-score. |
| Training | **None.** Weights are randomly initialized and never updated, so the scores the dashboard shows carry no learned signal. |
| What actually detects | The EWMA per-(entity, protocol) baseline and its z-score (FR1.4/1.5), and rule-based motif matching with time windows (FR3). |
| Evaluation | `src/t_gnn/pilot.py` scores the z-score path and the motif path against LANL-format `redteam.txt` labels (TP/FP/FN, precision, recall). It never evaluates model scores. |
| Labeled data | A tiny vendored LANL sample (`data/lanl/raw/sample_*`), a synthetic generator with labels by construction (`data/simulate_traffic.py`), and Mordor/OTRF captures on the `feature/mordor-ingestion` branch. The full LANL dataset hasn't been acquired (task 0.4). |
| Constraint | specs.md §4 rules out *replacing the T-GNN architecture*. Training the existing model, and changing its inputs, is in scope; a different architecture (task 9.14) is not, without a separate decision. |

## 2. Goal

Make the T-GNN's score a **learned, evaluated** signal that improves on what
the pipeline already detects without it, and prove that with numbers on
data the model never saw. The intended use is **ranking entities for analyst
triage**. Automated response is a specs.md §4 non-goal, so the model never
blocks anything.

Phase 9 succeeds if either of these is true:
- the trained model beats the non-ML baselines on the agreed metric (D7) by
  the agreed margin (D8), and is wired into the live pipeline; or
- it doesn't, and we can say so with evidence. That's a legitimate result,
  not a reason to keep tuning until the numbers look good.

## 3. What the model would learn from

LANL's comprehensive dataset is, per its published description, 58 days of
enterprise authentication (on the order of a billion events) with a
`redteam.txt` of several hundred known-malicious authentication events.
Verify the exact counts once the data is acquired (task 0.4). The
consequences shape every decision below:

- **Positives are extremely rare.** Roughly one labeled event per million
  authentications. Accuracy is meaningless (predicting "benign" always
  scores ~99.9999%).
- **Labels are incomplete.** `redteam.txt` lists known red-team actions, not
  every malicious event, so "unlabeled" does not mean "benign". This is a
  positive-unlabeled (PU) setting, and some "false positives" in evaluation
  may be real but unlabeled activity.
- **Labels are tied to authentications,** a (user, source computer,
  destination computer, time) tuple, not to entities directly. Mapping them
  onto entities and time windows is a design choice (D2).

## 4. Decisions

### D1: What is predicted?

| Option | For | Against |
|---|---|---|
| **(a) Entity × time window** (score each node per snapshot) | Matches the existing output (`InferenceResult` per entity), the dashboard and analysts' workflow ("which user/machine is compromised now?"). | Coarser than the attack itself; depends on window size (D5). |
| (b) Edge (score each authentication) | Matches how labels are recorded. | Needs a new output path everywhere; analysts triage entities, not single logins. |
| (c) Whole-graph snapshot | Simple. | Says *when*, not *who*. Useless for triage. |

**Recommendation: (a).** If the model is edge-based internally (D3), roll
up edge scores to entities (max over incident edges in the window).

### D2: How do labels become training targets?

- **Which entities are positive?** A red-team event names a user and two
  machines. Options: user only (what `RedTeamLabel.entity_id` does today);
  user and destination machine; or all three.
  **Recommendation: user and destination machine.** The source machine is
  usually already-compromised infrastructure, labeled at an earlier event.
- **Time:** a window is positive if a labeled event for that entity falls
  inside it, extended by `pilot.py`'s existing tolerance (1h for the anomaly
  path), so evaluation and training agree on what "caught it" means.
- **Negatives:** every other (entity, window), **excluding a buffer** of ±1
  window around each positive, so the model isn't punished for flagging the
  minutes just before or after a labeled event.
- **PU caveat:** because unlabeled isn't benign, prefer ranking metrics
  (D7) over hard error rates, and report "false positives" as "unlabeled
  detections".

### D3: Supervised, self-supervised, or both?

| Option | For | Against |
|---|---|---|
| (a) Supervised: binary classification on D2's labels | Directly optimizes what we evaluate. | A few hundred positives, mostly from one red-team campaign. High risk of memorizing that campaign rather than learning attack behavior. |
| (b) Self-supervised: link prediction. Train the model to predict which authentications happen; anomaly = how *surprising* an entity's new edges are | Uses all ~1B events, not just the labels. The standard approach for lateral-movement detection on LANL-style data, and doesn't need labels to train. | Learns "unusual", which isn't the same as "malicious". New-but-benign activity also scores high. |
| (c) **Both:** pretrain (b), then use labels only to calibrate and to fit a small supervised head on the learned representation | Representation from abundant data, decision from scarce labels. | Two stages to build and evaluate. |

**Recommendation: (b) first, with labels reserved for validation, test and
threshold calibration.** Add (c)'s supervised head as a second experiment
once (b) is measured. This keeps the rare labels out of training entirely
in the first experiment, which is the cleanest test of whether the graph
structure carries signal.

### D4: Features

The id embedding in `EntityFeatureTable` is **transductive**: it only means
something for entities seen in training. A brand-new account or host, which
is exactly what lateral movement often touches, gets an untrained row.

**Recommendation:** drop the id embedding by default and use inductive
features computed by components that already exist, so training and live
inference compute them the same way:

| Feature | Source |
|---|---|
| z-score per protocol (not just the latest one) | `BaselineStore` (FR1.4/1.5) |
| in-degree / out-degree in the active graph | `ActiveGraphStore` |
| decayed weight sum per protocol | `DecayEngine` over the entity's active edges |
| time since the entity was last seen | stream state |
| count of partial motif matches involving the entity | `MotifEngine` state |
| entity type (User / Machine) | node id prefix |

Version the feature schema (`feature_schema_version`), because task 9.9's
checkpoint loading refuses a mismatch.

### D5: Snapshot resolution

The model sees the graph as a series of snapshots. Smaller Δt is more
responsive and more expensive; larger Δt dilutes short attacks.
**Recommendation:** start at **Δt = 15 minutes**, with the 1h tolerance from
D2, and sweep {5, 15, 60} minutes in task 9.8. Decay and pruning keep
running between snapshots exactly as in the live pipeline.

### D6: Splits and leakage

- **Chronological splits only:** for LANL, roughly days 1–40 train, 41–48
  validation, 49–58 test. Adjust so each split contains labeled events; if
  the red-team activity is concentrated in a few days, report that
  explicitly. Never split randomly: neighboring windows are near-duplicates.
- **No future information:** a snapshot at time t contains only edges with
  `t_e ≤ t`; baselines and feature state are fitted on the train period
  only and then *carried forward*, never re-fitted on validation/test.
- **One code path:** the dataset builder (task 9.3) must use the same
  `DecayStreamProcessor` / `ActiveGraphStore` / `BaselineStore` code as the
  live pipeline, or the model is trained on features that inference won't
  reproduce (train/serve skew).
- **Unseen entities:** also report test metrics restricted to entities that
  first appear after the train period, which directly measures D4's concern.

### D7: Metrics

- **Primary:** PR-AUC on the test split. With extreme imbalance it's far
  more informative than ROC-AUC.
- **Operational:** precision@k per day at a fixed alert budget (e.g. k = 20
  entities/day: "if an analyst looks at the top 20, how many are real?"),
  and recall at that budget.
- **Secondary:** ROC-AUC, time-to-detect (first window flagged vs. the
  label's time), and a per-attack-type breakdown for synthetic data
  (`lateral_pivot`, `admin_share_escalation`, `low_and_slow`).
- **Uncertainty:** bootstrap 95% confidence intervals on PR-AUC and
  precision@k. With only a few hundred positives, a single number without an
  interval can't support a claim.

### D8: Success gate

Before any tuning, agree what result means "ship it":

> The trained T-GNN's test PR-AUC beats the best baseline from task 9.5
> (z-score threshold, motif matching, logistic regression or isolation
> forest on D4's features) with non-overlapping bootstrap intervals, **on
> real held-out data** (LANL or Mordor). Then it's wired in as the live
> score (task 9.9).

Results on synthetic data alone can show the pipeline works, but **can't be
reported as real-world performance**. The generator's attacks follow fixed
templates a model can learn verbatim.

### D9: Data, in what order

1. **Synthetic** (`simulate_traffic.py`): available now, labeled. Use it to
   build and debug tasks 9.3–9.7 end to end, with the known-artifact caveat.
2. **Full LANL**: the real test. Acquiring it is task 0.4's operational
   step: a manual download of several GB under the dataset's own terms.
3. **Mordor/OTRF** (B.8, separate branch): real attack techniques, small.
   Best as an extra out-of-distribution test set, not training data. Decide
   whether to merge `feature/mordor-ingestion` for this.

### D10: Tooling

- CPU-only by default. torch and torch-geometric are already dependencies.
- The baselines (task 9.5) need **scikit-learn**, a new dependency; add it as
  an optional extra (`pip install -e ".[ml]"`) rather than a core
  dependency, so the API image doesn't grow.
- Checkpoints go in `models/`, gitignored. Each run logs a JSON record
  (task 9.11); MLflow is optional, not required.

## 5. Risks

| Risk | Mitigation |
|---|---|
| Leakage makes results look better than they are | D6's rules, plus task 9.12's leakage tests. Treat any surprisingly good number as a probable bug until proven otherwise. |
| The model learns the red-team campaign, not attacks | D3(b) trains without labels; D6 reports on unseen entities; the Mordor set (D9) is an out-of-distribution check. |
| Synthetic results get mistaken for real ones | D8's rule; the model card (task 9.13) states the provenance of every number. |
| Train/serve skew | One code path (D6); the feature-schema version check (task 9.9). |
| Analyst feedback becomes biased training data later | Out of scope until task 9.15. Analysts only label what the system already surfaced. |
| The trained model is no better than the baselines | A valid outcome (§2). Report it. Task 9.14 (a temporal architecture) is the follow-up, gated on its own decision. |

## 6. Build order once signed off

1. Task 9.2 (synthetic only) → 9.3 dataset builder → 9.4 features → 9.12
   leakage tests. The pipeline exists end to end on synthetic data.
2. 9.5 baselines → 9.6 training → 9.7 evaluation in `pilot.py`. First real
   comparison, still synthetic.
3. LANL acquisition (task 0.4 / 9.2b) → rerun 2. on real data → 9.8 tuning
   (test split used once).
4. If D8's gate passes: 9.9 checkpoint loading → 9.10 calibrated
   thresholds → 9.11 runbook → 9.13 model card.

## 7. Open questions this document can't answer

- Can the full LANL dataset be downloaded and stored on the dev machine (a
  few GB compressed, much larger staged)?
- How concentrated are LANL's red-team events in time? This decides whether
  D6's split leaves labeled events in validation and test.
- Is a later move to a temporal architecture (task 9.14) acceptable if the
  current one falls short? It would mean revisiting specs.md §4.

## 8. Sign-off

Mark each decision accepted, or note the alternative. Phase 9 implementation
starts once every row is decided.

| Decision | Recommendation | Accepted? / alternative |
|---|---|---|
| D1 Prediction unit | Entity × time window | Accepted |
| D2 Labels | User and destination machine; pilot tolerance; ±1-window exclusion buffer | Accepted |
| D3 Learning setup | Self-supervised link prediction first; labels for eval/calibration only; supervised head second | Accepted |
| D4 Features | Inductive features from existing components; drop the id embedding; versioned schema | Accepted |
| D5 Snapshot Δt | 15 min, sweep {5, 15, 60} | Accepted |
| D6 Splits | Chronological; train-only fitting; one code path; unseen-entity report | Accepted |
| D7 Metrics | PR-AUC primary; precision@k/day; bootstrap CIs | Accepted (k = 20/day) |
| D8 Success gate | Beat the best baseline with non-overlapping CIs on real held-out data | Accepted |
| D9 Data order | Synthetic → LANL → Mordor as OOD test | Accepted |
| D10 Tooling | CPU; scikit-learn as an optional `[ml]` extra; gitignored `models/` | Accepted |

**Open questions (§7), answered 2026-10-19:**
- **Full LANL dataset:** yes, download it to this machine (staged under `data/lanl/`, gitignored), per the dataset's own terms.
- **Mordor (`feature/mordor-ingestion`):** merge it when Phase 9 reaches the out-of-distribution test stage, not before.
- **Temporal architecture (task 9.14):** stays gated; decide after tasks 9.5–9.7 show whether the current model falls short.
