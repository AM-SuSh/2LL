import os
from typing import Tuple

import httpx

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"
    llm_translate_mode: str = ""


_settings = Settings()


class LlmTranslateError(Exception):
    pass


def _should_mock() -> bool:
    mode = (_settings.llm_translate_mode or os.getenv("LLM_TRANSLATE_MODE", "")).lower()
    if mode in ("mock", "1", "true", "yes"):
        return True
    if not (_settings.openai_api_key or os.getenv("OPENAI_API_KEY", "")).strip():
        return True
    return False


async def translate_zh_to_en(text: str) -> Tuple[str, bool]:
    """
    Returns (english_text, used_mock).
    """
    if _should_mock():
        lines = text.strip().splitlines()
        preview = "\n".join(lines[:8])
        suffix = "\n\n...(demo: configure OPENAI_API_KEY to use real LLM)" if len(lines) > 8 else ""
        return (
            "[Demo/mock translation]\n\n" + preview + suffix,
            True,
        )

    key = (_settings.openai_api_key or os.getenv("OPENAI_API_KEY", "")).strip()
    base = (_settings.openai_base_url or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")).rstrip(
        "/"
    )
    model = _settings.openai_model or os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    url = f"{base}/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a professional translator. Translate the user's Chinese text "
                    "into natural, fluent English. Preserve Markdown syntax and structure "
                    "(headings, lists, links, code fences) exactly where appropriate."
                ),
            },
            {"role": "user", "content": text},
        ],
        "temperature": 0.2,
    }

    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            r = await client.post(url, json=payload, headers=headers)
        except httpx.RequestError as e:
            raise LlmTranslateError(f"network_error: {e}") from e

    if r.status_code >= 400:
        detail = _safe_detail(r)
        raise LlmTranslateError(f"upstream_error {r.status_code}: {detail}")

    try:
        data = r.json()
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError, ValueError) as e:
        raise LlmTranslateError(f"unexpected_response: {e}") from e

    if not isinstance(content, str) or not content.strip():
        raise LlmTranslateError("empty_translation")

    return content.strip(), False


def _safe_detail(r: httpx.Response) -> str:
    try:
        j = r.json()
        err = j.get("error") or j
        if isinstance(err, dict):
            return str(err.get("message") or err)
        return str(err)
    except Exception:  # noqa: BLE001
        return r.text[:500]
