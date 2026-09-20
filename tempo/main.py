from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from tempo.activities.router import router as activities_router
from tempo.planning.router import router as planning_router
from tempo.linking.router import activity_router as activity_linking_router
from tempo.linking.router import router as linking_router

app = FastAPI(title="Tempo API", version="0.1.0")
app.include_router(planning_router)
app.include_router(activities_router)
app.include_router(linking_router)
app.include_router(activity_linking_router)

spa_directory = Path(__file__).resolve().parents[1] / "frontend" / "dist"
if spa_directory.is_dir():
    app.mount("/assets", StaticFiles(directory=spa_directory / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def serve_spa(path: str) -> FileResponse:
        requested = spa_directory / path
        if requested.is_file() and spa_directory in requested.resolve().parents:
            return FileResponse(requested)
        return FileResponse(spa_directory / "index.html")
