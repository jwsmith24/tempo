import { FormEvent, useEffect, useRef, useState, type RefObject } from "react";
import type { components } from "./api-schema";

type PlannedRunCreate = components["schemas"]["PlannedRunCreate"];
type PlannedRun = components["schemas"]["PlannedRunRead"];
type ManualActivityCreate = components["schemas"]["ManualActivityCreate"];
type CompletedActivity = components["schemas"]["CompletedActivityRead"];
type ActivityLinking = components["schemas"]["ActivityLinkingRead"];
type LinkEvidence = components["schemas"]["LinkEvidenceRead"];
type ValidationError = components["schemas"]["HTTPValidationError"];
type ActivityLinkStatus = components["schemas"]["ActivityLinkStatus"];
type SessionOutcomeCreate = components["schemas"]["SessionOutcomeCreate"];

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
const outcomeLabels: Record<SessionOutcomeCreate["disposition"], string> = {
  completed: "Completed",
  modified: "Modified",
  rescheduled: "Rescheduled",
  intentionally_skipped: "Intentionally skipped",
  unintentionally_missed: "Unintentionally missed",
  replaced: "Replaced",
};

const surfacePanel = "border border-line bg-surface p-[clamp(24px,5vw,48px)] shadow-[7px_7px_0_var(--color-ink)] max-[700px]:shadow-none";
const formPanel = `${surfacePanel} [&_fieldset]:my-[34px] [&_fieldset]:border-0 [&_fieldset]:border-y [&_fieldset]:border-line [&_fieldset]:px-0 [&_fieldset]:py-[30px] [&_legend]:pr-[18px] [&_legend]:font-mono [&_legend]:text-sm [&_legend]:font-semibold [&_legend]:uppercase [&_legend_span]:ml-2 [&_legend_span]:text-[11px] [&_legend_span]:text-muted`;
const errorText = "font-sans text-[13px] font-semibold text-danger normal-case";
const helpText = "font-sans text-xs text-[#687069] normal-case";
const fieldGrid = "grid grid-cols-[1.2fr_1fr_1fr] gap-6 max-[700px]:grid-cols-1";
const measureGrid = "grid grid-cols-[1fr_auto_1fr] items-end gap-[18px] max-[700px]:grid-cols-1";
const unitInput = "flex border border-line-strong [&_b]:p-[15px] [&_b]:font-mono [&_b]:text-xs [&_b]:font-medium [&_b]:text-[#5e655f] [&_input]:min-w-0 [&_input]:border-0";
const labelText = "font-mono text-xs font-medium leading-[1.3] tracking-[.08em] uppercase";
const revisionBadge = "border border-positive px-3 py-[9px] font-mono text-[11px] font-medium leading-[1.3] tracking-[.08em] text-positive uppercase";
const unmatchedBadge = "border border-warning px-[11px] py-2 font-mono text-[11px] font-medium tracking-[.08em] text-warning uppercase";
const notesBlock = "border-b border-line py-7 [&_p]:mb-0 [&_p]:whitespace-pre-wrap";
const linkingPanel = "mt-[42px] border-t-[3px] border-ink pt-[22px]";
const suggestionCard = "border border-line bg-surface p-[clamp(22px,4vw,34px)] [&>div:first-child]:grid [&>div:first-child]:gap-1.5 [&_small]:text-muted [&_strong]:text-2xl [&_strong]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:leading-[1.8]";
const sectionHeading = "mb-[18px] flex items-start justify-between gap-6 max-[700px]:flex-col [&>div]:grid [&>div]:gap-3 [&_code]:text-muted [&_h2]:m-0 [&_h2]:text-[clamp(26px,4vw,42px)] [&_h2]:font-bold [&_h2]:tracking-[-.04em]";
const secondaryButton = "border! border-ink! bg-transparent! text-ink! hover:bg-ink! hover:text-white!";
const disclosurePanel = "border border-line bg-surface px-[clamp(18px,4vw,30px)] py-5 [&_summary]:flex [&_summary]:cursor-pointer [&_summary]:items-center [&_summary]:justify-between [&_summary]:gap-4 [&_summary]:font-mono [&_summary]:text-xs [&_summary]:font-semibold [&_summary]:tracking-[.06em] [&_summary]:uppercase [&_summary:focus-visible]:outline-3 [&_summary:focus-visible]:outline-focus [&_summary:focus-visible]:outline-offset-3 [&_summary_span]:rounded-full [&_summary_span]:bg-ink [&_summary_span]:px-2.5 [&_summary_span]:py-1 [&_summary_span]:text-white";

function plannedRunId(): string | null {
  const match = window.location.pathname.match(/^\/planned-runs\/([^/]+)$/);
  return match ? match[1] : null;
}

function activityId(): string | null {
  const match = window.location.pathname.match(/^\/activities\/([^/]+)$/);
  return match && match[1] !== "new" ? match[1] : null;
}

function route(): "run" | "records" | "activity-list" | "activity-new" | "activity-import" | "activity-detail" {
  if (window.location.pathname === "/records") return "records";
  if (window.location.pathname === "/activities") return "activity-list";
  if (window.location.pathname === "/activities/new") return "activity-new";
  if (window.location.pathname === "/activities/import") return "activity-import";
  if (activityId()) return "activity-detail";
  return "run";
}

function localOffset(): string {
  return offsetForDate(new Date());
}

function offsetForDate(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDateTime(date = new Date()): string {
  return `${localDate(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function localDateTimeFromInstant(value: string): string {
  const date = new Date(value);
  const base = localDateTime(date);
  if (!date.getSeconds() && !date.getMilliseconds()) return base;
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = date.getMilliseconds();
  return `${base}:${seconds}${milliseconds ? `.${String(milliseconds).padStart(3, "0")}` : ""}`;
}

function offsetForLocalInstant(value: string): string {
  const selected = new Date(value);
  return Number.isNaN(selected.getTime()) ? localOffset() : offsetForDate(selected);
}

type OptionalMeasurement = number | null | undefined;

function normalizeMeasurement(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeActivity(activity: CompletedActivity): CompletedActivity {
  return {
    ...activity,
    distance_metres: normalizeMeasurement(activity.distance_metres),
    original_values: {
      ...activity.original_values,
      distance_metres: normalizeMeasurement(activity.original_values.distance_metres),
    },
  };
}

function normalizeEvidence(evidence: LinkEvidence): LinkEvidence {
  return {
    ...evidence,
    total_distance_metres: normalizeMeasurement(evidence.total_distance_metres),
    duration_difference_seconds: normalizeMeasurement(evidence.duration_difference_seconds),
    distance_difference_metres: normalizeMeasurement(evidence.distance_difference_metres),
    links: evidence.links.map((item) => ({ ...item, activity: normalizeActivity(item.activity) })),
  };
}

function formatDuration(seconds: OptionalMeasurement, missing = "Not prescribed"): string {
  if (seconds == null || !Number.isFinite(seconds)) return missing;
  if (seconds === 0) return "0 sec";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours && `${hours} hr`, minutes && `${minutes} min`, remainder && `${remainder} sec`].filter(Boolean).join(" ");
}

function formatDistance(metres: OptionalMeasurement, missing = "Not recorded"): string {
  if (metres == null || !Number.isFinite(metres)) return missing;
  return `${metres / 1000} km`;
}

function formatDifference(value: OptionalMeasurement, unit: "seconds" | "metres"): string {
  if (value == null || !Number.isFinite(value)) return "Not comparable";
  const direction = value === 0 ? "On prescription" : value > 0 ? "under prescription" : "over prescription";
  const amount = unit === "seconds" ? formatDuration(Math.abs(value)) : formatDistance(Math.abs(value));
  return value === 0 ? direction : `${amount} ${direction}`;
}

function MeasureComparison({
  label,
  planned,
  actual,
  difference,
  format,
}: {
  label: "Duration" | "Distance";
  planned: OptionalMeasurement;
  actual: OptionalMeasurement;
  difference: OptionalMeasurement;
  format: (value: OptionalMeasurement, missing?: string) => string;
}) {
  if (planned == null || actual == null || difference == null) {
    return (
      <section className="border border-line bg-canvas p-5" aria-label={`${label} comparison`}>
        <h3 className="m-0 text-xl">{label}</h3>
        <p className="mb-0 text-muted">Not comparable. Planned and complete actual {label.toLowerCase()} are both required.</p>
      </section>
    );
  }
  const maximum = Math.max(planned, actual, 1);
  const text = `Planned ${format(planned)}. Actual ${format(actual)}. ${formatDifference(difference, label === "Duration" ? "seconds" : "metres")}.`;
  return (
    <figure className="m-0 border border-line bg-canvas p-5" aria-label={`${label} comparison: ${text}`}>
      <h3 className="mt-0 mb-4 text-xl">{label}</h3>
      <div className="grid gap-3" aria-hidden="true">
        <div className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 max-[480px]:grid-cols-[4rem_1fr]">
          <span className={labelText}>Planned</span><span className="h-3 bg-line"><span className="block h-full bg-ink" style={{ width: `${(planned / maximum) * 100}%` }} /></span><strong className="max-[480px]:col-start-2">{format(planned)}</strong>
        </div>
        <div className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 max-[480px]:grid-cols-[4rem_1fr]">
          <span className={labelText}>Actual</span><span className="h-3 bg-line"><span className="block h-full bg-accent" style={{ width: `${(actual / maximum) * 100}%` }} /></span><strong className="max-[480px]:col-start-2">{format(actual)}</strong>
        </div>
      </div>
      <figcaption className="mt-4 leading-relaxed">{text}</figcaption>
    </figure>
  );
}

function formatActivityValue(field: string, value: unknown): string {
  if (field === "duration_seconds") return formatDuration(normalizeMeasurement(value), "Not recorded");
  if (field === "distance_metres") return formatDistance(normalizeMeasurement(value));
  if (field === "start_instant" && typeof value === "string") return new Date(value).toLocaleString();
  if (field === "modality" && typeof value === "string") return value.replace("_", " ");
  return value == null || value === "" ? "Not recorded" : String(value);
}

export function App() {
  const currentRoute = route();
  const [run, setRun] = useState<PlannedRun | null>(null);
  const [activity, setActivity] = useState<CompletedActivity | null>(null);
  const [activities, setActivities] = useState<CompletedActivity[]>([]);
  const [activityLinking, setActivityLinking] = useState<ActivityLinking | null>(null);
  const [plannedRuns, setPlannedRuns] = useState<PlannedRun[]>([]);
  const [recordEvidence, setRecordEvidence] = useState<Record<string, LinkEvidence>>({});
  const [evidence, setEvidence] = useState<LinkEvidence | null>(null);
  const [loading, setLoading] = useState(Boolean(plannedRunId() || activityId() || currentRoute === "activity-list" || currentRoute === "records"));
  const [recordsLoadFailed, setRecordsLoadFailed] = useState(false);
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function confirmTransiently(message: string) {
    setStatus(message);
    window.setTimeout(() => setStatus((current) => current === message ? "" : current), 5000);
  }

  useEffect(() => {
    const runId = plannedRunId();
    const completedActivityId = activityId();
    if (currentRoute === "records") {
      setRecordsLoadFailed(false);
      Promise.all([fetch("/api/planned-runs"), fetch("/api/activities")])
        .then(async ([plansResponse, activitiesResponse]) => {
          if (!plansResponse.ok || !activitiesResponse.ok) throw new Error("Saved training records could not be loaded.");
          const plans = (await plansResponse.json()) as PlannedRun[];
          const evidenceResponses = await Promise.all(plans.map((plan) => fetch(`/api/planned-runs/${plan.id}/linking`)));
          if (evidenceResponses.some((response) => !response.ok)) throw new Error("Saved training records could not be loaded.");
          const evidenceItems = (await Promise.all(evidenceResponses.map((response) => response.json() as Promise<LinkEvidence>))).map(normalizeEvidence);
          setPlannedRuns(plans);
          setActivities(((await activitiesResponse.json()) as CompletedActivity[]).map(normalizeActivity));
          setRecordEvidence(Object.fromEntries(evidenceItems.map((item) => [item.planned_run.id, item])));
        })
        .catch((error: Error) => {
          setRecordsLoadFailed(true);
          setStatus(error.message);
        })
        .finally(() => setLoading(false));
      return;
    }
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
          setEvidence(normalizeEvidence((await evidenceResponse.json()) as LinkEvidence));
        }
        else if (completedActivityId) {
          setActivity(normalizeActivity(result as CompletedActivity));
          await refreshActivityLinking(completedActivityId);
        }
        else setActivities((result as CompletedActivity[]).map(normalizeActivity));
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
    await refreshEvidence(created.id);
    confirmTransiently("Saved. This Planned Run is in your local record.");
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
      title: String(form.get("title") ?? "") || null,
      notes: String(form.get("notes") ?? "") || null,
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
    setActivity(normalizeActivity(created));
    if (await refreshActivityLinking(created.id)) confirmTransiently("Saved. Matching evaluated; review the result below.");
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
    setActivity(normalizeActivity(imported));
    if (await refreshActivityLinking(imported.id)) confirmTransiently("Imported. Matching evaluated; review the result below.");
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
    const nextLinking = (await linkingResponse.json()) as ActivityLinking;
    setActivity(normalizeActivity((await activityResponse.json()) as CompletedActivity));
    setActivityLinking(nextLinking);
    setPlannedRuns((await plansResponse.json()) as PlannedRun[]);
    setEvidence(null);
    if (nextLinking.link) await refreshEvidence(nextLinking.link.planned_run.id);
    return true;
  }

  async function confirmCandidate(plannedSessionId: string): Promise<boolean> {
    if (!activity) return false;
    setErrors({});
    const response = await fetch(
      `/api/activities/${activity.id}/linking/candidates/${plannedSessionId}/confirm`,
      { method: "POST" },
    );
    if (!response.ok) {
      const result = (await response.json()) as { detail?: unknown };
      setErrors({ [`link-${plannedSessionId}`]: typeof result.detail === "string" ? result.detail : "The candidate is no longer eligible." });
      setStatus("Link was not confirmed. Review the conflict.");
      return false;
    }
    await refreshActivityLinking(activity.id);
    confirmTransiently("Link confirmed. Session Outcome remains not recorded.");
    return true;
  }

  async function createDirectLink(event: FormEvent<HTMLFormElement>): Promise<boolean> {
    event.preventDefault();
    if (!activity) return false;
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
      return false;
    }
    await refreshActivityLinking(activity.id);
    confirmTransiently("Direct Link created for the complete activity. Session Outcome remains not recorded.");
    return true;
  }

  async function changeDirectLink(event: FormEvent<HTMLFormElement>): Promise<boolean> {
    event.preventDefault();
    if (!activity) return false;
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
      return false;
    }
    await refreshActivityLinking(activity.id);
    confirmTransiently("Link changed. The complete activity now belongs to the selected Planned Run.");
    return true;
  }

  async function removeDirectLink(): Promise<boolean> {
    if (!activity) return false;
    const response = await fetch(`/api/activities/${activity.id}/linking/link`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_version: activityLinking?.link?.link.version }),
    });
    if (!response.ok) {
      const result = (await response.json()) as { detail?: string };
      setStatus(result.detail || "Link could not be removed.");
      return false;
    }
    await refreshActivityLinking(activity.id);
    confirmTransiently("Link removed. The observed evidence remains in the local record.");
    return true;
  }

  async function resolveLegacy(plannedSessionId: string | null): Promise<boolean> {
    if (!activity) return false;
    const response = await fetch(`/api/activities/${activity.id}/linking/legacy-resolution`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planned_session_id: plannedSessionId }),
    });
    if (!response.ok) {
      const result = (await response.json()) as { detail?: string };
      setStatus(result.detail || "Legacy Links could not be resolved.");
      return false;
    }
    await refreshActivityLinking(activity.id);
    confirmTransiently(plannedSessionId ? "Legacy Links resolved to the selected Planned Run. Preserved relationships remain in history." : "Legacy Links resolved with no current Link. Preserved relationships remain in history.");
    return true;
  }

  async function editActivity(changes: Array<{ field_name: string; replacement_value: string | number | null }>, reason: string): Promise<boolean> {
    if (!activity) return false;
    setErrors({});
    const response = await fetch(`/api/activities/${activity.id}/corrections/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes, reason }),
    });
    if (!response.ok) {
      const result = (await response.json()) as { detail?: string | Array<{ loc?: Array<string | number>; msg?: string }> };
      const detail = typeof result.detail === "string" ? result.detail : result.detail?.[0]?.msg;
      const invalidIndex = typeof result.detail === "string" ? null : result.detail?.[0]?.loc?.find((part) => typeof part === "number");
      const invalidField = typeof invalidIndex === "number" ? changes[invalidIndex]?.field_name : changes.find((change) => detail?.toLowerCase().includes(change.field_name.split("_")[0]))?.field_name;
      setErrors({ [invalidField ? `edit-${invalidField}` : "correction"]: detail || "Correction was not recorded." });
      setStatus("Correction was not recorded. Review the highlighted fields.");
      return false;
    }
    await refreshActivityLinking(activity.id);
    confirmTransiently("Activity updated. Source values and prior changes remain preserved.");
    return true;
  }

  async function exportRecord() {
    setErrors({});
    setStatus("Preparing portable Stage 1 record...");
    const response = await fetch("/api/export", { method: "POST" });
    if (!response.ok) {
      setStatus("Export was not created. The local record is unchanged.");
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const download = document.createElement("a");
    download.href = url;
    download.download = "tempo-stage1-export.zip";
    download.click();
    URL.revokeObjectURL(url);
    confirmTransiently("Export downloaded: complete Stage 1 record and retained raw inputs.");
  }

  async function refreshEvidence(plannedSessionId: string): Promise<boolean> {
    const response = await fetch(`/api/planned-runs/${plannedSessionId}/linking`);
    if (!response.ok) {
      setStatus("Session details could not be loaded.");
      return false;
    }
    setEvidence(normalizeEvidence((await response.json()) as LinkEvidence));
    return true;
  }

  async function recordOutcome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const plannedSessionId = currentRoute === "run" ? run?.id : activityLinking?.link?.planned_run.id;
    if (!plannedSessionId) return;
    setErrors({});
    const form = new FormData(event.currentTarget);
    const reason = form.get("reason");
    const response = await fetch(`/api/planned-runs/${plannedSessionId}/outcomes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disposition: form.get("disposition"), reason: reason === null ? null : String(reason) || null }),
    });
    if (!response.ok) {
      setErrors({ outcome: "Session Outcome was not recorded. Review the selected disposition." });
      setStatus("Session Outcome was not recorded.");
      return;
    }
    if (await refreshEvidence(plannedSessionId)) confirmTransiently("Session Outcome recorded. Links remain separate evidence.");
  }

  async function recordCheckIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const plannedSessionId = currentRoute === "run" ? run?.id : activityLinking?.link?.planned_run.id;
    if (!plannedSessionId) return;
    setErrors({});
    const form = new FormData(event.currentTarget);
    const optionalNumber = (name: string) => {
      const value = String(form.get(name));
      return value === "" ? null : Number(value);
    };
    const response = await fetch(`/api/planned-runs/${plannedSessionId}/check-ins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        readiness: optionalNumber("readiness"),
        post_session_effort: optionalNumber("post_session_effort"),
        feel: optionalNumber("feel"),
        notes: String(form.get("notes")) || null,
      }),
    });
    if (!response.ok) {
      setErrors({ checkIn: "Record at least one valid athlete-reported observation." });
      setStatus("Check-in was not recorded. Review the highlighted fields.");
      return;
    }
    if (await refreshEvidence(plannedSessionId)) confirmTransiently("Check-in recorded as an athlete-reported observation.");
  }

  const showingActivity = currentRoute !== "run" || activity !== null;

  return (
    <main className="mx-auto w-[min(1040px,calc(100%-40px))] pb-20 text-ink max-[700px]:w-[min(100%-24px,600px)] [&_a:focus-visible]:outline-3 [&_a:focus-visible]:outline-focus [&_a:focus-visible]:outline-offset-3 [&_button]:mt-7 [&_button]:cursor-pointer [&_button]:border-0 [&_button]:bg-accent [&_button]:px-[22px] [&_button]:py-[17px] [&_button]:font-sans [&_button]:text-[15px] [&_button]:font-bold [&_button]:text-white [&_button:hover]:bg-accent-strong [&_button:focus-visible]:outline-3 [&_button:focus-visible]:outline-focus [&_button:focus-visible]:outline-offset-3 [&_button_span]:ml-10 [&_dd]:m-0 [&_dd]:text-[19px] [&_dd]:font-bold [&_dd]:capitalize [&_dl]:m-0 [&_dl]:grid [&_dl]:grid-cols-4 max-[700px]:[&_dl]:grid-cols-2 [&_dl>div]:border-b [&_dl>div]:border-line [&_dl>div]:py-7 [&_dl>div]:pr-5 [&_dt]:mb-2.5 [&_dt]:font-mono [&_dt]:text-xs [&_dt]:font-medium [&_dt]:leading-[1.3] [&_dt]:tracking-[.08em] [&_dt]:text-[#697069] [&_dt]:uppercase [&_h1]:my-5 [&_h1]:text-[clamp(48px,8vw,88px)] [&_h1]:leading-[.95] [&_h1]:font-bold [&_h1]:tracking-[-.065em] [&_input]:w-full [&_input]:rounded-none [&_input]:border [&_input]:border-line-strong [&_input]:bg-surface [&_input]:p-3.5 [&_input]:font-sans [&_input]:text-base [&_input]:font-semibold [&_input]:text-ink [&_input:focus-visible]:outline-3 [&_input:focus-visible]:outline-focus [&_input:focus-visible]:outline-offset-3 [&_label]:grid [&_label]:gap-2.5 [&_label]:font-mono [&_label]:text-xs [&_label]:font-medium [&_label]:leading-[1.3] [&_label]:tracking-[.04em] [&_label]:uppercase [&_select]:w-full [&_select]:rounded-none [&_select]:border [&_select]:border-line-strong [&_select]:bg-surface [&_select]:p-3.5 [&_select]:font-sans [&_select]:text-base [&_select]:font-semibold [&_select]:text-ink [&_select:focus-visible]:outline-3 [&_select:focus-visible]:outline-focus [&_select:focus-visible]:outline-offset-3 [&_textarea]:w-full [&_textarea]:resize-y [&_textarea]:rounded-none [&_textarea]:border [&_textarea]:border-line-strong [&_textarea]:bg-surface [&_textarea]:p-3.5 [&_textarea]:font-sans [&_textarea]:text-base [&_textarea]:font-semibold [&_textarea]:text-ink [&_textarea:focus-visible]:outline-3 [&_textarea:focus-visible]:outline-focus [&_textarea:focus-visible]:outline-offset-3">
      <header className="flex h-[88px] items-center justify-between border-b border-line max-[700px]:h-[70px]">
        <a className="text-[25px] font-bold tracking-[-.08em] text-ink no-underline after:ml-0.5 after:text-accent after:content-['/']" href="/" aria-label="Tempo home">tempo</a>
        <nav className="flex gap-6 max-[700px]:absolute max-[700px]:top-[82px] max-[700px]:right-3 max-[700px]:left-3 max-[700px]:justify-between max-[700px]:gap-2.5 [&_a]:font-mono [&_a]:text-xs [&_a]:font-medium [&_a]:text-[#39433c] [&_a]:uppercase [&_a]:underline-offset-[5px] max-[700px]:[&_a]:text-[10px]" aria-label="Primary">
          <a href="/records">Records</a>
          <a href="/">Plan a run</a>
          <a href="/activities/new">Record activity</a>
          <a href="/activities/import">Import FIT</a>
        </nav>
        <span className="font-mono text-xs font-medium leading-[1.3] tracking-[.08em] uppercase before:mr-2 before:text-positive before:content-['●']">Local record</span>
      </header>
      <section className="max-w-[760px] pt-16 pb-[30px] max-[700px]:pt-[42px]">
        <p className="font-mono text-xs font-medium leading-[1.3] tracking-[.08em] text-accent-strong uppercase">{currentRoute === "records" ? "Local record / Stage 1" : showingActivity ? "Evidence / Completed Activities" : "Planning / Running"}</p>
        <h1>{activity ? "Completed Activity" : currentRoute === "records" ? "Training records." : currentRoute === "activity-list" ? "Observed work." : currentRoute === "activity-new" ? "Record what happened." : currentRoute === "activity-import" ? "Import observed work." : run ? "Planned Run" : "Set the intention."}</h1>
        <p className="max-w-[620px] text-[19px] leading-[1.55] text-[#4f574f]">
          {activity
            ? activity.link_status === "linked"
              ? "This observed training evidence has one explicit whole-activity Link."
              : activity.link_status === "legacy_unresolved"
                ? "Prior relationships are preserved and await your explicit resolution; no current Link has been chosen."
              : "This is observed training evidence. It remains unmatched until you explicitly link it later."
            : currentRoute === "records"
              ? "Review every saved Planned Run and Completed Activity without turning your record into a calendar."
            : currentRoute === "activity-list"
              ? "Manual training evidence remains legitimate whether or not it matches a Planned Session."
              : currentRoute === "activity-new"
                ? "Enter observed training without treating it as proof that a Planned Session was completed."
              : currentRoute === "activity-import"
                ? "Import a Garmin running FIT file while retaining its raw source and provenance."
                : run
            ? "Review the intended training, linked evidence, and athlete-reported Outcome together."
            : "Record what you intend to do. Evidence of what happened stays separate."}
        </p>
      </section>
      <p className="mb-[18px] min-h-6 font-mono text-[13px] font-medium" role="status" aria-live="polite">{loading ? "Loading local record..." : status}</p>
      {activity ? <ActivityDetail activity={activity} linking={activityLinking} plannedRuns={plannedRuns} evidence={evidence} errors={errors} onConfirm={confirmCandidate} onCreateDirect={createDirectLink} onChange={changeDirectLink} onRemove={removeDirectLink} onResolveLegacy={resolveLegacy} onRecordOutcome={recordOutcome} onRecordCheckIn={recordCheckIn} onEdit={editActivity} onNoChanges={() => confirmTransiently("No changes to save.")} /> : currentRoute === "records" && !loading ? recordsLoadFailed ? <section className="border border-danger bg-surface p-[clamp(22px,4vw,38px)]" role="alert"><h2 className="mt-0 text-2xl">Training records unavailable</h2><p>Tempo could not load your saved records. Nothing has been removed; reload the page to try again.</p></section> : <RecordsView plannedRuns={plannedRuns} activities={activities} evidence={recordEvidence} onExport={exportRecord} /> : currentRoute === "activity-list" && !loading ? <ActivityList activities={activities} /> : currentRoute === "activity-new" ? <ActivityForm onSubmit={createActivity} errors={errors} /> : currentRoute === "activity-import" ? <ImportForm onSubmit={importActivity} errors={errors} /> : run ? <RunDetail run={run} evidence={evidence} errors={errors} onRecordOutcome={recordOutcome} onRecordCheckIn={recordCheckIn} /> : !loading && <RunForm onSubmit={createRun} errors={errors} />}
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
    <form className={formPanel} onSubmit={onSubmit} noValidate>
      <label>
        <span>Garmin FIT activity</span>
        <input name="file" type="file" accept=".fit,application/octet-stream" required aria-invalid={Boolean(errors.file)} aria-describedby={errors.file ? "fit-file-help fit-file-error" : "fit-file-help"} />
        <small id="fit-file-help" className={helpText}>Stage 1 supports running activity files only.</small>
        {errors.file && <small id="fit-file-error" className={errorText}>{errors.file}</small>}
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
  const [startLocal, setStartLocal] = useState(localDateTime);
  const [overrideOffset, setOverrideOffset] = useState(false);
  const [customOffset, setCustomOffset] = useState(localOffset);
  const derivedOffset = offsetForLocalInstant(startLocal);
  return (
    <form className={formPanel} onSubmit={onSubmit} noValidate>
      <div className="grid grid-cols-[.8fr_1.2fr] gap-6 max-[700px]:grid-cols-1">
        <label>
          <span>Modality</span>
          <select name="modality" defaultValue="running" aria-invalid={Boolean(errors.modality)} aria-describedby={errors.modality ? "activity-modality-error" : undefined}>
            <option value="running">Running</option>
            <option value="cycling">Cycling</option>
            <option value="strength">Strength</option>
            <option value="other">Other</option>
          </select>
          <small id="activity-modality-error" className={`${errorText} min-h-5 ${errors.modality ? "" : "invisible"}`} aria-hidden={!errors.modality}>{errors.modality || "No error"}</small>
        </label>
        <label>
          <span>Local start</span>
          <input name="start_local" type="datetime-local" required value={startLocal} onChange={(event) => setStartLocal(event.currentTarget.value)} aria-invalid={Boolean(errors.start_instant)} aria-describedby={errors.start_instant ? "activity-start-error" : "activity-time-help"} />
          <small id="activity-time-help" className={helpText}>Timezone detected for this local time: UTC{derivedOffset}</small>
          <small id="activity-start-error" className={`${errorText} min-h-5 ${errors.start_instant ? "" : "invisible"}`} aria-hidden={!errors.start_instant}>{errors.start_instant || "No error"}</small>
        </label>
      </div>
      <details className="mt-5 border-y border-line py-4 open:px-4 open:pb-5 [&_summary]:cursor-pointer [&_summary]:font-mono [&_summary]:text-xs [&_summary]:font-semibold [&_summary]:tracking-[.04em] [&_summary]:uppercase [&_summary:focus-visible]:outline-3 [&_summary:focus-visible]:outline-focus [&_summary:focus-visible]:outline-offset-3">
        <summary>Advanced: use a different UTC offset</summary>
        <label className="mt-5">
          <span>UTC offset override</span>
          <input className="w-auto!" type="checkbox" checked={overrideOffset} onChange={(event) => setOverrideOffset(event.currentTarget.checked)} />
          <small className={helpText}>Enable only when the activity occurred in a timezone different from this browser.</small>
        </label>
        {overrideOffset && <label className="mt-5">
          <span>UTC offset</span>
          <input name="utc_offset" type="text" required pattern="[+-][0-9]{2}:[0-9]{2}" value={customOffset} onChange={(event) => setCustomOffset(event.currentTarget.value)} aria-invalid={Boolean(errors.utc_offset)} aria-describedby="offset-help offset-error" />
          <small id="offset-help" className={helpText}>Format: +05:30 or -04:00</small>
          <small id="offset-error" className={`${errorText} min-h-5 ${errors.utc_offset ? "" : "invisible"}`} aria-hidden={!errors.utc_offset}>{errors.utc_offset || "No error"}</small>
        </label>}
      </details>
      {!overrideOffset && <input name="utc_offset" type="hidden" value={derivedOffset} />}
      <fieldset>
        <legend>Training details</legend>
        <div className="grid grid-cols-2 gap-6 max-[700px]:grid-cols-1">
          <label><span>Duration</span><span className={unitInput}><input name="duration_minutes" type="number" min="0.0167" step="0.0167" required aria-invalid={Boolean(errors.duration_seconds)} aria-describedby="activity-duration-error" /><b>min</b></span><small id="activity-duration-error" className={`${errorText} min-h-5 ${errors.duration_seconds ? "" : "invisible"}`} aria-hidden={!errors.duration_seconds}>{errors.duration_seconds || "No error"}</small></label>
          <label><span>Distance <i className="float-right not-italic text-muted normal-case">Optional</i></span><span className={unitInput}><input name="distance_kilometres" type="number" min="0.001" step="0.001" aria-invalid={Boolean(errors.distance_metres)} aria-describedby="activity-distance-error" /><b>km</b></span><small id="activity-distance-error" className={`${errorText} min-h-5 ${errors.distance_metres ? "" : "invisible"}`} aria-hidden={!errors.distance_metres}>{errors.distance_metres || "No error"}</small></label>
        </div>
      </fieldset>
      <label>
        <span>Title <i className="float-right not-italic text-muted normal-case">Optional</i></span>
        <input name="title" type="text" maxLength={200} aria-invalid={Boolean(errors.title)} aria-describedby="activity-title-error" />
        <small id="activity-title-error" className={`${errorText} min-h-5 ${errors.title ? "" : "invisible"}`} aria-hidden={!errors.title}>{errors.title || "No error"}</small>
      </label>
      <label className="mt-6">
        <span>Notes <i className="float-right not-italic text-muted normal-case">Optional</i></span>
        <textarea name="notes" rows={4} maxLength={2000} aria-invalid={Boolean(errors.notes)} aria-describedby="activity-notes-error" />
        <small id="activity-notes-error" className={`${errorText} min-h-5 ${errors.notes ? "" : "invisible"}`} aria-hidden={!errors.notes}>{errors.notes || "No error"}</small>
      </label>
      <button type="submit">Save Completed Activity <span aria-hidden="true">→</span></button>
    </form>
  );
}

function ActivityList({ activities }: { activities: CompletedActivity[] }) {
  if (activities.length === 0) {
    return <section className="border border-line bg-surface p-[38px]"><p>No Completed Activities recorded yet.</p><a className="mt-3 inline-block bg-accent px-[18px] py-3.5 font-bold text-white no-underline" href="/activities/new">Record an activity</a></section>;
  }
  return (
    <section className="grid border-t border-line-strong [&>a]:flex [&>a]:items-center [&>a]:justify-between [&>a]:gap-6 [&>a]:border-b [&>a]:border-line [&>a]:px-2 [&>a]:py-6 [&>a]:text-ink [&>a]:no-underline [&>a:hover]:bg-surface [&>a>span:first-child]:grid [&>a>span:first-child]:gap-[7px] [&_b]:text-[19px] [&_b]:capitalize [&_small]:text-[#5e655f]" aria-label="Completed Activities">
      {activities.map((activity) => (
        <a href={`/activities/${activity.id}`} key={activity.id}>
          <span><b>{activity.title || `${activity.modality} activity`}</b><small className="capitalize">{activity.modality} / {new Date(activity.start_instant).toLocaleString()}</small></span>
          <span className={activity.link_status === "unmatched" ? unmatchedBadge : revisionBadge}>{linkStatusLabels[activity.link_status]}</span>
        </a>
      ))}
    </section>
  );
}

function RecordsView({
  plannedRuns,
  activities,
  evidence,
  onExport,
}: {
  plannedRuns: PlannedRun[];
  activities: CompletedActivity[];
  evidence: Record<string, LinkEvidence>;
  onExport: () => void;
}) {
  const recordList = "grid border-t border-line-strong [&>a]:flex [&>a]:items-center [&>a]:justify-between [&>a]:gap-6 [&>a]:border-b [&>a]:border-line [&>a]:px-2 [&>a]:py-6 [&>a]:text-ink [&>a]:no-underline [&>a:hover]:bg-surface max-[700px]:[&>a]:items-start max-[700px]:[&>a]:flex-col [&>a>span:first-child]:grid [&>a>span:first-child]:gap-[7px] [&_b]:text-[19px] [&_b]:capitalize [&_small]:text-[#5e655f]";
  const emptyState = "border border-line bg-surface p-[clamp(22px,4vw,38px)] [&_a]:font-bold";
  return (
    <>
      <section className="mb-12" aria-labelledby="planned-records-heading">
        <div className={sectionHeading}><div><span className={revisionBadge}>Intended training</span><h2 id="planned-records-heading">Planned Sessions</h2></div></div>
        {plannedRuns.length === 0 ? <div className={emptyState}><p>No Planned Runs saved yet.</p><a href="/">Plan a run</a></div> : (
          <div className={recordList} aria-label="Planned Sessions">
            {plannedRuns.map((plannedRun) => {
              const linkCount = evidence[plannedRun.id]?.links.length ?? 0;
              return <a href={`/planned-runs/${plannedRun.id}`} key={plannedRun.id}><span><b>{intentLabels[plannedRun.training_intent]}</b><small>{plannedRun.scheduled_date} / {plannedRun.modality}</small></span><span className={linkCount ? revisionBadge : unmatchedBadge}>{linkCount ? `${linkCount} linked ${linkCount === 1 ? "activity" : "activities"}` : "No linked activities"}</span></a>;
            })}
          </div>
        )}
      </section>
      <section className="mb-12" aria-labelledby="activity-records-heading">
        <div className={sectionHeading}><div><span className={revisionBadge}>Observed training</span><h2 id="activity-records-heading">Completed Activities</h2></div></div>
        {activities.length === 0 ? <div className={emptyState}><p>No Completed Activities saved yet.</p><div className="flex gap-5 max-[700px]:flex-col"><a href="/activities/new">Record an activity</a><a href="/activities/import">Import a FIT activity</a></div></div> : <ActivityList activities={activities} />}
      </section>
      <section className="border-t border-line-strong pt-7" aria-labelledby="data-export-heading">
        <h2 id="data-export-heading" className="text-2xl">Keep a portable copy</h2>
        <p>Download your complete Stage 1 record and retained raw inputs.</p>
        <button type="button" className={secondaryButton} onClick={onExport}>Export my data</button>
      </section>
    </>
  );
}

function ActivityEditForm({
  activity,
  errors,
  onCancel,
  onNoChanges,
  onSave,
  headingRef,
}: {
  activity: CompletedActivity;
  errors: Record<string, string>;
  onCancel: () => void;
  onNoChanges: () => void;
  onSave: (changes: Array<{ field_name: string; replacement_value: string | number | null }>, reason: string) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const [startLocal, setStartLocal] = useState(localDateTimeFromInstant(activity.start_instant));
  const [reasonMissing, setReasonMissing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [headingRef]);
  const fieldError = (field: string) => errors[`edit-${field}`];
  useEffect(() => {
    if (Object.keys(errors).some((key) => key.startsWith("edit-"))) {
      formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
    }
  }, [errors]);
  const original = {
    modality: activity.modality,
    start_instant: activity.start_instant,
    duration_seconds: activity.duration_seconds,
    distance_metres: activity.distance_metres,
    title: activity.title,
    notes: activity.notes,
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const distanceInput = String(form.get("distance_kilometres"));
    const next = {
      modality: String(form.get("modality")),
      start_instant: `${startLocal}${offsetForLocalInstant(startLocal)}`,
      duration_seconds: Math.round(Number(form.get("duration_minutes")) * 60),
      distance_metres: distanceInput === "" ? null : Math.round(Number(distanceInput) * 1000),
      title: String(form.get("title") ?? "") || null,
      notes: String(form.get("notes") ?? "") || null,
    };
    const changes = (Object.keys(next) as Array<keyof typeof next>)
      .filter((field) => {
        if (field === "start_instant") return new Date(next[field]).getTime() !== new Date(original[field]).getTime();
        return next[field] !== original[field];
      })
      .map((field) => ({ field_name: field, replacement_value: next[field] }));
    if (changes.length === 0) {
      onNoChanges();
      return;
    }
    const reason = String(form.get("reason")).trim();
    if (!reason) {
      setReasonMissing(true);
      return;
    }
    if (!event.currentTarget.checkValidity()) {
      event.currentTarget.reportValidity();
      return;
    }
    onSave(changes, reason);
  }

  return (
    <section className="mt-8 border-t-[3px] border-accent pt-6" aria-labelledby="edit-activity-heading">
      <div className={sectionHeading}><div><span className={revisionBadge}>Current activity</span><h2 id="edit-activity-heading" ref={headingRef} tabIndex={-1}>Edit activity</h2></div></div>
      <form ref={formRef} className={formPanel} aria-label="Edit activity" onSubmit={submit}>
        <div className="grid grid-cols-2 gap-6 max-[700px]:grid-cols-1">
          <label><span>Modality</span><select name="modality" defaultValue={activity.modality} aria-invalid={Boolean(fieldError("modality"))} aria-describedby={fieldError("modality") ? "edit-modality-error" : undefined}><option value="running">Running</option><option value="cycling">Cycling</option><option value="strength">Strength</option><option value="other">Other</option></select>{fieldError("modality") && <small id="edit-modality-error" className={errorText}>{fieldError("modality")}</small>}</label>
          <label className="min-w-0"><span>Local start</span><input className="min-w-0 max-w-full" name="start_local" type="datetime-local" step="0.001" required value={startLocal} onChange={(event) => setStartLocal(event.currentTarget.value)} aria-invalid={Boolean(fieldError("start_instant"))} aria-describedby={fieldError("start_instant") ? "edit-start-error edit-start-help" : "edit-start-help"} /><small id="edit-start-help" className={helpText}>Saved with this browser's offset for the selected local time: UTC{offsetForLocalInstant(startLocal)}</small>{fieldError("start_instant") && <small id="edit-start-error" className={errorText}>{fieldError("start_instant")}</small>}</label>
          <label><span>Duration</span><span className={unitInput}><input name="duration_minutes" type="number" min="0.0167" step="any" required defaultValue={activity.duration_seconds / 60} aria-invalid={Boolean(fieldError("duration_seconds"))} aria-describedby={fieldError("duration_seconds") ? "edit-duration-error" : undefined} /><b>min</b></span>{fieldError("duration_seconds") && <small id="edit-duration-error" className={errorText}>{fieldError("duration_seconds")}</small>}</label>
          <label><span>Distance <i className="float-right not-italic text-muted normal-case">Optional</i></span><span className={unitInput}><input name="distance_kilometres" type="number" min="0.001" step="any" defaultValue={activity.distance_metres == null ? "" : activity.distance_metres / 1000} aria-invalid={Boolean(fieldError("distance_metres"))} aria-describedby={fieldError("distance_metres") ? "edit-distance-error" : undefined} /><b>km</b></span>{fieldError("distance_metres") && <small id="edit-distance-error" className={errorText}>{fieldError("distance_metres")}</small>}</label>
        </div>
        <label className="mt-6"><span>Title</span><input name="title" maxLength={200} defaultValue={activity.title ?? ""} disabled={activity.original_values.title == null} aria-invalid={Boolean(fieldError("title"))} aria-describedby={fieldError("title") ? "edit-title-help edit-title-error" : "edit-title-help"} /><small id="edit-title-help" className={helpText}>{activity.original_values.title == null ? "A title was not present in the source activity, so Stage 1 cannot add one as a Correction." : "Edit the activity's current title."}</small>{fieldError("title") && <small id="edit-title-error" className={errorText}>{fieldError("title")}</small>}</label>
        <label className="mt-6"><span>Notes</span><textarea name="notes" rows={4} maxLength={2000} defaultValue={activity.notes ?? ""} disabled={activity.original_values.notes == null} aria-invalid={Boolean(fieldError("notes"))} aria-describedby={fieldError("notes") ? "edit-notes-help edit-notes-error" : "edit-notes-help"} /><small id="edit-notes-help" className={helpText}>{activity.original_values.notes == null ? "Notes were not present in the source activity, so Stage 1 cannot add them as a Correction." : "Edit the activity's current notes."}</small>{fieldError("notes") && <small id="edit-notes-error" className={errorText}>{fieldError("notes")}</small>}</label>
        <label className="mt-6"><span>Reason for changes</span><textarea name="reason" rows={2} maxLength={2000} onChange={() => setReasonMissing(false)} aria-invalid={reasonMissing} aria-describedby={reasonMissing ? "activity-edit-reason-help activity-edit-reason-error" : "activity-edit-reason-help"} /><small id="activity-edit-reason-help" className={helpText}>One concise reason is recorded with every changed field.</small>{reasonMissing && <small id="activity-edit-reason-error" className={errorText}>Enter a reason for the changes.</small>}</label>
        {errors.correction && <small id="activity-edit-error" className={errorText} role="alert">The activity could not be updated: {errors.correction}</small>}
        <div className="flex flex-wrap justify-end gap-3"><button type="button" className={secondaryButton} onClick={onCancel}>Cancel</button><button type="submit">Save changes</button></div>
      </form>
    </section>
  );
}

function plannedRunLabel(plannedRun: PlannedRun): string {
  return `${intentLabels[plannedRun.training_intent]} on ${plannedRun.scheduled_date}`;
}

function ActivityLinkAction({
  activity,
  linking,
  plannedRuns,
  triggerRef,
  onOpen,
}: {
  activity: CompletedActivity;
  linking: ActivityLinking;
  plannedRuns: PlannedRun[];
  triggerRef: RefObject<HTMLButtonElement | null>;
  onOpen: () => void;
}) {
  const candidates = linking.latest_match_evaluation?.candidates ?? [];
  const unresolvedLegacy = linking.legacy_resolution?.status === "unresolved";
  const compatiblePlans = activity.modality === "running" ? plannedRuns : [];
  const buttonClass = "m-0! bg-transparent! p-0! text-left! text-accent! underline underline-offset-4 hover:bg-transparent! hover:text-accent-strong!";

  return (
    <div className="mt-6 flex items-baseline gap-3 border-b border-line pb-6 font-mono text-[13px] max-[600px]:flex-col" aria-label="Link state">
      <strong>Link</strong>
      {linking.link ? <><a href={`/planned-runs/${linking.link.planned_run.id}`}>{plannedRunLabel(linking.link.planned_run)}</a><button ref={triggerRef} data-link-trigger type="button" className={buttonClass} onClick={onOpen}>Change or remove</button></> : unresolvedLegacy ? <button ref={triggerRef} data-link-trigger type="button" className={buttonClass} onClick={onOpen}>Legacy resolution required</button> : candidates.length > 1 ? <button ref={triggerRef} data-link-trigger type="button" className={buttonClass} onClick={onOpen}>Choose planned run</button> : compatiblePlans.length > 0 ? <button ref={triggerRef} data-link-trigger type="button" className={buttonClass} onClick={onOpen}>Unmatched unplanned activity</button> : <span>Unmatched unplanned activity. No compatible Planned Run is available; no action is needed.</span>}
    </div>
  );
}

function LinkDialog({
  activity,
  linking,
  plannedRuns,
  errors,
  triggerRef,
  onClose,
  onConfirm,
  onCreateDirect,
  onChange,
  onRemove,
  onResolveLegacy,
}: {
  activity: CompletedActivity;
  linking: ActivityLinking;
  plannedRuns: PlannedRun[];
  errors: Record<string, string>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onConfirm: (plannedSessionId: string) => Promise<boolean>;
  onCreateDirect: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  onChange: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
  onResolveLegacy: (plannedSessionId: string | null) => Promise<boolean>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const candidates = linking.latest_match_evaluation?.candidates ?? [];
  const compatiblePlans = activity.modality === "running" ? plannedRuns : [];
  const unresolvedLegacy = linking.legacy_resolution?.status === "unresolved";

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      window.requestAnimationFrame(() => {
        (document.querySelector("[data-link-trigger]") as HTMLButtonElement | null)?.focus();
      });
    };
  }, [triggerRef]);

  function close() {
    dialogRef.current?.close();
    onClose();
  }

  async function finish(operation: Promise<boolean>) {
    if (await operation) close();
  }

  const candidateReason = (candidate: NonNullable<ActivityLinking["latest_match_evaluation"]>["candidates"][number]) => {
    return candidate.reasons.some((reason) => reason.includes("adjacent calendar day"))
      ? "This running plan appears because matching allows the calendar day immediately before or after the activity."
      : "This running plan is on the activity date.";
  };

  return (
    <dialog ref={dialogRef} aria-labelledby="link-dialog-title" onCancel={(event) => { event.preventDefault(); close(); }} className="m-auto max-h-[min(760px,calc(100vh-32px))] w-[min(720px,calc(100%-32px))] overflow-y-auto border border-line-strong bg-canvas p-0 text-ink shadow-[10px_10px_0_var(--color-ink)] backdrop:bg-[#17211bcc] max-[600px]:w-[calc(100%-16px)] max-[600px]:shadow-none">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-line bg-ink px-[clamp(20px,5vw,38px)] py-6 text-white">
        <div><span className="font-mono text-[11px] tracking-[.1em] text-[#d7ddd8] uppercase">Whole-activity Link</span><h2 id="link-dialog-title" className="my-2 text-[clamp(27px,5vw,40px)] leading-none">{linking.link ? "Manage Link" : unresolvedLegacy ? "Resolve preserved Links" : candidates.length > 1 ? "Choose planned run" : "Link to a planned run"}</h2></div>
        <button type="button" className="m-0! border! border-white! bg-transparent! px-3! py-2! text-white! hover:bg-white! hover:text-ink!" onClick={close} aria-label="Close Link dialog">Close</button>
      </div>
      <div className="p-[clamp(20px,5vw,38px)]">
        {linking.link && <form aria-label="Change current Link" onSubmit={(event) => void finish(onChange(event))}>
          <p>Linked to <a href={`/planned-runs/${linking.link.planned_run.id}`}><strong>{plannedRunLabel(linking.link.planned_run)}</strong></a>. The Link uses the complete activity and remains separate from Session Outcome.</p>
          <label><span>Change to Planned Run</span><select name="planned_session_id" required defaultValue={linking.link.planned_run.id}>{compatiblePlans.map((plannedRun) => <option key={plannedRun.id} value={plannedRun.id}>{plannedRunLabel(plannedRun)}</option>)}</select></label>
          {errors.changeLink && <small className={errorText}>{errors.changeLink}</small>}
          <div className="flex justify-end gap-3 max-[600px]:flex-col"><button type="button" className={secondaryButton} onClick={() => void finish(onRemove())}>Remove Link</button><button type="submit">Change Link</button></div>
        </form>}
        {!linking.link && candidates.length > 1 && <section aria-label="Planned Run candidates">
          <p>Compare the eligible running plans, then confirm one. No Link exists until you choose.</p>
          <div className="grid gap-4">{candidates.map((candidate) => {
            const plannedRun = candidate.planned_run;
            const error = errors[`link-${plannedRun.id}`];
            return <article className="border border-line bg-surface p-5" key={plannedRun.id} aria-label={`Candidate ${plannedRunLabel(plannedRun)}`}>
              <h3 className="mt-0 text-2xl">{plannedRunLabel(plannedRun)}</h3>
              <p><strong>Prescription:</strong> {formatDuration(plannedRun.active_revision.duration_seconds)}{plannedRun.active_revision.distance_metres == null ? "" : ` / ${formatDistance(plannedRun.active_revision.distance_metres)}`}</p>
              <p>{candidateReason(candidate)}</p>
              {error && <small className={errorText}>{error}</small>}
              <button type="button" onClick={() => void finish(onConfirm(plannedRun.id))}>Link to this run</button>
            </article>;
          })}</div>
        </section>}
        {!linking.link && unresolvedLegacy && <section aria-label="Preserved legacy Links">
          <p>This activity previously had multiple Links. Every prior relationship and attributed amount remains preserved below. Choose at most one current Link, or choose none; this history will not be discarded.</p>
          <div className="grid gap-4">{linking.legacy_resolution!.records.map((record) => <article className="border border-line bg-surface p-5" key={record.id}><h3 className="mt-0 text-2xl">{plannedRunLabel(record.planned_run)}</h3><p>Preserved attribution: {formatDuration(record.linked_duration_seconds)}{record.linked_distance_metres == null ? "" : ` / ${formatDistance(record.linked_distance_metres)}`}</p><button type="button" onClick={() => void finish(onResolveLegacy(record.planned_session_id))}>Use this Planned Run</button></article>)}</div>
          <button type="button" className={secondaryButton} onClick={() => void finish(onResolveLegacy(null))}>Keep no current Link</button>
        </section>}
        {!linking.link && !unresolvedLegacy && candidates.length <= 1 && compatiblePlans.length > 0 && <form aria-label="Create direct Link" onSubmit={(event) => void finish(onCreateDirect(event))}>
          <p>This activity is legitimate unplanned training. You may leave it unmatched or directly choose a compatible running plan.</p>
          <label><span>Planned Run</span><select name="planned_session_id" required defaultValue=""><option value="" disabled>Choose a Planned Run</option>{compatiblePlans.map((plannedRun) => <option key={plannedRun.id} value={plannedRun.id}>{plannedRunLabel(plannedRun)}</option>)}</select></label>
          {errors.directLink && <small className={errorText}>{errors.directLink}</small>}
          <button type="submit">Link complete activity</button>
        </form>}
      </div>
    </dialog>
  );
}

function ActivityDetail({
  activity,
  linking,
  plannedRuns,
  evidence,
  errors,
  onConfirm,
  onCreateDirect,
  onChange,
  onRemove,
  onResolveLegacy,
  onRecordOutcome,
  onRecordCheckIn,
  onEdit,
  onNoChanges,
}: {
  activity: CompletedActivity;
  linking: ActivityLinking | null;
  plannedRuns: PlannedRun[];
  evidence: LinkEvidence | null;
  errors: Record<string, string>;
  onConfirm: (plannedSessionId: string) => Promise<boolean>;
  onCreateDirect: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  onChange: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
  onResolveLegacy: (plannedSessionId: string | null) => Promise<boolean>;
  onRecordOutcome: (event: FormEvent<HTMLFormElement>) => void;
  onRecordCheckIn: (event: FormEvent<HTMLFormElement>) => void;
  onEdit: (changes: Array<{ field_name: string; replacement_value: string | number | null }>, reason: string) => Promise<boolean>;
  onNoChanges: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const linkTrigger = useRef<HTMLButtonElement>(null);
  const editTrigger = useRef<HTMLButtonElement>(null);
  const editHeading = useRef<HTMLHeadingElement>(null);
  const provenance = activity.import_provenance;
  const evaluation = linking?.latest_match_evaluation;
  const candidates = evaluation?.candidates ?? [];
  return (
    <>
    <article className="overflow-hidden border border-line-strong bg-surface shadow-[8px_8px_0_var(--color-ink)] max-[700px]:shadow-none" aria-label="Activity summary">
      <div className="flex items-start justify-between gap-6 bg-ink px-[clamp(22px,5vw,46px)] py-7 text-white max-[700px]:flex-col">
        <div className="grid gap-2"><span className="font-mono text-[11px] tracking-[.12em] text-[#d7ddd8] uppercase">{provenance ? "FIT import" : "Manual entry"}</span><h2 className="m-0 text-[clamp(28px,5vw,46px)] leading-none tracking-[-.04em]">{activity.title || `${activity.modality} activity`}</h2></div>
      </div>
      <div className="p-[clamp(22px,5vw,46px)]">
        <p className="mt-0 text-[17px] font-semibold capitalize">{activity.modality} <span aria-hidden="true">·</span> {new Date(activity.start_instant).toLocaleString()}</p>
        <div className="grid grid-cols-2 gap-4 border-y border-line py-6 max-[480px]:grid-cols-1">
          <div><span className={labelText}>Duration</span><strong className="mt-2 block text-[clamp(28px,5vw,40px)]">{formatDuration(activity.duration_seconds, "Not recorded")}</strong></div>
          <div><span className={labelText}>Distance</span><strong className="mt-2 block text-[clamp(28px,5vw,40px)]">{formatDistance(activity.distance_metres)}</strong></div>
        </div>
        {activity.notes && <div className="pt-6"><span className={labelText}>Notes</span><p className="mb-0 whitespace-pre-wrap">{activity.notes}</p></div>}
        {linking && <ActivityLinkAction activity={activity} linking={linking} plannedRuns={plannedRuns} triggerRef={linkTrigger} onOpen={() => setLinkDialogOpen(true)} />}
        <button type="button" ref={editTrigger} onClick={() => setEditing(true)}>Edit activity</button>
        {linking?.link && evidence?.planned_run.id === linking.link.planned_run.id && <SessionObservations evidence={evidence} errors={errors} onRecordOutcome={onRecordOutcome} onRecordCheckIn={onRecordCheckIn} />}
      </div>
    </article>
    {editing && <ActivityEditForm activity={activity} errors={errors} headingRef={editHeading} onCancel={() => {
      setEditing(false);
      window.setTimeout(() => editTrigger.current?.focus());
    }} onNoChanges={onNoChanges} onSave={async (changes, reason) => {
      if (await onEdit(changes, reason)) {
        setEditing(false);
        window.setTimeout(() => editTrigger.current?.focus());
      }
    }} />}
    <section className="mt-8 grid gap-3" aria-label="Activity record details">
      <details className={disclosurePanel}>
        <summary>View changes <span>{activity.corrections.length}</span></summary>
        <div className="pt-5" aria-label="Correction history">{activity.corrections.length === 0 ? <p>No changes recorded.</p> : <div className="grid gap-4">{activity.corrections.map((correction) => <article className="border-l-4 border-accent pl-4" key={correction.id}><strong className="capitalize">{correction.field_name.replace("_", " ")}</strong><p className="my-1">{formatActivityValue(correction.field_name, correction.source_value)} <span aria-hidden="true">→</span> {formatActivityValue(correction.field_name, correction.replacement_value)}</p><small>{new Date(correction.recorded_at).toLocaleString()} <span aria-hidden="true">·</span> {correction.reason}</small></article>)}</div>}</div>
      </details>
      <details className={disclosurePanel}>
        <summary>Source details</summary>
        <div className="pt-5">{provenance ? <><p>This activity was imported from a retained Garmin FIT source on {new Date(provenance.imported_at).toLocaleString()}.</p><dl><div><dt>Source adapter</dt><dd>{provenance.adapter_type}</dd></div><div><dt>Source identity</dt><dd className="wrap-anywhere">{provenance.source_identity}</dd></div><div><dt>Importer</dt><dd>{provenance.importer_name} {provenance.importer_version}</dd></div><div><dt>Imported</dt><dd>{new Date(provenance.imported_at).toLocaleString()}</dd></div><div><dt>Retained raw source</dt><dd className="wrap-anywhere">{provenance.raw_file_identity}</dd></div><div><dt>Source checksum</dt><dd className="wrap-anywhere">{provenance.checksum_sha256}</dd></div></dl><h3 className="mt-7 text-xl">Original imported values</h3><dl><div><dt>Modality</dt><dd className="capitalize">{String(provenance.original_normalized_values.modality ?? "Not recorded")}</dd></div><div><dt>Start</dt><dd>{typeof provenance.original_normalized_values.start_instant === "string" ? new Date(provenance.original_normalized_values.start_instant).toLocaleString() : "Not recorded"}</dd></div><div><dt>Duration</dt><dd>{formatDuration(normalizeMeasurement(provenance.original_normalized_values.duration_seconds), "Not recorded")}</dd></div><div><dt>Distance</dt><dd>{formatDistance(normalizeMeasurement(provenance.original_normalized_values.distance_metres))}</dd></div></dl></> : <p>This activity was entered manually. No imported raw source is attached.</p>}</div>
      </details>
    </section>
    {evaluation && (
      <details className={`${disclosurePanel} mt-8`} aria-label="Technical matching audit">
        <summary>Technical matching audit</summary>
        <div className="pt-5">
          <p>{candidates.length === 0 ? "No eligible candidates were recorded; the activity was unmatched." : candidates.length === 1 ? "One eligible candidate was recorded and linked automatically." : `${candidates.length} eligible candidates were recorded for athlete selection.`} This evaluation does not record a Session Outcome.</p>
          <dl><div><dt>Algorithm version</dt><dd>{evaluation.algorithm_version}</dd></div><div><dt>Activity effective version</dt><dd>{evaluation.activity_effective_version}</dd></div><div><dt>Evaluated</dt><dd>{new Date(evaluation.evaluated_at).toLocaleString()}</dd></div></dl>
          {candidates.map((candidate, index) => <article className={suggestionCard} key={candidate.planned_run.id}><div><strong>{index + 1}. {intentLabels[candidate.planned_run.training_intent]} on {candidate.planned_run.scheduled_date}</strong><small>Candidate ID: {candidate.planned_run.id}</small></div><ul>{candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></article>)}
        </div>
      </details>
    )}
    {linking && linkDialogOpen && <LinkDialog activity={activity} linking={linking} plannedRuns={plannedRuns} errors={errors} triggerRef={linkTrigger} onClose={() => setLinkDialogOpen(false)} onConfirm={onConfirm} onCreateDirect={onCreateDirect} onChange={onChange} onRemove={onRemove} onResolveLegacy={onResolveLegacy} />}
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
    <form className={formPanel} onSubmit={onSubmit} noValidate>
      <div className={fieldGrid}>
        <label>
          <span>Local date</span>
          <input name="scheduled_date" type="date" required defaultValue={localDate()} aria-invalid={Boolean(errors.scheduled_date)} aria-describedby="date-error" />
          <small id="date-error" className={`${errorText} min-h-5 ${errors.scheduled_date ? "" : "invisible"}`} aria-hidden={!errors.scheduled_date}>{errors.scheduled_date || "No error"}</small>
        </label>
        <label>
          <span>Training intent</span>
          <select name="training_intent" defaultValue="aerobic_base" aria-invalid={Boolean(errors.training_intent)} aria-describedby={errors.training_intent ? "intent-error" : undefined}>
            {Object.entries(intentLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
          <small id="intent-error" className={`${errorText} min-h-5 ${errors.training_intent ? "" : "invisible"}`} aria-hidden={!errors.training_intent}>{errors.training_intent || "No error"}</small>
        </label>
        <label>
          <span>Priority</span>
          <select name="priority" defaultValue="normal" aria-invalid={Boolean(errors.priority)} aria-describedby={errors.priority ? "priority-error priority-help" : "priority-help"}>
            <option value="low">Low - flexible</option>
            <option value="normal">Normal - standard importance</option>
            <option value="high">High - protect this session</option>
          </select>
          <small id="priority-help" className={helpText}>How important this session is when plans compete.</small>
          <small id="priority-error" className={`${errorText} min-h-5 ${errors.priority ? "" : "invisible"}`} aria-hidden={!errors.priority}>{errors.priority || "No error"}</small>
        </label>
      </div>
      <fieldset aria-describedby={errors.prescription ? "prescription-error" : undefined}>
        <legend>Duration and distance <span>Enter either or both</span></legend>
        <div className="grid grid-cols-2 gap-6 max-[700px]:grid-cols-1">
          <label><span>Duration</span><span className={unitInput}><input name="duration_minutes" type="number" min="0.0167" step="0.0167" aria-invalid={Boolean(errors.duration_seconds)} aria-describedby="duration-error" /><b>min</b></span><small id="duration-error" className={`${errorText} min-h-5 ${errors.duration_seconds ? "" : "invisible"}`} aria-hidden={!errors.duration_seconds}>{errors.duration_seconds || "No error"}</small></label>
          <label><span>Distance</span><span className={unitInput}><input name="distance_kilometres" type="number" min="0.001" step="0.001" aria-invalid={Boolean(errors.distance_metres)} aria-describedby="distance-error" /><b>km</b></span><small id="distance-error" className={`${errorText} min-h-5 ${errors.distance_metres ? "" : "invisible"}`} aria-hidden={!errors.distance_metres}>{errors.distance_metres || "No error"}</small></label>
        </div>
        <small id="prescription-error" className={`${errorText} block min-h-5 ${errors.prescription ? "" : "invisible"}`} aria-hidden={!errors.prescription}>{errors.prescription || "No error"}</small>
      </fieldset>
      <label>
        <span>Notes <i className="float-right not-italic text-muted normal-case">Optional</i></span>
        <textarea name="notes" rows={4} maxLength={2000} aria-invalid={Boolean(errors.notes)} aria-describedby="notes-error" placeholder="Terrain, context, or anything worth remembering" />
        <small id="notes-error" className={`${errorText} min-h-5 ${errors.notes ? "" : "invisible"}`} aria-hidden={!errors.notes}>{errors.notes || "No error"}</small>
      </label>
      <button type="submit">Save Planned Run <span aria-hidden="true">→</span></button>
    </form>
  );
}

function RunDetail({
  run,
  evidence,
  errors,
  onRecordOutcome,
  onRecordCheckIn,
}: {
  run: PlannedRun;
  evidence: LinkEvidence | null;
  errors: Record<string, string>;
  onRecordOutcome: (event: FormEvent<HTMLFormElement>) => void;
  onRecordCheckIn: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const revision = run.active_revision;
  const linkedActivities = evidence?.links ?? [];
  return (
    <article className="overflow-hidden border border-line-strong bg-surface shadow-[8px_8px_0_var(--color-ink)] max-[700px]:shadow-none" aria-label="Planned Run review">
      <header className="bg-ink px-[clamp(22px,5vw,46px)] py-[clamp(24px,5vw,38px)] text-white">
        <span className="font-mono text-[11px] tracking-[.12em] text-[#d7ddd8] uppercase">{new Date(`${run.scheduled_date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
        <h2 className="my-2 text-[clamp(34px,6vw,58px)] leading-none tracking-[-.05em]">{intentLabels[run.training_intent]}</h2>
        <p className="m-0 text-[#d7ddd8] capitalize">{run.priority} priority</p>
      </header>
      <div className="p-[clamp(22px,5vw,46px)]">
        <section aria-labelledby="planned-prescription-heading">
          <h3 id="planned-prescription-heading" className="mt-0 text-2xl">What was planned</h3>
          <dl className="grid-cols-2! max-[480px]:grid-cols-1!">
            <div><dt>Duration</dt><dd>{formatDuration(revision.duration_seconds)}</dd></div>
            <div><dt>Distance</dt><dd>{formatDistance(revision.distance_metres, "Not prescribed")}</dd></div>
          </dl>
          {run.notes && <div className={notesBlock}><span className={labelText}>Notes</span><p>{run.notes}</p></div>}
        </section>

        <section className="mt-10 border-t-[3px] border-ink pt-7" aria-labelledby="actual-evidence-heading">
          <div className="flex items-end justify-between gap-5 max-[600px]:items-start max-[600px]:flex-col">
            <div><span className={revisionBadge}>Linked evidence</span><h3 id="actual-evidence-heading" className="mt-3 mb-1 text-[clamp(27px,4vw,40px)]">What happened</h3></div>
            <p className="m-0 font-mono text-xs text-muted">{linkedActivities.length} linked {linkedActivities.length === 1 ? "activity" : "activities"}</p>
          </div>
          {linkedActivities.length === 0 ? <p className="border border-line bg-canvas p-5">No Completed Activities are linked. Actual duration and distance are not comparable.</p> : (
            <>
              <dl className="mt-5 grid-cols-2! border-y border-line" aria-label="Complete actual totals">
                <div><dt>Total actual duration</dt><dd>{formatDuration(evidence?.total_duration_seconds, "Not comparable")}</dd></div>
                <div><dt>Total actual distance</dt><dd>{formatDistance(evidence?.total_distance_metres, "Not comparable")}</dd></div>
              </dl>
              <div className="mt-5 grid grid-cols-2 gap-4 max-[760px]:grid-cols-1" aria-label="Planned and actual comparisons">
                <MeasureComparison label="Duration" planned={revision.duration_seconds} actual={evidence?.total_duration_seconds} difference={evidence?.duration_difference_seconds} format={formatDuration} />
                <MeasureComparison label="Distance" planned={revision.distance_metres} actual={evidence?.total_distance_metres} difference={evidence?.distance_difference_metres} format={formatDistance} />
              </div>
              <section className="mt-7 grid gap-3" aria-label="Confirmed Links">
                <h4 className="m-0 text-xl">Linked activities</h4>
                {linkedActivities.map((item) => (
                  <a className="grid grid-cols-[1fr_auto] gap-3 border border-line p-5 text-ink no-underline hover:bg-canvas max-[520px]:grid-cols-1" href={`/activities/${item.activity.id}`} key={item.link.id}>
                    <span className="grid gap-1"><strong className="text-lg">{item.activity.title || "Running activity"}</strong><small className="text-muted">{item.activity.import_provenance ? "FIT import" : "Manual entry"} <span aria-hidden="true">·</span> {new Date(item.activity.start_instant).toLocaleString()}</small></span>
                    <span className="text-right font-mono text-sm max-[520px]:text-left">{formatDuration(item.activity.duration_seconds, "Not recorded")}<br />{formatDistance(item.activity.distance_metres)}</span>
                  </a>
                ))}
              </section>
            </>
          )}
        </section>

        {evidence && <SessionObservations evidence={evidence} errors={errors} onRecordOutcome={onRecordOutcome} onRecordCheckIn={onRecordCheckIn} />}
      </div>
    </article>
  );
}

function SessionObservations({ evidence, errors, onRecordOutcome, onRecordCheckIn }: { evidence: LinkEvidence; errors: Record<string, string>; onRecordOutcome: (event: FormEvent<HTMLFormElement>) => void; onRecordCheckIn: (event: FormEvent<HTMLFormElement>) => void }) {
  const [editing, setEditing] = useState(false);
  const [disposition, setDisposition] = useState<SessionOutcomeCreate["disposition"]>(evidence.session_outcome?.disposition ?? "completed");
  const describeCheckIn = (checkIn: NonNullable<LinkEvidence["check_in"]>) => [
    checkIn.readiness !== null && `Before-session readiness ${checkIn.readiness}/5`,
    checkIn.post_session_effort !== null && `Whole-session effort ${checkIn.post_session_effort}/10`,
    checkIn.feel !== null && `Post-session feel ${checkIn.feel}/5`,
    checkIn.notes,
  ].filter(Boolean).join("; ");
  const currentOutcome = evidence.session_outcome;
  const currentCheckIn = evidence.check_in;
  return (
    <section className={linkingPanel} aria-label="Session Outcome and Check-in">
      <div className="flex items-start justify-between gap-5 max-[600px]:flex-col">
        <div><span className={revisionBadge}>Athlete record</span><h2 className="mb-2 text-[clamp(26px,4vw,42px)]">Post-run summary</h2><p className="m-0 text-muted">Athlete-reported context only. Saving does not change the Link or claim completion.</p></div>
        <button type="button" className="mt-0! shrink-0" onClick={() => setEditing((value) => !value)} aria-expanded={editing} aria-controls="post-run-entry">{editing ? "Close post-run details" : currentOutcome || currentCheckIn ? "Update post-run details" : "Record post-run details"}</button>
      </div>
      <dl className="mt-5 border border-line bg-surface px-[clamp(18px,4vw,28px)] max-[520px]:grid-cols-1!" aria-label="Current post-run summary">
        <div><dt>Current Outcome</dt><dd>{currentOutcome ? <>{outcomeLabels[currentOutcome.disposition]}{currentOutcome.reason && <small className="mt-1 block font-sans text-sm font-normal normal-case text-muted">{currentOutcome.reason}</small>}</> : "Not recorded"}</dd></div>
        <div><dt>Latest observations</dt><dd className="normal-case!">{currentCheckIn ? describeCheckIn(currentCheckIn) : "Not recorded"}</dd></div>
      </dl>
      {editing && <div id="post-run-entry" className="mt-5 grid gap-4 border border-line bg-surface p-[clamp(18px,4vw,30px)]">
        <form aria-label="Record Session Outcome" onSubmit={onRecordOutcome}>
          <label><span>What happened?</span><select name="disposition" value={disposition} onChange={(event) => setDisposition(event.target.value as SessionOutcomeCreate["disposition"])} aria-invalid={Boolean(errors.outcome)} aria-describedby={errors.outcome ? "outcome-error" : undefined}>{Object.entries(outcomeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {disposition !== "completed" && <label className="mt-4"><span>Reason for the deviation <i className="float-right not-italic text-muted normal-case">Optional</i></span><textarea name="reason" rows={2} maxLength={2000} placeholder="What changed or prevented the planned session?" /></label>}
          {errors.outcome && <small className={errorText} id="outcome-error">{errors.outcome}</small>}
          <button type="submit">Save Outcome</button>
        </form>
        <form className="border-t border-line pt-5" aria-label="Record Check-in" onSubmit={onRecordCheckIn}>
          <p className="mt-0"><strong>Optional observations</strong><br /><span className="text-sm text-muted">Record any one field, including notes alone. These are observations, not a readiness judgment or guidance.</span></p>
          <label><span>Whole-session perceived effort <i className="float-right not-italic text-muted normal-case">Optional</i></span><input name="post_session_effort" type="number" min="1" max="10" aria-invalid={Boolean(errors.checkIn)} aria-describedby={errors.checkIn ? "check-in-error effort-help" : "effort-help"} /><small id="effort-help" className={helpText}>1 = very easy; 10 = maximum effort for the session as a whole.</small></label>
          <details className={`${disclosurePanel} my-4`}>
            <summary>Readiness and feel <span>Optional</span></summary>
            <div className="grid grid-cols-2 gap-5 pt-5 max-[600px]:grid-cols-1">
              <label><span>How ready did you feel before the session?</span><input name="readiness" type="number" min="1" max="5" aria-invalid={Boolean(errors.checkIn)} aria-describedby={errors.checkIn ? "check-in-error readiness-help" : "readiness-help"} /><small id="readiness-help" className={helpText}>1 = not ready; 5 = fully ready.</small></label>
              <label><span>How did you feel after the session?</span><input name="feel" type="number" min="1" max="5" aria-invalid={Boolean(errors.checkIn)} aria-describedby={errors.checkIn ? "check-in-error feel-help" : "feel-help"} /><small id="feel-help" className={helpText}>1 = very poor; 5 = very good.</small></label>
            </div>
          </details>
          <label><span>Notes <i className="float-right not-italic text-muted normal-case">Optional</i></span><textarea name="notes" rows={2} maxLength={2000} placeholder="Anything useful to remember" /></label>
          {errors.checkIn && <small className={errorText} id="check-in-error">{errors.checkIn}</small>}
          <button type="submit">Save observations</button>
        </form>
      </div>}
      {(evidence.session_outcome_history.length > 0 || evidence.check_in_history.length > 0) && <details className={`${disclosurePanel} mt-4`}>
        <summary>View history <span>{evidence.session_outcome_history.length + evidence.check_in_history.length}</span></summary>
        <div className="grid gap-5 pt-5">
          <section aria-label="Session Outcome history"><h3 className="mt-0">Outcome history</h3>{evidence.session_outcome_history.length === 0 ? <p>No prior Outcomes.</p> : <ol>{evidence.session_outcome_history.map((outcome) => <li key={outcome.id}><strong>{outcomeLabels[outcome.disposition]}</strong>{outcome.reason && `: ${outcome.reason}`} <small className="text-muted">{new Date(outcome.recorded_at).toLocaleString()}</small></li>)}</ol>}</section>
          <section aria-label="Check-in history"><h3>Observation history</h3>{evidence.check_in_history.length === 0 ? <p>No prior observations.</p> : <ol>{evidence.check_in_history.map((checkIn) => <li key={checkIn.id}>{describeCheckIn(checkIn)} <small className="text-muted">{new Date(checkIn.recorded_at).toLocaleString()}</small></li>)}</ol>}</section>
        </div>
      </details>}
    </section>
  );
}
