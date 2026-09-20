import { FormEvent, useEffect, useState } from "react";
import type { components } from "./api-schema";

type PlannedRunCreate = components["schemas"]["PlannedRunCreate"];
type PlannedRun = components["schemas"]["PlannedRunRead"];
type ManualActivityCreate = components["schemas"]["ManualActivityCreate"];
type CompletedActivity = components["schemas"]["CompletedActivityRead"];
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

function activityId(): string | null {
  const match = window.location.pathname.match(/^\/activities\/([^/]+)$/);
  return match && match[1] !== "new" ? match[1] : null;
}

function route(): "run" | "activity-list" | "activity-new" | "activity-detail" {
  if (window.location.pathname === "/activities") return "activity-list";
  if (window.location.pathname === "/activities/new") return "activity-new";
  if (activityId()) return "activity-detail";
  return "run";
}

function localOffset(): string {
  const minutes = -new Date().getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "Not prescribed";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours && `${hours} hr`, minutes && `${minutes} min`, remainder && `${remainder} sec`].filter(Boolean).join(" ");
}

export function App() {
  const currentRoute = route();
  const [run, setRun] = useState<PlannedRun | null>(null);
  const [activity, setActivity] = useState<CompletedActivity | null>(null);
  const [activities, setActivities] = useState<CompletedActivity[]>([]);
  const [loading, setLoading] = useState(Boolean(plannedRunId() || activityId() || currentRoute === "activity-list"));
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const runId = plannedRunId();
    const completedActivityId = activityId();
    const endpoint = runId
      ? `/api/planned-runs/${runId}`
      : completedActivityId
        ? `/api/activities/${completedActivityId}`
        : currentRoute === "activity-list"
          ? "/api/activities"
          : null;
    if (!endpoint) return;
    fetch(endpoint)
      .then(async (response) => {
        if (!response.ok) throw new Error(runId ? "This Planned Run could not be found." : "Completed Activities could not be loaded.");
        const result = await response.json();
        if (runId) setRun(result as PlannedRun);
        else if (completedActivityId) setActivity(result as CompletedActivity);
        else setActivities(result as CompletedActivity[]);
      })
      .catch((error: Error) => setStatus(error.message))
      .finally(() => setLoading(false));
  }, [currentRoute]);

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

  async function createActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setStatus("Saving Completed Activity...");
    const form = new FormData(event.currentTarget);
    const start = String(form.get("start_local"));
    const offset = String(form.get("utc_offset"));
    const durationMinutes = Number(form.get("duration_minutes"));
    const distanceInput = String(form.get("distance_kilometres"));
    const distanceKilometres = distanceInput === "" ? null : Number(distanceInput);
    if (!/^[+-](?:0\d|1\d|2[0-3]):[0-5]\d$/.test(offset)) {
      setErrors({ utc_offset: "Enter a UTC offset from -23:59 to +23:59." });
      setStatus("Completed Activity was not saved. Review the highlighted fields.");
      return;
    }
    const body: ManualActivityCreate = {
      modality: form.get("modality") as ManualActivityCreate["modality"],
      start_instant: `${start}:00${offset}`,
      duration_seconds: Math.round(durationMinutes * 60),
      distance_metres: distanceKilometres === null ? null : Math.round(distanceKilometres * 1000),
      title: String(form.get("title")) || null,
      notes: String(form.get("notes")) || null,
    };
    const response = await fetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const validation = (await response.json()) as ValidationError;
      const nextErrors: Record<string, string> = {};
      validation.detail?.forEach((error) => {
        const field = String(error.loc.at(-1) ?? "form");
        nextErrors[field] = error.msg;
      });
      setErrors(nextErrors);
      setStatus("Completed Activity was not saved. Review the highlighted fields.");
      return;
    }
    const created = (await response.json()) as CompletedActivity;
    window.history.pushState({}, "", `/activities/${created.id}`);
    setActivity(created);
    setStatus("Saved as unmatched training evidence in your local record.");
  }

  const showingActivity = currentRoute !== "run" || activity !== null;

  return (
    <main>
      <header className="masthead">
        <a className="wordmark" href="/" aria-label="Tempo home">tempo</a>
        <nav aria-label="Primary">
          <a href="/">Plan a run</a>
          <a href="/activities">Activities</a>
          <a href="/activities/new">Record activity</a>
        </nav>
        <span className="local-mark">Local record</span>
      </header>
      <section className="hero">
        <p className="eyebrow">{showingActivity ? "Evidence / Completed Activities" : "Planning / Running"}</p>
        <h1>{activity ? "Completed Activity" : currentRoute === "activity-list" ? "Observed work." : currentRoute === "activity-new" ? "Record what happened." : run ? "Planned Run" : "Set the intention."}</h1>
        <p className="lede">
          {activity
            ? "This is observed training evidence. It remains unmatched until you explicitly reconcile it later."
            : currentRoute === "activity-list"
              ? "Manual training evidence remains legitimate whether or not it matches a Planned Session."
              : currentRoute === "activity-new"
                ? "Enter observed training without treating it as proof that a Planned Session was completed."
                : run
            ? "The prescription below is revision 1 of this training intention."
            : "Record what you intend to do. Evidence of what happened stays separate."}
        </p>
      </section>
      <p className="status" role="status" aria-live="polite">{loading ? "Loading local record..." : status}</p>
      {activity ? <ActivityDetail activity={activity} /> : currentRoute === "activity-list" && !loading ? <ActivityList activities={activities} /> : currentRoute === "activity-new" ? <ActivityForm onSubmit={createActivity} errors={errors} /> : run ? <RunDetail run={run} /> : !loading && <RunForm onSubmit={createRun} errors={errors} />}
    </main>
  );
}

function ActivityForm({
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
          <span>Modality</span>
          <select name="modality" defaultValue="running" aria-invalid={Boolean(errors.modality)} aria-describedby={errors.modality ? "activity-modality-error" : undefined}>
            <option value="running">Running</option>
            <option value="cycling">Cycling</option>
            <option value="strength">Strength</option>
            <option value="other">Other</option>
          </select>
          {errors.modality && <small id="activity-modality-error" className="error">{errors.modality}</small>}
        </label>
        <label>
          <span>Local start</span>
          <input name="start_local" type="datetime-local" required aria-invalid={Boolean(errors.start_instant)} aria-describedby={errors.start_instant ? "activity-start-error" : undefined} />
          {errors.start_instant && <small id="activity-start-error" className="error">{errors.start_instant}</small>}
        </label>
        <label>
          <span>UTC offset</span>
          <input name="utc_offset" type="text" required pattern="[+-][0-9]{2}:[0-9]{2}" defaultValue={localOffset()} aria-invalid={Boolean(errors.utc_offset)} aria-describedby={errors.utc_offset ? "offset-help offset-error" : "offset-help"} />
          <small id="offset-help" className="help">Format: +05:30 or -04:00</small>
          {errors.utc_offset && <small id="offset-error" className="error">{errors.utc_offset}</small>}
        </label>
      </div>
      <fieldset>
        <legend>Observed amount</legend>
        <div className="measure-grid">
          <label><span>Duration</span><span className="unit-input"><input name="duration_minutes" type="number" min="0.0167" step="0.0167" required aria-invalid={Boolean(errors.duration_seconds)} aria-describedby={errors.duration_seconds ? "activity-duration-error" : undefined} /><b>min</b></span>{errors.duration_seconds && <small id="activity-duration-error" className="error">{errors.duration_seconds}</small>}</label>
          <span className="or">required / optional</span>
          <label><span>Distance <i>Optional</i></span><span className="unit-input"><input name="distance_kilometres" type="number" min="0.001" step="0.001" aria-invalid={Boolean(errors.distance_metres)} aria-describedby={errors.distance_metres ? "activity-distance-error" : undefined} /><b>km</b></span>{errors.distance_metres && <small id="activity-distance-error" className="error">{errors.distance_metres}</small>}</label>
        </div>
      </fieldset>
      <label>
        <span>Title <i>Optional</i></span>
        <input name="title" type="text" maxLength={200} aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? "activity-title-error" : undefined} />
        {errors.title && <small id="activity-title-error" className="error">{errors.title}</small>}
      </label>
      <label className="spaced-field">
        <span>Notes <i>Optional</i></span>
        <textarea name="notes" rows={4} maxLength={2000} aria-invalid={Boolean(errors.notes)} aria-describedby={errors.notes ? "activity-notes-error" : undefined} />
        {errors.notes && <small id="activity-notes-error" className="error">{errors.notes}</small>}
      </label>
      <button type="submit">Save Completed Activity <span aria-hidden="true">→</span></button>
    </form>
  );
}

function ActivityList({ activities }: { activities: CompletedActivity[] }) {
  if (activities.length === 0) {
    return <section className="empty-state"><p>No Completed Activities recorded yet.</p><a className="button-link" href="/activities/new">Record an activity</a></section>;
  }
  return (
    <section className="activity-list" aria-label="Completed Activities">
      {activities.map((activity) => (
        <a href={`/activities/${activity.id}`} key={activity.id}>
          <span><b>{activity.title || `${activity.modality} activity`}</b><small>{new Date(activity.start_instant).toLocaleString()}</small></span>
          <span className="unmatched">Unmatched</span>
        </a>
      ))}
    </section>
  );
}

function ActivityDetail({ activity }: { activity: CompletedActivity }) {
  return (
    <article className="run-detail">
      <div className="detail-heading">
        <div><span className="label">Observed</span><strong>{activity.title || `${activity.modality} activity`}</strong></div>
        <span className="unmatched">Unmatched</span>
      </div>
      <dl>
        <div><dt>Modality</dt><dd>{activity.modality}</dd></div>
        <div><dt>Start instant</dt><dd>{activity.start_instant}</dd></div>
        <div><dt>Duration</dt><dd>{formatDuration(activity.duration_seconds)}</dd></div>
        <div><dt>Distance</dt><dd>{activity.distance_metres === null ? "Not recorded" : `${activity.distance_metres} m (${activity.distance_metres / 1000} km)`}</dd></div>
      </dl>
      {activity.notes && <div className="notes"><span className="label">Notes</span><p>{activity.notes}</p></div>}
      <footer><span>Source: manual / Created by athlete entry</span><code>{activity.id}</code></footer>
    </article>
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
