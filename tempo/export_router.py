from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from tempo.database import get_session
from tempo.exporting import archive

router = APIRouter(prefix="/api/export", tags=["export"])


@router.post(
    "",
    response_class=Response,
    responses={
        200: {
            "content": {
                "application/zip": {"schema": {"type": "string", "format": "binary"}}
            }
        }
    },
)
def export_stage_one(session: Session = Depends(get_session)) -> Response:
    return Response(
        archive(session),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="tempo-stage1-export.zip"'},
    )
