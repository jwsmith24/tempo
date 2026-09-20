# Own a source-neutral canonical record with provenance

The application will own a source-neutral canonical training record rather than mirror Garmin or another vendor's model. Manual entry, FIT files, and future APIs enter through source adapters; raw inputs, source identity, importer and algorithm versions, normalized values, corrections, and revisions are retained.

Imports must be idempotent, corrections must preserve originals, and analysis must be reproducibly rebuildable. Complete export and versioned backup bundles prevent vendor or application lock-in. This costs more storage and schema discipline than flattening or discarding source data, but makes history auditable and future interpretation changes recoverable.
