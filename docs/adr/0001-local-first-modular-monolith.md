# Run as a local-first modular monolith

Tempo will initially run as one loopback-only local application on one athlete's machine: a React and TypeScript SPA backed by FastAPI, SQLAlchemy, SQLite, and managed local file storage. Capabilities are separated into planning, activities, reconciliation, analysis, coaching, and athlete-settings modules inside one deployable application.

This preserves local ownership and keeps deployment small while supporting durable imports, raw files, rebuildable analysis, backup, and a future adapter boundary. Browser-only storage would make those guarantees harder; cloud hosting, desktop packaging, containers, and distributed services add complexity before cross-device or multi-user needs exist.
