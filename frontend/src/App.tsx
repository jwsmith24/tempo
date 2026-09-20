import { FormEvent, useEffect, useState } from "react";
import type { components } from "./api-schema";

type PlannedRunCreate = components["schemas"]["PlannedRunCreate"];
type PlannedRun = components["schemas"]["PlannedRunRead"];
type ManualActivityCreate = components["schemas"]["ManualActivityCreate"];
type CompletedActivity = components["schemas"]["CompletedActivityRead"];
type ActivityLinking = components["schemas"]["ActivityLinkingRead"];
type LinkEvidence = components["schemas"]["LinkEvidenceRead"];
type ValidationError = components["schemas"]["HTTPValidationError"];
type ActivityLinkStatus = components["schemas"]["ActivityLinkStatus"];

const intentLabels: Record<PlannedRunCreate["training_intent"], string> = {
  recovery: "Recovery",
  aerobic_base: "Aerobic base",
  threshold: "Threshold",
  power: "Power",
  assessment: "Assessment",
};

const linkStatusLabels: Record<ActivityLinkStatus, string> = {
  unmatched: "Unmatched",
  linked: "Linked",
  legacy_unresolved: "Legacy Links need resolution",
};

function plannedRunId(): string | null {
  const match = window.location.pathname.match(/^\/planned-runs\/([^/]+)$/);
  return match ? match[1] : null;
}

function activityId(): string | null {
  const match = window.location.pathname.match(/^\/activities\/([^/]+)$/);
  return match && match[1] !== "new" ? match[1] : null;
}

function route(): "run" | "activity-list" | "activity-new" | "activity-import" | "activity-detail" {
  if (window.location.pathname === "/activities") return "activity-list";
  if (window.location.pathname === "/activities/new") return "activity-new";
  if (window.location.pathname === "/activities/import") return "activity-import";
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
  if (seconds === 0) return "0 sec";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours && `${hours} hr`, minutes && `${minutes} min`, remainder && `${remainder} sec`].filter(Boolean).join(" ");
}

function formatDifference(value: number | null, unit: "seconds" | "metres"): string {
  if (value === null) return "Not comparable";
  const direction = value === 0 ? "On prescription" : value > 0 ? "under prescription" : "over prescription";
  const amount = unit === "seconds" ? formatDuration(Math.abs(value)) : `${Math.abs(value) / 1000} km`;
  return value === 0 ? direction : `${amount} ${direction}`;
}

export function App() {
  const currentRoute = route();
  const [run, setRun] = useState<PlannedRun | null>(null);
  const [activity, setActivity] = useState<CompletedActivity | null>(null);
  const [activities, setActivities] = useState<CompletedActivity[]>([]);
  const [activityLinking, setActivityLinking] = useState<ActivityLinking | null>(null);
  const [plannedRuns, setPlannedRuns] = useState<PlannedRun[]>([]);
  const [evidence, setEvidence] = useState<LinkEvidence | null>(null);
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
        if (runId) {
          setRun(result as PlannedRun);
          const evidenceResponse = await fetch(`/api/planned-runs/${runId}/linking`);
          if (!evidenceResponse.ok) throw new Error("Link evidence could not be loaded.");
          setEvidence((await evidenceResponse.json()) as LinkEvidence);
        }
        else if (completedActivityId) {
          setActivity(result as CompletedActivity);
          await refreshActivityLinking(completedActivityId);
        }
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
    if (await refreshActivityLinking(created.id)) setStatus("Saved. Matching evaluated; review the result below.");
  }

  async function importActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setStatus("Importing FIT activity...");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/activities/imports/fit", {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      const result = (await response.json()) as { detail?: string };
      setErrors({ file: result.detail || "The FIT activity could not be imported." });
      setStatus("FIT activity was not imported. Review the file error.");
      return;
    }
    const imported = (await response.json()) as CompletedActivity;
    window.history.pushState({}, "", `/activities/${imported.id}`);
    setActivity(imported);
    if (await refreshActivityLinking(imported.id)) setStatus("Imported. Matching evaluated; review the result below.");
  }

  async function refreshActivityLinking(completedActivityId: string): Promise<boolean> {
    const [activityResponse, linkingResponse, plansResponse] = await Promise.all([
      fetch(`/api/activities/${completedActivityId}`),
      fetch(`/api/activities/${completedActivityId}/linking`),
      fetch("/api/planned-runs"),
    ]);
    if (!activityResponse.ok || !linkingResponse.ok || !plansResponse.ok) {
      setStatus("Linking details could not be loaded.");
      return false;
    }
    setActivity((await activityResponse.json()) as CompletedActivity);
    setActivityLinking((await linkingResponse.json()) as ActivityLinking);
    setPlannedRuns((await plansResponse.json()) as PlannedRun[]);
    return true;
  }

  async function confirmCandidate(plannedSessionId: string) {
    if (!activity) return;
    setErrors({});
    const response = await fetch(
      `/api/activities/${activity.id}/linking/candidates/${plannedSessionId}/confirm`,
      { method: "POST" },
    );
    if (!response.ok) {
      const result = (await response.json()) as { detail?: unknown };
      setErrors({ [`link-${plannedSessionId}`]: typeof result.detail === "string" ? result.detail : "The candidate is no longer eligible." });
      setStatus("Link was not confirmed. Review the conflict.");
      return;
    }
    await refreshActivityLinking(activity.id);
    setStatus("Link confirmed. Session Outcome remains not recorded.");
  }

  async function createDirectLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activity) return;
    setErrors({});
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/activities/${activity.id}/linking/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planned_session_id: String(form.get("planned_session_id")) }),
    });
    if (!response.ok) {
      const result = (await response.json()) as { detail?: unknown };
      setErrors({ directLink: typeof result.detail === "string" ? result.detail : "The direct Link could not be created." });
      setStatus("Direct Link was not created. Review the conflict.");
      return;
    }
    await refreshActivityLinking(activity.id);
    setStatus("Direct Link created for the complete activity. Session Outcome remains not recorded.");
  }

  async function changeDirectLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activity) return;
    setErrors({});
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/activities/${activity.id}/linking/link`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planned_session_id: String(form.get("planned_session_id")), expected_version: activityLinking?.link?.link.version }),
    });
    if (!response.ok) {
      const result = (await response.json()) as { detail?: unknown };
      setErrors({ changeLink: typeof result.detail === "string" ? result.detail : "The Link could not be changed." });
      setStatus("Link was not changed. Review the conflict.");
      return;
    }
    await refreshActivityLinking(activity.id);
    setStatus("Link changed. The complete activity now belongs to the selected Planned Run.");
  }

  async function removeDirectLink() {
    if (!activity) return;
    const response = await fetch(`/api/activities/${activity.id}/linking/link`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_version: activityLinking?.link?.link.version }),
    });
    if (!response.ok) {
      const result = (await response.json()) as { detail?: string };
      setStatus(result.detail || "Link could not be removed.");
      return;
    }
    await refreshActivityLinking(activity.id);
    setStatus("Link removed. The observed evidence remains in the local record.");
  }

  async function resolveLegacy(plannedSessionId: string | null) {
    if (!activity) return;
    const response = await fetch(`/api/activities/${activity.id}/linking/legacy-resolution`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planned_session_id: plannedSessionId }),
    });
    if (!response.ok) {
      const result = (await response.json()) as { detail?: string };
      setStatus(result.detail || "Legacy Links could not be resolved.");
      return;
    }
    await refreshActivityLinking(activity.id);
    setStatus(plannedSessionId ? "Legacy Links resolved to the selected Planned Run. Preserved relationships remain in history." : "Legacy Links resolved with no current Link. Preserved relationships remain in history.");
  }

  const showingActivity = currentRoute !== "run" || activity !== null;

  return (
    <main className="mx-auto w-[min(1040px,calc(100%-40px))] pb-20 max-[700px]:w-[min(100%-24px,600px)]">
      <header className="masthead">
        <a className="wordmark" href="/" aria-label="Tempo home">tempo</a>
        <nav aria-label="Primary">
          <a href="/">Plan a run</a>
          <a href="/activities">Activities</a>
          <a href="/activities/new">Record activity</a>
          <a href="/activities/import">Import FIT</a>
        </nav>
        <span className="local-mark">Local record</span>
      </header>
      <section className="hero">
        <p className="eyebrow">{showingActivity ? "Evidence / Completed Activities" : "Planning / Running"}</p>
        <h1>{activity ? "Completed Activity" : currentRoute === "activity-list" ? "Observed work." : currentRoute === "activity-new" ? "Record what happened." : currentRoute === "activity-import" ? "Import observed work." : run ? "Planned Run" : "Set the intention."}</h1>
        <p className="lede">
          {activity
            ? activity.link_status === "linked"
              ? "This observed training evidence has one explicit whole-activity Link."
              : activity.link_status === "legacy_unresolved"
                ? "Prior relationships are preserved and await your explicit resolution; no current Link has been chosen."
              : "This is observed training evidence. It remains unmatched until you explicitly link it later."
            : currentRoute === "activity-list"
              ? "Manual training evidence remains legitimate whether or not it matches a Planned Session."
              : currentRoute === "activity-new"
                ? "Enter observed training without treating it as proof that a Planned Session was completed."
              : currentRoute === "activity-import"
                ? "Import a Garmin running FIT file while retaining its raw source and provenance."
                : run
            ? "The prescription below is revision 1 of this training intention."
            : "Record what you intend to do. Evidence of what happened stays separate."}
        </p>
      </section>
      <p className="status" role="status" aria-live="polite">{loading ? "Loading local record..." : status}</p>
      {activity ? <ActivityDetail activity={activity} linking={activityLinking} plannedRuns={plannedRuns} errors={errors} onConfirm={confirmCandidate} onCreateDirect={createDirectLink} onChange={changeDirectLink} onRemove={removeDirectLink} onResolveLegacy={resolveLegacy} /> : currentRoute === "activity-list" && !loading ? <ActivityList activities={activities} /> : currentRoute === "activity-new" ? <ActivityForm onSubmit={createActivity} errors={errors} /> : currentRoute === "activity-import" ? <ImportForm onSubmit={importActivity} errors={errors} /> : run ? <RunDetail run={run} evidence={evidence} /> : !loading && <RunForm onSubmit={createRun} errors={errors} />}
    </main>
  );
}

function ImportForm({
  onSubmit,
  errors,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  errors: Record<string, string>;
}) {
  return (
    <form className="surface-panel run-form" onSubmit={onSubmit} noValidate>
      <label>
        <span>Garmin FIT activity</span>
        <input name="file" type="file" accept=".fit,application/octet-stream" required aria-invalid={Boolean(errors.file)} aria-describedby={errors.file ? "fit-file-help fit-file-error" : "fit-file-help"} />
        <small id="fit-file-help" className="help">Stage 1 supports running activity files only.</small>
        {errors.file && <small id="fit-file-error" className="error">{errors.file}</small>}
      </label>
      <button type="submit">Import FIT Activity <span aria-hidden="true">→</span></button>
    </form>
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
    <form className="surface-panel run-form" onSubmit={onSubmit} noValidate>
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
          <span className={activity.link_status === "unmatched" ? "unmatched" : "revision"}>{linkStatusLabels[activity.link_status]}</span>
        </a>
      ))}
    </section>
  );
}

function ActivityDetail({
  activity,
  linking,
  plannedRuns,
  errors,
  onConfirm,
  onCreateDirect,
  onChange,
  onRemove,
  onResolveLegacy,
}: {
  activity: CompletedActivity;
  linking: ActivityLinking | null;
  plannedRuns: PlannedRun[];
  errors: Record<string, string>;
  onConfirm: (plannedSessionId: string) => void;
  onCreateDirect: (event: FormEvent<HTMLFormElement>) => void;
  onChange: (event: FormEvent<HTMLFormElement>) => void;
  onRemove: () => void;
  onResolveLegacy: (plannedSessionId: string | null) => void;
}) {
  const provenance = activity.import_provenance;
  return (
    <>
    <article className="surface-panel run-detail">
      <div className="detail-heading">
        <div><span className="label">Observed</span><strong>{activity.title || `${activity.modality} activity`}</strong></div>
        <span className={activity.link_status === "unmatched" ? "unmatched" : "revision"}>{linkStatusLabels[activity.link_status]}</span>
      </div>
      <dl>
        <div><dt>Modality</dt><dd>{activity.modality}</dd></div>
        <div><dt>Start instant</dt><dd>{activity.start_instant}</dd></div>
        <div><dt>Duration</dt><dd>{formatDuration(activity.duration_seconds)}</dd></div>
        <div><dt>Distance</dt><dd>{activity.distance_metres === null ? "Not recorded" : `${activity.distance_metres} m (${activity.distance_metres / 1000} km)`}</dd></div>
      </dl>
      {activity.notes && <div className="notes"><span className="label">Notes</span><p>{activity.notes}</p></div>}
      {provenance && <div className="notes"><span className="label">Import provenance</span><dl>
        <div><dt>Adapter</dt><dd>{provenance.adapter_type}</dd></div>
        <div><dt>Importer</dt><dd>{provenance.importer_name} {provenance.importer_version}</dd></div>
        <div><dt>Imported</dt><dd>{provenance.imported_at}</dd></div>
        <div><dt>Raw source</dt><dd>{provenance.raw_file_identity}</dd></div>
        <div><dt>SHA-256</dt><dd><code>{provenance.checksum_sha256}</code></dd></div>
        <div><dt>Source identity</dt><dd><code>{provenance.source_identity}</code></dd></div>
      </dl></div>}
      {provenance && <div className="notes"><span className="label">Original normalized values</span><dl>
        <div><dt>Modality</dt><dd>{provenance.original_normalized_values.modality}</dd></div>
        <div><dt>Start instant</dt><dd>{provenance.original_normalized_values.start_instant}</dd></div>
        <div><dt>Duration</dt><dd>{provenance.original_normalized_values.duration_seconds} sec</dd></div>
        <div><dt>Distance</dt><dd>{provenance.original_normalized_values.distance_metres ?? "Not recorded"} m</dd></div>
      </dl></div>}
      <footer><span>{provenance ? "Source: Garmin FIT import" : "Source: manual / Created by athlete entry"}</span><code>{activity.id}</code></footer>
    </article>
    {linking && (
      <section className="linking-panel confirmed-panel" aria-label="Confirmed Links">
        <div className="section-heading"><div><span className="revision">Whole-activity Link</span><h2>Activity ownership</h2></div></div>
        {linking.link ? (
          <form className="suggestion-card" aria-label="Change current Link" onSubmit={onChange}>
            <div><strong>{intentLabels[linking.link.planned_run.training_intent]} on {linking.link.planned_run.scheduled_date}</strong><small>{linking.link.link.source.replace("_", " ")} / complete activity</small></div>
            {linking.link.link.reasons.length > 0 && <ul>{linking.link.link.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
            <label><span>Move to Planned Run</span><select name="planned_session_id" required defaultValue={linking.link.planned_run.id}>{plannedRuns.map((plannedRun) => <option key={plannedRun.id} value={plannedRun.id}>{intentLabels[plannedRun.training_intent]} on {plannedRun.scheduled_date}</option>)}</select></label>
            {errors.changeLink && <small className="error" id="change-link-error">{errors.changeLink}</small>}
            <div className="suggestion-actions"><button type="button" className="secondary-button" onClick={onRemove}>Remove Link</button><button type="submit">Change Link</button></div>
          </form>
        ) : !linking.legacy_resolution || linking.legacy_resolution.status === "resolved" ? <form className="suggestion-card" aria-label="Create direct Link" onSubmit={onCreateDirect}>
          <label><span>Planned Run</span><select name="planned_session_id" required defaultValue=""><option value="" disabled>Choose a Planned Run</option>{plannedRuns.map((plannedRun) => <option key={plannedRun.id} value={plannedRun.id}>{intentLabels[plannedRun.training_intent]} on {plannedRun.scheduled_date}</option>)}</select></label>
          {errors.directLink && <small className="error" id="direct-link-error">{errors.directLink}</small>}
          <button type="submit">Link complete activity</button>
        </form> : null}
      </section>
    )}
    {linking && linking.candidates.length > 1 && (
      <section className="linking-panel" aria-label="Eligible Planned Run candidates">
        <div className="section-heading"><div><span className="pending-badge">Athlete selection required</span><h2>Choose one Planned Run</h2></div><code>{linking.candidates[0].algorithm_version}</code></div>
        {linking.candidates.map((candidate) => {
          const plannedRun = candidate.planned_run;
          const linkError = errors[`link-${plannedRun.id}`];
          const errorId = `link-error-${plannedRun.id}`;
          const candidateLabel = `${intentLabels[plannedRun.training_intent]} on ${plannedRun.scheduled_date}`;
          return (
            <article className="suggestion-card" aria-label={`Candidate ${candidateLabel}`} key={plannedRun.id}>
              <div><strong>{candidateLabel}</strong><small>{formatDuration(plannedRun.active_revision.duration_seconds)} planned{plannedRun.active_revision.distance_metres === null ? "" : ` / ${plannedRun.active_revision.distance_metres / 1000} km`}</small></div>
              <ul>{candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              {linkError && <small className="error" id={errorId}>{linkError}</small>}
              <button type="button" aria-describedby={linkError ? errorId : undefined} onClick={() => onConfirm(plannedRun.id)}>Confirm whole-activity Link</button>
            </article>
          );
        })}
      </section>
    )}
    {linking?.legacy_resolution?.status === "unresolved" && <section className="linking-panel" aria-label="Unresolved legacy Links">
      <div className="section-heading"><div><span className="pending-badge">Legacy resolution required</span><h2>Preserved prior relationships</h2></div></div>
      <p>This activity previously had multiple allocated Links. Tempo preserved every relationship and amount without choosing a winner.</p>
      {linking.legacy_resolution.records.map((record) => <article className="suggestion-card" key={record.id}><strong>{intentLabels[record.planned_run.training_intent]} on {record.planned_run.scheduled_date}</strong><small>Preserved: {formatDuration(record.linked_duration_seconds)}{record.linked_distance_metres === null ? "" : ` / ${record.linked_distance_metres / 1000} km`}</small><button type="button" onClick={() => onResolveLegacy(record.planned_session_id)}>Use this Planned Run</button></article>)}
      <button type="button" className="secondary-button" onClick={() => onResolveLegacy(null)}>Resolve with no current Link</button>
    </section>}
    {linking && !linking.link && linking.candidates.length === 0 && !linking.legacy_resolution ? <p className="empty-state">No eligible Planned Runs. This activity remains legitimate unmatched evidence.</p> : linking?.link ? <p className="outcome-state">The complete activity has one Link. Session Outcome remains not recorded.</p> : null}
    </>
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
    <form className="surface-panel run-form" onSubmit={onSubmit} noValidate>
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

function RunDetail({
  run,
  evidence,
}: {
  run: PlannedRun;
  evidence: LinkEvidence | null;
}) {
  const revision = run.active_revision;
  return (
    <>
    <article className="surface-panel run-detail">
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
    {evidence && evidence.links.length === 0 && <p className="outcome-state">Session Outcome: not recorded</p>}
    {evidence && evidence.links.length > 0 && (
      <section className="linking-panel confirmed-panel" aria-label="Confirmed Links">
        <div className="section-heading"><div><span className="revision">Confirmed Links</span><h2>Planned versus actual</h2></div></div>
        <dl className="evidence-card" aria-label="Complete actual totals">
          <div><dt>Total actual duration</dt><dd>{formatDuration(evidence.total_duration_seconds)}</dd></div>
          <div><dt>Total actual distance</dt><dd>{evidence.total_distance_metres === null ? "Not comparable: distance missing" : `${evidence.total_distance_metres / 1000} km`}</dd></div>
          <div><dt>Duration difference</dt><dd>{formatDifference(evidence.duration_difference_seconds, "seconds")}</dd></div>
          <div><dt>Distance difference</dt><dd>{formatDifference(evidence.distance_difference_metres, "metres")}</dd></div>
        </dl>
        {evidence.links.map((item) => (
          <article className="evidence-card" key={item.link.id}>
            <h3>{item.activity.title || "Running activity"}</h3>
            <dl>
               <div><dt>Actual duration</dt><dd>{formatDuration(item.activity.duration_seconds)}</dd></div>
               <div><dt>Actual distance</dt><dd>{item.activity.distance_metres === null ? "Not recorded" : `${item.activity.distance_metres / 1000} km`}</dd></div>
              <div><dt>Link source</dt><dd>{item.link.source.replace("_", " ")}</dd></div>
            </dl>
            <div className="notes"><span className="label">Source provenance</span><p>{item.activity.import_provenance ? `${item.activity.import_provenance.adapter_type} / ${item.activity.import_provenance.importer_name} ${item.activity.import_provenance.importer_version} / imported ${item.activity.import_provenance.imported_at} / raw source ${item.activity.import_provenance.raw_file_identity}` : "Manual athlete entry; no imported raw source."}</p></div>
          </article>
        ))}
        <p className="outcome-state">Session Outcome: not recorded</p>
      </section>
    )}
    </>
  );
}
