from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.services import llm_translate

router = APIRouter()


class TranslateRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=200_000)

    @field_validator("text")
    @classmethod
    def strip_nonempty(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("text must not be empty")
        return s


class TranslateResponse(BaseModel):
    translated: str
    mock: bool = False


@router.post("/translate", response_model=TranslateResponse)
async def translate_body(req: TranslateRequest):
    try:
        result, used_mock = await llm_translate.translate_zh_to_en(req.text)
        return TranslateResponse(translated=result, mock=used_mock)
    except llm_translate.LlmTranslateError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"translate_failed: {e!s}") from e
