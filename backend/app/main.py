import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .simulator import StadiumSimulator, ZONES
from .predictor import OccupancyPredictor

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

simulator = StadiumSimulator()
predictor = OccupancyPredictor()
clients: set[WebSocket] = set()


async def simulation_loop():
    while True:
        snapshot = simulator.tick()
        for zone in snapshot["zones"]:
            predictor.observe(zone["id"], zone["occupancy"])
            zone["prediction"] = predictor.predict(zone["id"])
            zone["advice"] = predictor.recommend(
                zone["id"], zone["occupancy"], zone["capacity"]
            )

        dead = []
        for ws in clients:
            try:
                await ws.send_text(json.dumps(snapshot))
            except Exception:
                dead.append(ws)
        for ws in dead:
            clients.discard(ws)

        await asyncio.sleep(simulator.TICK_SECONDS)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(simulation_loop())
    yield
    task.cancel()


app = FastAPI(title="Energy-Smart Stadium", lifespan=lifespan)


@app.get("/api/health")
def health():
    return {"ok": True, "phase": simulator.state.phase, "tick": simulator.state.tick}


@app.get("/api/zones")
def zones():
    return {"zones": ZONES}


@app.get("/api/snapshot")
def snapshot():
    return simulator.state.to_dict()


@app.post("/api/reset")
def reset():
    simulator.reset()
    predictor.history.clear()
    return {"ok": True}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        await ws.send_text(json.dumps(simulator.state.to_dict()))
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")
