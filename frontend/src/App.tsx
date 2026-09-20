import { FormEvent, useEffect, useState } from "react";
import type { components } from "./api-schema";

type PlannedRunCreate = components["schemas"]["PlannedRunCreate"];
type PlannedRun = components["schemas"]["PlannedRunRead"];
type ManualActivityCreate = components["schemas"]["ManualActivityCreate"];
type CompletedActivity = components["schemas"]["CompletedActivityRead"];
type ActivityMatchSuggestion = components["schemas"]["ActivityMatchSuggestionRead"];
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
  partly_linked: "Partly linked",
  linked: "Linked",
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
  const [activitySuggestions, setActivitySuggestions] = useState<ActivityMatchSuggestion[]>([]);
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
    if (await refreshActivityLinking(created.id)) {
      setStatus("Saved as unmatched training evidence. Review any suggested Planned Run match below.");
    }
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
    if (await refreshActivityLinking(imported.id)) {
      setStatus("Imported as unmatched training evidence. Review any suggested Planned Run match below.");
    }
  }

  async function refreshActivitySuggestions(completedActivityId: string): Promise<boolean> {
    const response = await fetch(`/api/activities/${completedActivityId}/linking/suggestions`);
    if (!response.ok) {
      setStatus("Planned Run suggestions could not be loaded.");
      return false;
    }
    setActivitySuggestions((await response.json()) as ActivityMatchSuggestion[]);
    return true;
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
    return refreshActivitySuggestions(completedActivityId);
  }

  async function rejectSuggestion(plannedSessionId: string) {
    if (!activity) return;
    const response = await fetch(
      `/api/planned-runs/${plannedSessionId}/linking/suggestions/${activity.id}/reject`,
      { method: "POST" },
    );
    if (!response.ok) {
      const result = (await response.json()) as { detail?: string };
      setStatus(result.detail || "Suggestion could not be rejected.");
      return;
    }
    await refreshActivitySuggestions(activity.id);
    setStatus("Suggestion rejected. The Planned Session and Completed Activity remain unchanged.");
  }

  async function confirmSuggestion(event: FormEvent<HTMLFormElement>, plannedSessionId: string) {
    event.preventDefault();
    if (!activity) return;
    setErrors({});
    const form = new FormData(event.currentTarget);
    const duration = Number(form.get("linked_duration_minutes"));
    const distanceInput = String(form.get("linked_distance_kilometres"));
    const body = {
      linked_duration_seconds: Math.round(duration * 60),
      linked_distance_metres: distanceInput === "" ? null : Math.round(Number(distanceInput) * 1000),
    };
    const response = await fetch(
      `/api/planned-runs/${plannedSessionId}/linking/suggestions/${activity.id}/confirm`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    if (!response.ok) {
      const result = (await response.json()) as { detail?: unknown };
      const detail = result.detail;
      const message = typeof detail === "string" ? detail : "Enter positive linked amounts within the activity's remaining evidence.";
      setErrors({ [`link-${plannedSessionId}`]: message });
      setStatus("Link was not confirmed. Review the linked amount.");
      return;
    }
    await refreshActivityLinking(activity.id);
    setStatus("Link confirmed. Session Outcome remains not recorded.");
  }

  function linkBody(form: FormData) {
    const duration = Number(form.get("linked_duration_minutes"));
    const distanceInput = String(form.get("linked_distance_kilometres"));
    return {
      linked_duration_seconds: Math.round(duration * 60),
      linked_distance_metres: distanceInput === "" ? null : Math.round(Number(distanceInput) * 1000),
    };
  }

  async function createDirectLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activity) return;
    setErrors({});
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/activities/${activity.id}/linking/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planned_session_id: String(form.get("planned_session_id")), ...linkBody(form) }),
    });
    if (!response.ok) {
      const result = (await response.json()) as { detail?: unknown };
      setErrors({ directLink: typeof result.detail === "string" ? result.detail : "Enter positive linked amounts within the remaining evidence." });
      setStatus("Direct link was not created. Review the linked amounts.");
      return;
    }
    await refreshActivityLinking(activity.id);
    setStatus("Direct link created. Remaining evidence stays visible.");
  }

  async function updateDirectLink(event: FormEvent<HTMLFormElement>, linkId: string, version: number) {
    event.preventDefault();
    if (!activity) return;
    setErrors({});
    const response = await fetch(`/api/activities/${activity.id}/linking/links/${linkId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...linkBody(new FormData(event.currentTarget)), expected_version: version }),
    });
    if (!response.ok) {
      const result = (await response.json()) as { detail?: unknown };
      setErrors({ [`edit-${linkId}`]: typeof result.detail === "string" ? result.detail : "The link could not be updated." });
      setStatus("Link was not updated. Review the linked amounts.");
      return;
    }
    await refreshActivityLinking(activity.id);
    setStatus("Link updated. Remaining evidence recalculated.");
  }

  async function removeDirectLink(linkId: string, version: number) {
    if (!activity) return;
    const response = await fetch(`/api/activities/${activity.id}/linking/links/${linkId}?expected_version=${version}`, { method: "DELETE" });
    if (!response.ok) {
      const result = (await response.json()) as { detail?: string };
      setStatus(result.detail || "Link could not be removed.");
      return;
    }
    await refreshActivityLinking(activity.id);
    setStatus("Link removed. The observed evidence remains in the local record.");
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
            ? activity.link_status !== "unmatched"
              ? "This observed training evidence has an explicit confirmed Link; any remaining evidence stays visible."
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
      {activity ? <ActivityDetail activity={activity} suggestions={activitySuggestions} linking={activityLinking} plannedRuns={plannedRuns} errors={errors} onReject={rejectSuggestion} onConfirm={confirmSuggestion} onCreateDirect={createDirectLink} onUpdate={updateDirectLink} onRemove={removeDirectLink} /> : currentRoute === "activity-list" && !loading ? <ActivityList activities={activities} /> : currentRoute === "activity-new" ? <ActivityForm onSubmit={createActivity} errors={errors} /> : currentRoute === "activity-import" ? <ImportForm onSubmit={importActivity} errors={errors} /> : run ? <RunDetail run={run} evidence={evidence} /> : !loading && <RunForm onSubmit={createRun} errors={errors} />}
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
  suggestions,
  linking,
  plannedRuns,
  errors,
  onReject,
  onConfirm,
  onCreateDirect,
  onUpdate,
  onRemove,
}: {
  activity: CompletedActivity;
  suggestions: ActivityMatchSuggestion[];
  linking: ActivityLinking | null;
  plannedRuns: PlannedRun[];
  errors: Record<string, string>;
  onReject: (plannedSessionId: string) => void;
  onConfirm: (event: FormEvent<HTMLFormElement>, plannedSessionId: string) => void;
  onCreateDirect: (event: FormEvent<HTMLFormElement>) => void;
  onUpdate: (event: FormEvent<HTMLFormElement>, linkId: string, version: number) => void;
  onRemove: (linkId: string, version: number) => void;
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
        <div className="section-heading"><div><span className="revision">Confirmed Links</span><h2>Link observed evidence</h2></div></div>
        <p>{formatDuration(linking.remaining_duration_seconds)} remaining{linking.remaining_distance_metres === null ? "" : ` / ${linking.remaining_distance_metres / 1000} km remaining`}</p>
        {linking.links.map(({ link, planned_run: plannedRun }) => {
          const label = `${intentLabels[plannedRun.training_intent]} on ${plannedRun.scheduled_date}`;
          const linkError = errors[`edit-${link.id}`];
          const errorId = `edit-link-error-${link.id}`;
          return (
            <form className="suggestion-card" aria-label={`Link to ${label}`} key={link.id} onSubmit={(event) => onUpdate(event, link.id, link.version)}>
              <div><strong>{label}</strong><small>{link.confirmation_source === "direct" ? "Direct Link" : "Confirmed suggestion"}</small></div>
              <div className="link-fields">
                 <label><span>Linked duration</span><span className="unit-input"><input name="linked_duration_minutes" type="number" min="0.0167" step="any" required defaultValue={link.linked_duration_seconds / 60} aria-invalid={Boolean(linkError)} aria-describedby={linkError ? errorId : undefined} /><b>min</b></span></label>
                 <label><span>Linked distance <i>Optional</i></span><span className="unit-input"><input name="linked_distance_kilometres" type="number" min="0.001" step="any" defaultValue={link.linked_distance_metres === null ? "" : link.linked_distance_metres / 1000} aria-invalid={Boolean(linkError)} aria-describedby={linkError ? errorId : undefined} /><b>km</b></span></label>
              </div>
              {linkError && <small className="error" id={errorId}>{linkError}</small>}
              <div className="suggestion-actions"><button type="button" className="secondary-button" onClick={() => onRemove(link.id, link.version)}>Remove Link</button><button type="submit">Save Link</button></div>
            </form>
          );
        })}
        <form className="suggestion-card" aria-label="Create direct Link" onSubmit={onCreateDirect}>
          <label><span>Planned Run</span><select name="planned_session_id" required defaultValue=""><option value="" disabled>Choose a Planned Run</option>{plannedRuns.map((plannedRun) => <option key={plannedRun.id} value={plannedRun.id}>{intentLabels[plannedRun.training_intent]} on {plannedRun.scheduled_date}</option>)}</select></label>
          <div className="link-fields">
             <label><span>Linked duration</span><span className="unit-input"><input name="linked_duration_minutes" type="number" min="0.0167" step="any" required defaultValue={linking.remaining_duration_seconds / 60} aria-invalid={Boolean(errors.directLink)} aria-describedby={errors.directLink ? "direct-link-error" : undefined} /><b>min</b></span></label>
             <label><span>Linked distance <i>Optional</i></span><span className="unit-input"><input name="linked_distance_kilometres" type="number" min="0.001" step="any" defaultValue={linking.remaining_distance_metres === null ? "" : linking.remaining_distance_metres / 1000} aria-invalid={Boolean(errors.directLink)} aria-describedby={errors.directLink ? "direct-link-error" : undefined} /><b>km</b></span></label>
          </div>
          {errors.directLink && <small className="error" id="direct-link-error">{errors.directLink}</small>}
          <button type="submit">Create Link</button>
        </form>
      </section>
    )}
    {suggestions.length > 0 ? (
      <section className="linking-panel" aria-label="Suggested Planned Run matches">
        <div className="section-heading"><div><span className="pending-badge">Pending suggestion</span><h2>Match this activity to a plan</h2></div><code>{suggestions[0].algorithm_version}</code></div>
        {suggestions.map((suggestion) => {
          const plannedRun = suggestion.planned_run;
          const linkError = errors[`link-${plannedRun.id}`];
          const errorId = `link-error-${plannedRun.id}`;
          const suggestionLabel = `${intentLabels[plannedRun.training_intent]} on ${plannedRun.scheduled_date}`;
          return (
            <form className="suggestion-card" aria-label={`Suggestion for ${suggestionLabel}`} key={plannedRun.id} onSubmit={(event) => onConfirm(event, plannedRun.id)}>
              <div><strong>{suggestionLabel}</strong><small>{formatDuration(plannedRun.active_revision.duration_seconds)} planned{plannedRun.active_revision.distance_metres === null ? "" : ` / ${plannedRun.active_revision.distance_metres / 1000} km`}</small></div>
              <ul>{suggestion.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              <div className="link-fields">
                 <label><span>Linked duration</span><span className="unit-input"><input name="linked_duration_minutes" type="number" min="0.0167" step="any" required defaultValue={suggestion.proposed_duration_seconds / 60} aria-invalid={Boolean(linkError)} aria-describedby={linkError ? errorId : undefined} /><b>min</b></span></label>
                 <label><span>Linked distance <i>Optional</i></span><span className="unit-input"><input name="linked_distance_kilometres" type="number" min="0.001" step="any" defaultValue={suggestion.proposed_distance_metres === null ? "" : suggestion.proposed_distance_metres / 1000} aria-invalid={Boolean(linkError)} aria-describedby={linkError ? errorId : undefined} /><b>km</b></span></label>
              </div>
              {linkError && <small className="error" id={errorId}>{linkError}</small>}
              <div className="suggestion-actions"><button type="button" className="secondary-button" onClick={() => onReject(plannedRun.id)}>Reject suggestion</button><button type="submit">Confirm Link</button></div>
            </form>
          );
        })}
      </section>
    ) : activity.link_status === "unmatched" ? <p className="empty-state">No compatible Planned Run suggestions.</p> : <p className="outcome-state">This activity has a confirmed Link. Open its Planned Run to review planned-versus-actual evidence.</p>}
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
        {evidence.links.map((item) => (
          <article className="evidence-card" key={item.link.id}>
            <h3>{item.activity.title || "Running activity"}</h3>
            <dl>
               <div><dt>Linked duration</dt><dd>{formatDuration(item.link.linked_duration_seconds)}</dd></div>
               <div><dt>Linked distance</dt><dd>{item.link.linked_distance_metres === null ? "Not linked" : `${item.link.linked_distance_metres / 1000} km`}</dd></div>
              <div><dt>Unmatched duration</dt><dd>{formatDuration(item.unmatched_duration_seconds)}</dd></div>
              <div><dt>Unmatched distance</dt><dd>{item.unmatched_distance_metres === null ? "Not recorded" : `${item.unmatched_distance_metres / 1000} km`}</dd></div>
              <div><dt>Duration difference</dt><dd>{formatDifference(evidence.duration_difference_seconds, "seconds")}</dd></div>
              <div><dt>Distance difference</dt><dd>{formatDifference(evidence.distance_difference_metres, "metres")}</dd></div>
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
