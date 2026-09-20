# Tempo

This context describes one athlete's intended and observed training, the evidence used to assess it, and athlete-controlled adaptations across endurance and strength work.

## Program Language

**Training Plan**:
An external or athlete-authored methodology that supplies prescription context and rationale. It is not the athlete's complete working calendar.
_Avoid_: Calendar, actual program

**Integrated Program**:
The athlete's combined, current course of training across concurrent Training Blocks, including priorities, constraints, and revision history.
_Avoid_: Training Plan, schedule

**Training Block**:
A bounded phase of the Integrated Program with a purpose, source method, priority, and expected progression.
_Avoid_: Plan, calendar

**Planned Session**:
A dated intention to train with modality, intent, prescription, priority, and revision history.
_Avoid_: Completed workout, activity

**Prescription Revision**:
An immutable version of a Planned Session's timing or prescribed dose, including its reason and provenance.
_Avoid_: Overwrite, current workout

**Training Intent**:
A controlled shared purpose such as recovery, aerobic base, threshold, power, strength, or assessment, augmented by modality-specific detail.
_Avoid_: Free-form workout name

**Benchmark**:
A durable performance result derived from a Planned Session with assessment intent and its reconciled evidence.
_Avoid_: Automatically detected personal record

## Evidence Language

**Completed Activity**:
Observed training evidence imported from a source or entered manually. It may be planned, unplanned, split across recordings, or combined with other work.
_Avoid_: Planned Session, workout

**Reconciliation**:
The explicit many-to-many allocation between Planned Sessions and Completed Activities used to assess what work fulfilled which intent.
_Avoid_: Date match, automatic completion

**Session Outcome**:
The athlete-confirmed disposition of planned work: completed, modified, rescheduled, intentionally skipped, unintentionally missed, or replaced, with an optional reason.
_Avoid_: Boolean completion

**Check-in**:
A small athlete-reported observation about readiness or post-session effort and feel.
_Avoid_: Diagnosis, objective readiness

**Correction**:
An explicit replacement for an interpreted value that preserves the source value, reason, and time of change.
_Avoid_: Destructive edit

## Assessment Language

**Execution Scorecard**:
A set of separate assessments for intent achievement, prescription fidelity, consistency, outcome trend, and decision quality. It has no aggregate score.
_Avoid_: Adherence score, compliance percentage

**Readiness Evidence**:
Subjective and objective observations that may qualify training guidance but do not independently determine readiness.
_Avoid_: Readiness truth, diagnosis

**Finding**:
A versioned, reproducible result produced from canonical records by a calculation or rule.
_Avoid_: AI opinion

**Recommendation**:
A proposed, explainable schedule or dose change that remains separate from the Integrated Program until explicitly accepted.
_Avoid_: Automatic plan change, command

**Decision Quality**:
An assessment of whether the athlete made a sound adjustment given available evidence, kept separate from prescription fidelity.
_Avoid_: Excused completion

**Course-change Finding**:
An explainable indication that repeated deviations, reductions, readiness concerns, or stalled outcomes may make the current Integrated Program unsuitable.
_Avoid_: Automatic reprogramming
