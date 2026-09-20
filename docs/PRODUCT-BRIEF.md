# Tempo

## Purpose

Tempo is a local-first, single-athlete tool for executing an integrated run, bike, and strength program. It acts as a daily source of truth: show what training is intended, ingest or record what happened, link the two, reveal progress and execution patterns, and propose explainable schedule or dose changes for athlete approval.

The first proof of value is four weeks of exclusive use without a parallel planning spreadsheet or training log.

## Product Principles

- Optimize first for executing plans well, not maximizing engagement or replacing a human clinician.
- Treat running, cycling, and lifting as one Integrated Program with modality-specific evidence and explicit cross-modality constraints.
- Preserve plan history, source data, corrections, recommendations, and athlete decisions.
- Keep adherence multidimensional. Do not collapse intent, prescription fidelity, consistency, outcomes, and decision quality into one score.
- Use deterministic, inspectable calculations and rules for findings and recommendations.
- State uncertainty and abstain when evidence is insufficient or contradictory.
- Keep the athlete in control of every material plan change.
- Keep data source-neutral, locally owned, exportable, and recoverable.

## User And Operating Loop

The initial user is one athlete on one machine.

The daily loop is:

1. Review today's Planned Sessions, readiness context, and trajectory.
2. Train using existing devices or workflows.
3. Import Completed Activities or enter them manually.
4. Review automatic Links, resolve ambiguous matches, and correct or remove Links when needed.
5. Record Session Outcomes, a tiny check-in, and any corrections.
6. Review findings and explicitly accept, decline, or ignore no Recommendation.

A weekly review summarizes execution, readiness, modality-specific load, notable changes, course-change triggers, and proposed adjustments.

## Training Scope

### Running

Support base-building by duration and structured Pfitzinger-derived sessions entered individually by the athlete. A Planned Run supports duration or distance, structured segments, pace/heart-rate/effort targets, repetitions, recoveries, strides, and notes.

### Strength

Support individually entered Tactical Barbell-derived sessions. A Planned Lift supports exercises, sets, reps, load, optional RPE, rest, training max context, and progression context.

### Cycling

Initially treat cycling as aerobic cross-training. Include it in endurance evidence and explicit interference or recovery rules, but defer a full cycling-plan model.

### Plans And Goals

Outside sources remain authoritative for plan content. The tool records source method, block, intent, priority, and athlete adaptations without bundling or redistributing proprietary plan text.

An Integrated Program overlays concurrent running and strength Training Blocks. Explicit priorities and constraints resolve conflicts. Open-ended base-building may coexist with dated goals and benchmark sessions.

## Calendar And Linking

Required views are day, week, and block.

The calendar supports creating, editing, rescheduling, and linking individual Planned Sessions. Every prescription or schedule change preserves revisions, rationale, and the active revision at execution time.

Each Completed Activity may Link wholly to at most one Planned Session, while one Planned Session may receive multiple Completed Activities when a session is split across recordings. Multi-modal training uses separate Planned Sessions and separate Completed Activities rather than dividing one combined activity across plans. An unmatched Completed Activity remains legitimate unplanned training evidence.

Immediately after manual creation or FIT import, deterministic matching evaluates eligible Planned Sessions. Exactly one eligible candidate creates the Link automatically; multiple candidates require athlete selection and confirmation without creating a Link; zero candidates leave the activity unmatched. The athlete may change or remove a Link. Linking remains independent of Session Outcome and never claims completion.

Session Outcomes distinguish:

- completed;
- modified;
- rescheduled;
- intentionally skipped;
- unintentionally missed;
- replaced.

Optional reasons are preserved. A justified skip remains a plan deviation while contributing positively to decision quality.

## Analysis

The primary screen answers two questions: what should I do today, and am I on course?

The execution scorecard shows separate dimensions without a total score:

- intent achievement;
- prescription fidelity;
- consistency;
- outcome trend;
- decision quality.

Run analysis initially covers frequency, time, distance, intensity distribution, long-run share, pace-to-heart-rate or perceived-effort efficiency, and structured-workout execution.

Strength analysis initially covers exposure, sets, reps, load, estimated strength, completion, and progression by main lift.

Progress may be compared against personal bests, a recent rolling baseline, the current block start, and a stated goal. Benchmark results come from Planned Sessions with benchmark intent.

Cross-modality analysis preserves separate signals and applies explicit interference and recovery rules rather than claiming a universal training-load score.

## Readiness And Safety

A tiny check-in captures low-friction readiness plus post-session effort or feel and optional notes. Initial objective readiness context is sleep, HRV trend, and resting-heart-rate trend. These are evidence, not truth.

Pain, illness, or suspected injury exits normal coaching scope. The tool may flag the condition and suggest rest or professional assessment, but does not diagnose, prescribe rehabilitation, or recommend injury-specific substitutions.

Weight is optional contextual trend data. Full nutrition and fueling analysis is deferred.

## Coaching Boundary

Typed, versioned built-in rules have visible rationale, editable parameters, and enable/disable controls. Initial recommendations may reschedule, shorten, reduce intensity, substitute ordinary training alternatives, or skip a session.

Material Recommendations have proposed, accepted, declined, and expired states. Acceptance creates explicit plan revisions; recommendations never alter the program silently.

Course-change findings use visible rules such as repeated misses, sustained dose reductions, poor readiness, or stalled outcomes.

AI conversation is deferred. A future language model may explain deterministic findings and support dialogue, but may not create facts, originate unvalidated recommendations, change the plan, or conceal uncertainty.

## Data And Integration

The canonical record is source-neutral and local. Initial inputs are:

- manual Planned Session entry;
- Garmin FIT activity-file import;
- manual activity and lifting entry;
- manual corrections and overrides.

Raw imports, source identity, importer version, normalized records, revisions, and correction history are retained. Imports are idempotent. Analysis uses corrected values while preserving originals.

Future Garmin Connect or other vendor sync enters through source adapters. Garmin's official Connect APIs are business-only cloud integrations, so unofficial credential scraping is out of scope.

Athlete settings include units, pace and heart-rate zones, exercise definitions, training maxes, and benchmark conventions.

Deletion is reversible until explicit purge. Purge removes associated raw data. Complete documented export and versioned backup bundles include canonical records, settings, provenance, raw inputs, a manifest, and schema version.

## Product Shape

The MVP is a responsive React and TypeScript single-page application served by a loopback-only local FastAPI application. The backend uses Python, SQLAlchemy, migrations, SQLite, and managed local raw-file storage.

The application is a modular monolith with explicit modules for planning, activities, linking, analysis, coaching, and athlete settings. One backend-owned API schema governs the frontend contract.

Derived metrics update after relevant writes and can be rebuilt deterministically. Current algorithms recompute historical analysis while algorithm versions and historical Recommendation decisions remain traceable.

The local MVP has no login, binds only to loopback, and keeps data under the user profile with restrictive permissions.

The UI is keyboard operable, does not encode state by color alone, provides readable chart alternatives, and targets WCAG AA contrast.

## Delivery Stages

### Stage 1: Linking

Enter one Planned Run, import its FIT activity, deterministically Link the whole activity when exactly one plan is eligible or ask the athlete to resolve ambiguity, record its separate Session Outcome and check-in, and show planned-versus-actual evidence.

Also support manual Completed Activity entry, idempotent import, provenance, corrections, and basic export.

### Stage 2: Command Center

Add day, week, and block views; concurrent Training Blocks; run and lift prescriptions; schedule and prescription revisions; unplanned work; goals; benchmarks; and the daily and weekly review loops.

### Stage 3: Analysis

Add the multidimensional execution scorecard, run and strength trends, weight context, readiness trends, multiple progress baselines, deterministic rebuilds, and historical block import.

### Stage 4: Coaching

Add typed visible rules, cross-modality constraints, daily flags, weekly schedule-and-dose proposals, Recommendation lifecycle, course-change findings, uncertainty handling, and the pain or illness safety stop.

AI conversation, proactive notifications, full nutrition context, direct Garmin Connect sync, full cycling programming, live workout execution, and multi-user support remain later options.

## MVP Acceptance

The aligned MVP is successful when all four tracer stages are usable and the athlete can use Tempo as the exclusive daily source of truth for four consecutive weeks.

Critical correctness checks include:

- repeated imports do not duplicate activities;
- corrections never destroy imported source values;
- reschedules and accepted recommendations preserve prior prescriptions;
- split recordings link as multiple whole Completed Activities to one Planned Session, while multi-modal work remains separate activities and plans without fabrication;
- justified skips remain visible as deviations;
- analysis can be rebuilt reproducibly;
- missing evidence causes qualified output or abstention;
- backup bundles restore the complete canonical record.

## External Facts

- Garmin FIT is an interoperable file protocol for activity, workout, course, and health-device data: https://developer.garmin.com/fit/overview/
- Garmin Connect Activity and Health APIs are cloud-to-cloud integrations in a business-only developer program: https://developer.garmin.com/gc-developer-program/overview/
- Garmin documents program eligibility and OAuth 2.0 in its FAQ: https://developer.garmin.com/gc-developer-program/program-faq/
