import { FormEvent, useEffect, useState } from "react";
import type { components } from "./api-schema";

type PlannedRunCreate = components["schemas"]["PlannedRunCreate"];
type PlannedRun = components["schemas"]["PlannedRunRead"];
type ValidationError = components["schemas"]["HTTPValidationError"];

const intentLabels: Record<PlannedRunCreate["training_intent"], string> = {
  recovery: "Recovery",
  aerobic_base: "Aerobic base",
  threshold: "Threshold",
  power: "Power",
  assessment: "Assessment",
};

function plannedRunId(): string | null {
  const match = window.location.pathname.match(/^\/planned-runs\/([^/]+)$/);
  return match ? match[1] : null;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "Not prescribed";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours && `${hours} hr`, minutes && `${minutes} min`, remainder && `${remainder} sec`].filter(Boolean).join(" ");
}

export function App() {
  const [run, setRun] = useState<PlannedRun | null>(null);
  const [loading, setLoading] = useState(Boolean(plannedRunId()));
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const id = plannedRunId();
    if (!id) return;
    fetch(`/api/planned-runs/${id}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("This Planned Run could not be found.");
        setRun((await response.json()) as PlannedRun);
      })
      .catch((error: Error) => setStatus(error.message))
      .finally(() => setLoading(false));
  }, []);

  async function createRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setStatus("Saving Planned Run...");
    const form = new FormData(event.currentTarget);
    const durationMinutes = Number(form.get("duration_minutes")) || null;
    const distanceKilometres = Number(form.get("distance_kilometres")) || null;
    if (!durationMinutes && !distanceKilometres) {
      setErrors({ prescription: "Enter a duration, distance, or both." });
      setStatus("Planned Run was not saved. Review the highlighted fields.");
      return;
    }
    const body: PlannedRunCreate = {
      scheduled_date: String(form.get("scheduled_date")),
      training_intent: form.get("training_intent") as PlannedRunCreate["training_intent"],
      priority: form.get("priority") as PlannedRunCreate["priority"],
      notes: String(form.get("notes")) || null,
      duration_seconds: durationMinutes ? Math.round(durationMinutes * 60) : null,
      distance_metres: distanceKilometres ? Math.round(distanceKilometres * 1000) : null,
    };
    const response = await fetch("/api/planned-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const validation = (await response.json()) as ValidationError;
      const nextErrors: Record<string, string> = {};
      validation.detail?.forEach((error) => {
        const field = String(error.loc.at(-1) ?? "prescription");
        nextErrors[field === "body" ? "prescription" : field] = error.msg;
      });
      setErrors(nextErrors);
      setStatus("Planned Run was not saved. Review the highlighted fields.");
      return;
    }
    const created = (await response.json()) as PlannedRun;
    window.history.pushState({}, "", `/planned-runs/${created.id}`);
    setRun(created);
    setStatus("Saved. This Planned Run is in your local record.");
  }

  return (
    <main>
      <header className="masthead">
        <a className="wordmark" href="/" aria-label="Tempo home">tempo</a>
        <span className="local-mark">Local record</span>
      </header>
      <section className="hero">
        <p className="eyebrow">Planning / Running</p>
        <h1>{run ? "Planned Run" : "Set the intention."}</h1>
        <p className="lede">
          {run
            ? "The prescription below is revision 1 of this training intention."
            : "Record what you intend to do. Evidence of what happened stays separate."}
        </p>
      </section>
      <p className="status" role="status" aria-live="polite">{loading ? "Loading Planned Run..." : status}</p>
      {run ? <RunDetail run={run} /> : !loading && <RunForm onSubmit={createRun} errors={errors} />}
    </main>
  );
}

function RunForm({
  onSubmit,
  errors,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  errors: Record<string, string>;
}) {
  return (
    <form className="run-form" onSubmit={onSubmit} noValidate>
      <div className="field-grid">
        <label>
          <span>Local date</span>
          <input name="scheduled_date" type="date" required aria-invalid={Boolean(errors.scheduled_date)} aria-describedby={errors.scheduled_date ? "date-error" : undefined} />
          {errors.scheduled_date && <small id="date-error" className="error">{errors.scheduled_date}</small>}
        </label>
        <label>
          <span>Training intent</span>
          <select name="training_intent" defaultValue="aerobic_base" aria-invalid={Boolean(errors.training_intent)} aria-describedby={errors.training_intent ? "intent-error" : undefined}>
            {Object.entries(intentLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
          {errors.training_intent && <small id="intent-error" className="error">{errors.training_intent}</small>}
        </label>
        <label>
          <span>Priority</span>
          <select name="priority" defaultValue="normal" aria-invalid={Boolean(errors.priority)} aria-describedby={errors.priority ? "priority-error" : undefined}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
          {errors.priority && <small id="priority-error" className="error">{errors.priority}</small>}
        </label>
      </div>
      <fieldset aria-describedby={errors.prescription ? "prescription-error" : undefined}>
        <legend>Prescription <span>At least one</span></legend>
        <div className="measure-grid">
          <label><span>Duration</span><span className="unit-input"><input name="duration_minutes" type="number" min="0.0167" step="0.0167" aria-invalid={Boolean(errors.duration_seconds)} aria-describedby={errors.duration_seconds ? "duration-error" : undefined} /><b>min</b></span>{errors.duration_seconds && <small id="duration-error" className="error">{errors.duration_seconds}</small>}</label>
          <span className="or">or / and</span>
          <label><span>Distance</span><span className="unit-input"><input name="distance_kilometres" type="number" min="0.001" step="0.001" aria-invalid={Boolean(errors.distance_metres)} aria-describedby={errors.distance_metres ? "distance-error" : undefined} /><b>km</b></span>{errors.distance_metres && <small id="distance-error" className="error">{errors.distance_metres}</small>}</label>
        </div>
        {errors.prescription && <small id="prescription-error" className="error">{errors.prescription}</small>}
      </fieldset>
      <label>
        <span>Notes <i>Optional</i></span>
        <textarea name="notes" rows={4} maxLength={2000} aria-invalid={Boolean(errors.notes)} aria-describedby={errors.notes ? "notes-error" : undefined} placeholder="Terrain, context, or anything worth remembering" />
        {errors.notes && <small id="notes-error" className="error">{errors.notes}</small>}
      </label>
      <button type="submit">Save Planned Run <span aria-hidden="true">→</span></button>
    </form>
  );
}

function RunDetail({ run }: { run: PlannedRun }) {
  const revision = run.active_revision;
  return (
    <article className="run-detail">
      <div className="detail-heading">
        <div><span className="label">Scheduled</span><strong>{new Date(`${run.scheduled_date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</strong></div>
        <span className="revision">Active revision {revision.revision_number}</span>
      </div>
      <dl>
        <div><dt>Training intent</dt><dd>{intentLabels[run.training_intent]}</dd></div>
        <div><dt>Priority</dt><dd>{run.priority}</dd></div>
        <div><dt>Duration</dt><dd>{formatDuration(revision.duration_seconds)}</dd></div>
        <div><dt>Distance</dt><dd>{revision.distance_metres === null ? "Not prescribed" : `${revision.distance_metres} m (${revision.distance_metres / 1000} km)`}</dd></div>
      </dl>
      {run.notes && <div className="notes"><span className="label">Notes</span><p>{run.notes}</p></div>}
      <footer><span>Created by athlete entry</span><code>{run.id}</code></footer>
    </article>
  );
}
