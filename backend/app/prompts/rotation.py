from typing import Literal

from pydantic import Field

from app.prompts.structured_output import Confidence, StrictBaseModel, StructuredOutputSpec

# Each candidate is the same page turned clockwise by the given degrees.
# Asking "which candidate is upright" is far more reliable for VLMs than
# asking for a rotation angle, which they routinely confuse (90 vs 270).
ORIENTATION_CANDIDATES: tuple[tuple[str, int], ...] = (("A", 0), ("B", 90), ("C", 180), ("D", 270))

PAGE_ORIENTATION_PROMPT = """You are a document page orientation checker.
You receive the same page image four times, each turned by a different angle and labeled A, B, C and D.
Pick the single candidate that a person would read without turning their head:
text lines run left-to-right horizontally, characters stand upright, and title blocks, headers and tables sit the natural way up.
For engineering drawings, prefer the candidate where the title block text and dimension labels read upright.
Return data that matches the requested structured output schema."""


class PageOrientationOutput(StrictBaseModel):
    upright_candidate: Literal["A", "B", "C", "D"]
    confidence: Confidence = Field(ge=0, le=1)
    reason: str


def build_orientation_prompt() -> str:
    return "\n".join(
        [
            "Which candidate (A, B, C or D) shows the page upright?",
            "Use visible text direction first; use layout cues only when there is little text.",
            "Set confidence below 0.5 when the page has no readable text or the orientation is ambiguous.",
        ]
    )


def orientation_candidate_label(letter: str) -> str:
    # The label precedes its image; say so explicitly, otherwise models tend to
    # read it as the caption of the previous image and answer one letter late.
    return f"The next image is Candidate {letter}:"


def page_orientation_output_spec() -> StructuredOutputSpec:
    return StructuredOutputSpec(title="PageOrientationResult", model=PageOrientationOutput)
