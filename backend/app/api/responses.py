from urllib.parse import quote

from fastapi import Response

from app.application.exports import ExportArtifact


def download_headers(filename: str) -> dict[str, str]:
    ascii_filename = "".join(ch if 32 <= ord(ch) < 127 else "_" for ch in filename).replace("\\", "_").replace('"', "_")
    ascii_filename = ascii_filename or "export"
    return {"Content-Disposition": f"attachment; filename=\"{ascii_filename}\"; filename*=UTF-8''{quote(filename)}"}


def export_artifact_response(artifact: ExportArtifact) -> Response:
    return Response(
        content=artifact.content,
        media_type=artifact.content_type,
        headers=download_headers(artifact.filename),
    )
