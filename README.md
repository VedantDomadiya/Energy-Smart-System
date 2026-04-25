# Energy-Smart Stadium ⚡

Real-time IoT + ML system that reduces energy waste in large sporting venues by 25–40% through zone-aware occupancy tracking and adaptive control of HVAC, lighting, and screens.

## What it does
- Simulates a stadium with 8 zones (stands, concourses, food court, restrooms)
- Drives a realistic match timeline: Pre-Game → First Half → Halftime → Second Half → Post-Game
- Streams live occupancy + energy telemetry over WebSocket
- Applies a smart control policy (dim/throttle when zones are empty)
- ML forecaster (rolling linear regression) predicts 15-step-ahead occupancy per zone
- Dashboard: stadium heatmap, baseline-vs-smart chart, per-zone control state + AI advice
- Tracks cumulative kWh saved, ₹ saved, CO₂ avoided

## Stack
- **Backend**: FastAPI + Uvicorn (async WebSocket broadcast)
- **ML**: NumPy rolling linear regression
- **Frontend**: Vanilla JS + Chart.js (no build step)
- **Container**: Docker + docker-compose
- **Deploy target**: GCP e2-micro VM (free-tier friendly)

## Run locally

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
```

Open http://localhost:8080

### Or with Docker

```bash
docker compose up --build
```

Open http://localhost

## Deploy to GCP (e2-micro VM)

### 1. Create the VM
```bash
gcloud compute instances create stadium-demo \
  --machine-type=e2-micro \
  --zone=asia-south1-a \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --tags=http-server
```

### 2. Allow HTTP
```bash
gcloud compute firewall-rules create allow-http \
  --allow tcp:80 --target-tags=http-server
```

### 3. SSH in and install Docker
```bash
gcloud compute ssh stadium-demo --zone=asia-south1-a

# on the VM
sudo apt update
sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER && newgrp docker
```

### 4. Deploy
```bash
# copy the project to the VM (one option: gcloud scp)
gcloud compute scp --recurse . stadium-demo:~/stadium --zone=asia-south1-a

# on the VM
cd ~/stadium
docker compose up -d --build
```

Visit `http://<VM_EXTERNAL_IP>`

## Cost on $5 credits
- e2-micro is **free tier** in one region (1 instance, 30 GB standard disk) — credits untouched
- Egress minimal for a demo — well within budget

## Architecture

```
┌──────────────┐     WebSocket      ┌───────────────┐
│  Browser UI  │◄──────────────────►│  FastAPI app  │
│ (static JS)  │                    │               │
└──────────────┘                    │  ┌─────────┐  │
                                    │  │Simulator│  │
                                    │  └────┬────┘  │
                                    │       ▼       │
                                    │  ┌─────────┐  │
                                    │  │Predictor│  │
                                    │  └────┬────┘  │
                                    │       ▼       │
                                    │  ┌─────────┐  │
                                    │  │Control- │  │
                                    │  │ler poli-│  │
                                    │  │cy (Rule)│  │
                                    │  └─────────┘  │
                                    └───────────────┘
```

## Scaling path (talk-track for judges)

1. **Swap simulator for real feeds** — CCTV (YOLO person-count), WiFi probe-based occupancy, turnstile counts.
2. **Replace linear regressor** with LSTM / Prophet for multi-horizon forecasts; train per-zone.
3. **Actuator bridge** — MQTT to BMS (Building Management System) / Modbus relays.
4. **Multi-tenant** — one backend pod per stadium, Cloud Run autoscale + Firestore for history.
5. **Cost engine** — pull real grid tariff + demand-charge signals; shift pre-cooling to low-tariff windows.

## Demo script (60-sec pitch)

> Stadiums waste 30–40% of energy running full lighting and AC in empty zones.
> Our system tracks live occupancy per zone and adapts lighting/HVAC/screens in real time.
> In this simulated match, we save **X kWh / ₹Y / Z kg CO₂** — scaled to a full season
> that's ~₹50 lakh and 400 tonnes CO₂ per venue.
