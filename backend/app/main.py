from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import translate

load_dotenv()


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield


app = FastAPI(title="Bilingual Editor API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(translate.router, prefix="/api", tags=["translate"])


@app.get("/api/health")
async def health():
    return {"ok": True}
