import random
import time
from dataclasses import dataclass, field
from typing import Dict, List


ZONES = [
    {"id": "N", "name": "North Stand", "capacity": 15000, "x": 50, "y": 10, "w": 40, "h": 15},
    {"id": "S", "name": "South Stand", "capacity": 15000, "x": 50, "y": 75, "w": 40, "h": 15},
    {"id": "E", "name": "East Stand", "capacity": 12000, "x": 85, "y": 30, "w": 12, "h": 40},
    {"id": "W", "name": "West Stand", "capacity": 12000, "x": 3, "y": 30, "w": 12, "h": 40},
    {"id": "C1", "name": "Concourse A", "capacity": 3000, "x": 50, "y": 28, "w": 40, "h": 6},
    {"id": "C2", "name": "Concourse B", "capacity": 3000, "x": 50, "y": 66, "w": 40, "h": 6},
    {"id": "F", "name": "Food Court", "capacity": 2000, "x": 20, "y": 45, "w": 14, "h": 10},
    {"id": "R", "name": "Restrooms", "capacity": 800, "x": 66, "y": 45, "w": 14, "h": 10},
]

# Base energy draw per zone (kW) — lighting + HVAC + screens at full load
BASE_ENERGY = {
    "N": 320, "S": 320, "E": 260, "W": 260,
    "C1": 90, "C2": 90, "F": 140, "R": 70,
}

# Match phases with duration (seconds in demo time) and occupancy factor
PHASES = [
    ("Pre-Game",    60,  0.35),
    ("First Half",  90,  0.95),
    ("Halftime",    45,  0.55),   # crowds move to concourse/food/restrooms
    ("Second Half", 90,  0.95),
    ("Post-Game",   60,  0.40),
]


@dataclass
class ZoneState:
    zone_id: str
    occupancy: int = 0
    baseline_kw: float = 0.0
    smart_kw: float = 0.0
    lighting_pct: int = 100
    hvac_pct: int = 100
    screens_on: bool = True


@dataclass
class StadiumState:
    phase: str = "Pre-Game"
    phase_idx: int = 0
    elapsed: float = 0.0
    tick: int = 0
    zones: Dict[str, ZoneState] = field(default_factory=dict)
    total_baseline_kwh: float = 0.0
    total_smart_kwh: float = 0.0

    def to_dict(self):
        return {
            "phase": self.phase,
            "elapsed": round(self.elapsed, 1),
            "tick": self.tick,
            "zones": [
                {
                    "id": z.zone_id,
                    "name": next(zn["name"] for zn in ZONES if zn["id"] == z.zone_id),
                    "capacity": next(zn["capacity"] for zn in ZONES if zn["id"] == z.zone_id),
                    "occupancy": z.occupancy,
                    "occupancy_pct": round(100 * z.occupancy / next(zn["capacity"] for zn in ZONES if zn["id"] == z.zone_id), 1),
                    "baseline_kw": round(z.baseline_kw, 1),
                    "smart_kw": round(z.smart_kw, 1),
                    "lighting_pct": z.lighting_pct,
                    "hvac_pct": z.hvac_pct,
                    "screens_on": z.screens_on,
                    "layout": next(zn for zn in ZONES if zn["id"] == z.zone_id),
                }
                for z in self.zones.values()
            ],
            "totals": {
                "baseline_kwh": round(self.total_baseline_kwh, 2),
                "smart_kwh": round(self.total_smart_kwh, 2),
                "saved_kwh": round(self.total_baseline_kwh - self.total_smart_kwh, 2),
                "saved_pct": round(
                    100 * (self.total_baseline_kwh - self.total_smart_kwh) / self.total_baseline_kwh, 1
                ) if self.total_baseline_kwh > 0 else 0,
                "saved_inr": round((self.total_baseline_kwh - self.total_smart_kwh) * 9.5, 0),
                "co2_kg": round((self.total_baseline_kwh - self.total_smart_kwh) * 0.82, 1),
            },
        }


class StadiumSimulator:
    """Drives occupancy + energy simulation. Tick interval = 1s real time."""

    TICK_SECONDS = 1.0

    def __init__(self):
        self.state = StadiumState()
        for z in ZONES:
            self.state.zones[z["id"]] = ZoneState(zone_id=z["id"])

    def _phase_info(self):
        total = 0
        for i, (name, dur, occ) in enumerate(PHASES):
            total += dur
            if self.state.elapsed < total:
                return i, name, occ
        return len(PHASES) - 1, PHASES[-1][0], PHASES[-1][2]

    def _target_occupancy(self, zone_id: str, phase_name: str, base_factor: float) -> float:
        """Phase-aware occupancy per zone."""
        cap = next(z["capacity"] for z in ZONES if z["id"] == zone_id)
        factor = base_factor

        if phase_name == "Halftime":
            if zone_id in ("N", "S", "E", "W"):
                factor = 0.45
            elif zone_id in ("C1", "C2"):
                factor = 0.9
            elif zone_id == "F":
                factor = 0.95
            elif zone_id == "R":
                factor = 0.85
        elif phase_name in ("First Half", "Second Half"):
            if zone_id in ("N", "S", "E", "W"):
                factor = 0.95
            else:
                factor = 0.15
        elif phase_name == "Pre-Game":
            if zone_id in ("N", "S", "E", "W"):
                factor = 0.35
            elif zone_id == "F":
                factor = 0.7
            else:
                factor = 0.4
        elif phase_name == "Post-Game":
            if zone_id in ("N", "S", "E", "W"):
                factor = 0.3
            elif zone_id in ("C1", "C2"):
                factor = 0.7
            else:
                factor = 0.25

        jitter = random.uniform(-0.05, 0.05)
        return max(0.0, min(1.0, factor + jitter)) * cap

    def _smart_energy(self, zone: ZoneState, occ_pct: float) -> tuple[float, int, int, bool]:
        """Apply smart control policy. Returns (kw, lighting%, hvac%, screens_on)."""
        base = BASE_ENERGY[zone.zone_id]

        if occ_pct < 0.05:
            lighting = 20
            hvac = 30
            screens = False
        elif occ_pct < 0.25:
            lighting = 50
            hvac = 55
            screens = False
        elif occ_pct < 0.6:
            lighting = 80
            hvac = 80
            screens = True
        else:
            lighting = 100
            hvac = 100
            screens = True

        # Weighted share: 40% lighting, 45% HVAC, 15% screens
        kw = base * (0.40 * lighting / 100 + 0.45 * hvac / 100 + 0.15 * (1.0 if screens else 0.0))
        return kw, lighting, hvac, screens

    def tick(self):
        self.state.tick += 1
        self.state.elapsed += self.TICK_SECONDS
        _, phase_name, base_factor = self._phase_info()
        self.state.phase = phase_name

        hours = self.TICK_SECONDS / 3600.0

        for z in self.state.zones.values():
            target = self._target_occupancy(z.zone_id, phase_name, base_factor)
            # smoothly move toward target
            z.occupancy = int(z.occupancy + 0.25 * (target - z.occupancy))
            cap = next(zn["capacity"] for zn in ZONES if zn["id"] == z.zone_id)
            occ_pct = z.occupancy / cap

            baseline = BASE_ENERGY[z.zone_id]  # always full
            smart_kw, light, hvac, screens = self._smart_energy(z, occ_pct)

            z.baseline_kw = baseline
            z.smart_kw = smart_kw
            z.lighting_pct = light
            z.hvac_pct = hvac
            z.screens_on = screens

            self.state.total_baseline_kwh += baseline * hours
            self.state.total_smart_kwh += smart_kw * hours

        return self.state.to_dict()

    def reset(self):
        self.state = StadiumState()
        for z in ZONES:
            self.state.zones[z["id"]] = ZoneState(zone_id=z["id"])
