from collections import deque
from typing import Deque, Dict, List
import numpy as np


class OccupancyPredictor:
    """Lightweight next-N-step occupancy forecaster using linear extrapolation
    on a rolling window. Avoids heavy ML deps while still being demo-worthy."""

    def __init__(self, window: int = 20, horizon: int = 15):
        self.window = window
        self.horizon = horizon
        self.history: Dict[str, Deque[int]] = {}

    def observe(self, zone_id: str, occupancy: int):
        if zone_id not in self.history:
            self.history[zone_id] = deque(maxlen=self.window)
        self.history[zone_id].append(occupancy)

    def predict(self, zone_id: str) -> List[int]:
        hist = self.history.get(zone_id)
        if not hist or len(hist) < 3:
            return [hist[-1] if hist else 0] * self.horizon

        y = np.array(hist, dtype=float)
        x = np.arange(len(y))
        slope, intercept = np.polyfit(x, y, 1)
        future_x = np.arange(len(y), len(y) + self.horizon)
        preds = slope * future_x + intercept
        return [max(0, int(p)) for p in preds]

    def recommend(self, zone_id: str, current: int, capacity: int) -> str:
        preds = self.predict(zone_id)
        future_peak = max(preds)
        future_pct = future_peak / capacity if capacity else 0
        current_pct = current / capacity if capacity else 0

        if future_pct > current_pct + 0.2:
            return f"Surge expected — pre-cool zone now (predicted {int(future_pct*100)}% in ~15 ticks)"
        if future_pct < current_pct - 0.2:
            return f"Drop expected — prepare to dim (predicted {int(future_pct*100)}%)"
        return "Stable — maintain current setpoints"
