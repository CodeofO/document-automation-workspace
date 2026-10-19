"""Test double for the VLM gateway seam (``app.vlm.get_vlm_gateway``)."""

import inspect
from collections.abc import Callable
from typing import Any

from app.vlm import default_vlm_gateway, run_sync_with_vlm_limit_async

_ASYNC_OPERATIONS = (
    "extract",
    "judge_extraction",
    "correct_extraction",
    "classify_document",
    "check_required_fields",
    "detect_page_orientation",
    "extract_table",
)
_SYNC_OPERATIONS = (
    "recommend_schema",
    "recommend_schema_description",
    "recommend_required_field_checklist",
    "recommend_table",
)


class FakeVlmGateway:
    """Routes chosen operations to test handlers and everything else to the settings-selected gateway.

    Handlers may be plain functions or coroutine functions. Plain functions run in a worker
    thread while holding a VLM request slot, exactly like a blocking provider call would, so
    concurrency limits stay observable in tests.
    """

    def __init__(self) -> None:
        self._handlers: dict[str, Callable[..., Any]] = {}
        self.calls: list[str] = []

    def set(self, **handlers: Callable[..., Any]) -> "FakeVlmGateway":
        unknown = set(handlers) - set(_ASYNC_OPERATIONS) - set(_SYNC_OPERATIONS)
        if unknown:
            raise ValueError(f"Unknown VLM gateway operations: {sorted(unknown)}")
        self._handlers.update(handlers)
        return self

    async def _call_async(self, operation: str, *args: Any, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(operation)
        handler = self._handlers.get(operation)
        if handler is None:
            return await getattr(default_vlm_gateway(), operation)(*args, **kwargs)
        if inspect.iscoroutinefunction(handler):
            return await handler(*args, **kwargs)
        return await run_sync_with_vlm_limit_async(handler, *args, **kwargs)

    def _call_sync(self, operation: str, *args: Any, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(operation)
        handler = self._handlers.get(operation)
        if handler is None:
            return getattr(default_vlm_gateway(), operation)(*args, **kwargs)
        return handler(*args, **kwargs)

    async def extract(self, fields, image_paths=None, image_inputs=None):
        if image_paths is None:
            return await self._call_async("extract", fields, image_inputs=image_inputs)
        return await self._call_async("extract", fields, image_paths=image_paths, image_inputs=image_inputs)

    async def judge_extraction(self, field, initial_value, initial_evidence, image_inputs):
        return await self._call_async("judge_extraction", field, initial_value, initial_evidence, image_inputs)

    async def correct_extraction(self, field, initial_value, initial_evidence, judgement_reason, image_inputs):
        return await self._call_async("correct_extraction", field, initial_value, initial_evidence, judgement_reason, image_inputs)

    async def classify_document(self, classes, allow_unknown, image_paths):
        return await self._call_async("classify_document", classes, allow_unknown, image_paths)

    async def check_required_fields(self, items, regions, image_paths=None, image_inputs=None):
        return await self._call_async("check_required_fields", items, regions, image_paths=image_paths, image_inputs=image_inputs)

    async def detect_page_orientation(self, candidate_inputs):
        return await self._call_async("detect_page_orientation", candidate_inputs)

    async def extract_table(self, table, image_inputs, *, has_region_crop):
        return await self._call_async("extract_table", table, image_inputs, has_region_crop=has_region_crop)

    def recommend_schema(self, image_paths):
        return self._call_sync("recommend_schema", image_paths)

    def recommend_schema_description(self, image_paths=None, *, schema_name, current_description, fields):
        return self._call_sync(
            "recommend_schema_description",
            image_paths,
            schema_name=schema_name,
            current_description=current_description,
            fields=fields,
        )

    def recommend_table(self, image_inputs, *, table_description, has_region_crop):
        return self._call_sync("recommend_table", image_inputs, table_description=table_description, has_region_crop=has_region_crop)

    def recommend_required_field_checklist(self, image_paths):
        return self._call_sync("recommend_required_field_checklist", image_paths)
