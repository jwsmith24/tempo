# Learning Notes

Project-specific concepts and mental models worth preserving. These notes explain why a technique matters in Tempo rather than duplicating implementation details available in the code. Each entry links to relevant official documentation or explicitly states that none was found.

## Tailwind Component Classes

**Learned:** 2026-09-20

Component classes package a recurring visual pattern, while utilities handle context-specific layout and exceptions.

In Tempo, `surface-panel` owns the shared surface treatment used by forms and detail views:

```css
@layer components {
  .surface-panel {
    background: var(--color-surface);
    border: 1px solid var(--color-line);
    box-shadow: 7px 7px 0 var(--color-ink);
  }
}
```

Utilities can then describe the layout needed at one usage site:

```tsx
<section className="surface-panel mt-10 grid gap-6">
```

Here, `surface-panel` expresses shared design-system identity while `mt-10 grid gap-6` describes local composition.

**Rule of thumb:** Start with utilities. Extract a component class when a meaningful visual pattern repeats and should evolve consistently across the application.

**Official documentation:**

- [Tailwind CSS: Adding component classes](https://tailwindcss.com/docs/adding-custom-styles#adding-component-classes)
- [Tailwind CSS: Theme variables](https://tailwindcss.com/docs/theme)

## Generating TypeScript Types from OpenAPI

**Learned:** 2026-09-19

Generate frontend contract types from the backend's OpenAPI schema instead of maintaining matching TypeScript interfaces by hand. This gives the API contract one source of truth and turns incompatible backend changes into TypeScript errors rather than runtime surprises.

The approach is framework-neutral: the frontend generator only needs a valid OpenAPI document. FastAPI can produce one directly, while a Spring Boot service commonly exposes one through `springdoc-openapi` at an endpoint such as `/v3/api-docs`. Either schema can be saved or fetched and passed to the same TypeScript generator:

```text
FastAPI app.openapi() ---------\
                                -> OpenAPI document -> openapi-typescript -> TypeScript types
Spring Boot /v3/api-docs ------/
```

For example, a Spring Boot frontend build could generate from the running service:

```sh
openapi-typescript http://localhost:8080/v3/api-docs -o src/api-schema.ts
```

The backend framework and language can change without changing the core contract workflow, provided the generated OpenAPI accurately describes the deployed API.

Tempo's `generate:api` script first asks FastAPI for its current OpenAPI document, then passes that document to `openapi-typescript`:

```json
"generate:api": "../.venv/bin/python ../scripts/export_openapi.py && openapi-typescript ../openapi.json -o src/api-schema.ts"
```

Frontend code derives its request and response types from the generated schema:

```ts
import type { components } from "./api-schema";

type PlannedRunCreate = components["schemas"]["PlannedRunCreate"];
type PlannedRun = components["schemas"]["PlannedRunRead"];
```

The frontend build runs generation before `tsc`, so a changed backend schema is reflected before type-checking:

```text
generate OpenAPI -> generate TypeScript -> type-check -> bundle
```

**Rule of thumb:** Generate types from the authoritative contract during the normal build, and never manually edit the generated file. Generation prevents duplicated definitions; compiling immediately afterward exposes drift.

**Official documentation:**

- [OpenAPI TypeScript: Introduction and basic usage](https://openapi-ts.dev/introduction)
- [FastAPI: Generating an OpenAPI schema with `app.openapi()`](https://fastapi.tiangolo.com/how-to/extending-openapi/#the-normal-process)
- [Springdoc OpenAPI: Spring Boot setup and `/v3/api-docs`](https://springdoc.org/#getting-started)
- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
