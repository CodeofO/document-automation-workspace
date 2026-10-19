from __future__ import annotations

from typing import Any

from app.domain.schema_definition import ClassCandidateValue, RequiredFieldItemValue
from app.domain.status import ClassificationOutcome, RequiredItemStatus, RequiredOverallStatus

REQUIRED_ITEM_STATUSES = frozenset(RequiredItemStatus)


def _required_item_status(raw_item: dict[str, Any]) -> str:
    status = raw_item.get("status")
    return status if status in REQUIRED_ITEM_STATUSES else RequiredItemStatus.UNCERTAIN


def _required_overall(*, needs_review: bool, incomplete: bool) -> RequiredOverallStatus:
    if needs_review:
        return RequiredOverallStatus.NEEDS_REVIEW
    return RequiredOverallStatus.INCOMPLETE if incomplete else RequiredOverallStatus.COMPLETE


def required_overall_from_items(raw_items: list[dict[str, Any]], configured_items: list[Any]) -> str:
    raw_by_name = {item.get("item_name"): item for item in raw_items if isinstance(item, dict)}
    needs_review = False
    incomplete = False
    for configured in [RequiredFieldItemValue.from_dto(item) for item in configured_items]:
        raw_item = raw_by_name.get(configured.item_name, {})
        status = _required_item_status(raw_item)
        if configured.required and status == RequiredItemStatus.MISSING:
            incomplete = True
        if configured.required and status == RequiredItemStatus.UNCERTAIN:
            needs_review = True
    return _required_overall(needs_review=needs_review, incomplete=incomplete)


def required_raw_items(raw_values: dict[str, Any]) -> list[dict[str, Any]]:
    raw_items = raw_values.get("items")
    if isinstance(raw_items, list):
        return [item for item in raw_items if isinstance(item, dict)]
    if isinstance(raw_items, dict):
        normalized: list[dict[str, Any]] = []
        for item_name, item in raw_items.items():
            if not isinstance(item, dict):
                continue
            normalized.append({"item_name": item_name, **item})
        return normalized
    return []


def validate_classification_output(raw_values: dict[str, Any], context: Any) -> dict[str, Any]:
    class_names = {item.class_name for item in [ClassCandidateValue.from_dto(item) for item in context.classes]}
    status = raw_values.get("status") if raw_values.get("status") in set(ClassificationOutcome) else ClassificationOutcome.UNKNOWN
    class_name = raw_values.get("class_name")
    if status == ClassificationOutcome.CLASSIFIED and class_name not in class_names:
        status = ClassificationOutcome.UNKNOWN
        class_name = None
    if status == ClassificationOutcome.UNKNOWN:
        class_name = None
    confidence = raw_values.get("confidence")
    if not isinstance(confidence, (int, float)):
        confidence = None
    evidence = raw_values.get("evidence")
    return {
        "document_id": context.document.id,
        "classifier_id": context.classifier_id,
        "status": status,
        "class_name": class_name if isinstance(class_name, str) else None,
        "confidence": max(0, min(1, float(confidence))) if confidence is not None else None,
        "reason": str(raw_values.get("reason") or ""),
        "evidence": evidence if isinstance(evidence, list) else [],
    }


def validate_required_field_output(raw_values: dict[str, Any], context: Any) -> dict[str, Any]:
    configured_items = [RequiredFieldItemValue.from_dto(item) for item in context.items]
    raw_items = required_raw_items(raw_values)
    raw_by_name = {item.get("item_name"): item for item in raw_items if isinstance(item, dict)}
    items: list[dict[str, Any]] = []
    needs_review = False
    incomplete = False
    for configured in configured_items:
        raw_item = raw_by_name.get(configured.item_name, {})
        status = _required_item_status(raw_item)
        if configured.required and status == RequiredItemStatus.MISSING:
            incomplete = True
        if configured.required and status == RequiredItemStatus.UNCERTAIN:
            needs_review = True
        confidence = raw_item.get("confidence")
        if not isinstance(confidence, (int, float)):
            confidence = None
        page = raw_item.get("page")
        items.append(
            {
                "item_name": configured.item_name,
                "status": status,
                "required": configured.required,
                "evidence_type": configured.evidence_type,
                "confidence": max(0, min(1, float(confidence))) if confidence is not None else None,
                "evidence": raw_item.get("evidence") if isinstance(raw_item.get("evidence"), str) else None,
                "page": page if isinstance(page, int) else None,
            }
        )
    overall_status = _required_overall(needs_review=needs_review, incomplete=incomplete)
    return {
        "document_id": context.document.id,
        "checklist_id": context.checklist_id,
        "overall_status": overall_status,
        "items": items,
    }
