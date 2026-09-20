from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from importlib.metadata import version
from io import BytesIO
from math import isfinite

import fitdecode

from tempo.measurements import MAX_DISTANCE_METRES, MAX_DURATION_SECONDS


class FitImportError(ValueError):
    pass


@dataclass(frozen=True)
class DecodedFitActivity:
    source_identity: str
    checksum_sha256: str
    start_instant: datetime
    duration_seconds: int
    distance_metres: int | None

    @property
    def original_values(self) -> dict[str, str | int | None]:
        return {
            "modality": "running",
            "start_instant": self.start_instant.isoformat(),
            "duration_seconds": self.duration_seconds,
            "distance_metres": self.distance_metres,
            "title": None,
            "notes": None,
        }


IMPORTER_NAME = "fitdecode"
IMPORTER_VERSION = version("fitdecode")


def normalize_measurement(value: object, field: str, maximum: int) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or isinstance(value, float)
        and not isfinite(value)
    ):
        raise FitImportError(f"The FIT activity contains a non-finite or non-numeric {field}.")
    if value <= 0:
        raise FitImportError(f"The FIT activity has no positive {field}.")
    normalized = round(value)
    if normalized < 1:
        raise FitImportError(
            f"The FIT activity {field} is too small to normalize to a whole canonical unit."
        )
    if normalized > maximum:
        raise FitImportError(
            f"The FIT activity {field} exceeds the maximum canonical value of {maximum}."
        )
    return normalized


def decode_running_activity(content: bytes) -> DecodedFitActivity:
    checksum = sha256(content).hexdigest()
    file_id: dict[str, object] | None = None
    session: dict[str, object] | None = None
    try:
        with fitdecode.FitReader(
            BytesIO(content),
            check_crc=fitdecode.CrcCheck.RAISE,
            error_handling=fitdecode.ErrorHandling.RAISE,
        ) as reader:
            for frame in reader:
                if frame.frame_type != fitdecode.FIT_FRAME_DATA:
                    continue
                values = {field.name: field.value for field in frame.fields}
                if frame.name == "file_id" and file_id is None:
                    file_id = values
                elif frame.name == "session" and session is None:
                    session = values
    except (fitdecode.FitError, EOFError, OSError, ValueError) as error:
        raise FitImportError("The file is unreadable or is not a valid FIT activity.") from error

    if session is None or (file_id is not None and file_id.get("type") != "activity"):
        raise FitImportError("The FIT file does not contain a normalizable activity session.")
    if session.get("sport") != "running":
        raise FitImportError("Only running FIT activities are supported in Stage 1.")

    start = session.get("start_time")
    elapsed = session.get("total_elapsed_time")
    distance = session.get("total_distance")
    if not isinstance(start, datetime) or start.tzinfo is None or start.utcoffset() is None:
        raise FitImportError("The FIT activity has no timezone-aware start instant.")
    duration_seconds = normalize_measurement(
        elapsed, "elapsed duration", MAX_DURATION_SECONDS
    )
    distance_metres = (
        normalize_measurement(distance, "distance", MAX_DISTANCE_METRES)
        if distance is not None
        else None
    )

    identity_parts = (
        file_id.get("manufacturer") if file_id else None,
        (file_id.get("garmin_product") or file_id.get("product")) if file_id else None,
        file_id.get("serial_number") if file_id else None,
        file_id.get("time_created") if file_id else None,
    )
    if any(part is None for part in identity_parts):
        source_identity = f"sha256:{checksum}"
    else:
        source_identity = "fit:" + ":".join(
            part.isoformat() if isinstance(part, datetime) else str(part) for part in identity_parts
        )

    return DecodedFitActivity(
        source_identity=source_identity,
        checksum_sha256=checksum,
        start_instant=start,
        duration_seconds=duration_seconds,
        distance_metres=distance_metres,
    )
