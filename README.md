<div align="center">

# ⚙️ TransitDilliBack
### Ultra-Low Latency Telemetry Ingestion & Spatial Cache Engine for Delhi NCR

[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Fastify](https://img.shields.io/badge/Fastify-v4-000000?style=for-the-badge&logo=fastify&logoColor=white)](https://www.fastify.io/)
[![Prisma](https://img.shields.io/badge/Prisma-SQLite-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Protocol Buffers](https://img.shields.io/badge/Format-GTFS_RT_Protobuf-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://developers.google.com/transit/gtfs-realtime)
[![Spatial Index](https://img.shields.io/badge/Spatial_Index-KDBush_2D-10B981?style=for-the-badge)](https://github.com/mourner/kdbush)
[![Tests](https://img.shields.io/badge/Tests-35_Passing-10B981?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)
[![AWS](https://img.shields.io/badge/Deploy-AWS_EC2_%7C_Lightsail-FF9900?style=for-the-badge&logo=amazon-aws&logoColor=white)](https://aws.amazon.com/)

<p align="center">
  <b>TransitDilliBack</b> is the telemetry ingestion, authentication, and spatial discovery backbone of the TransitDilli ecosystem.<br/>
  It continuously ingests Delhi's live <code>VehiclePositions.pb</code> (~5,000 buses) every 9 seconds, parses it in memory, applies dual-agency classification, and serves sub-millisecond localized spatial queries (<b>&lt; 4 KB</b>) to mobile and web clients.
</p>

---

[📖 Complete Architecture Blueprint (TransitDilliBack.md)](./TransitDilliBack.md) • [🚀 Quick Start](#-quick-start) • [🔌 API Reference](#-api-endpoints) • [🧪 Testing](#-automated-testing)

</div>

---

## ⚡ Key Highlights & Innovations

* **🚀 >98% Bandwidth Compression:** Converts the full-city 520 KB binary Protobuf feed into a hyper-targeted `< 4 KB` JSON payload for the user's immediate 2 km radius.
* **🧠 Zero-Disk In-Memory Spatial Index:** Eliminates database write lock contention (avoiding 550+ SQL writes/sec) by updating an in-memory 2D KD-Tree (**KDBush**) in **~2 ms**, delivering radius queries in **< 0.05 ms** ($O(\log N)$).
* **🎨 Dual-Agency Classification Engine:** Automatically extracts fleet metadata from Delhi registration numbers and routes:
  - 🟢 **DTC State Fleet:** Emerald Green (`#10B981`)
  - 🔵 **DIMTS Cluster Fleet:** Royal Blue (`#2563EB`)
  - ⚡ **Electric Fleet (EV):** Cyan (`#06B6D4`), zero-emission badge, AC enabled
* **⏱️ Dynamic ETA & PIS Engine:** Calculates real-time stop-by-stop arrival countdowns in minutes along route paths using live vehicle velocity and dwell penalties.
* **🔐 Google OAuth & Profile System:** Cryptographic Google ID Token verification via `google-auth-library`, 15-day JWT session tokens, and Indian 10-digit mobile number profile setup.
* **📡 Real-Time SSE Streaming:** Server-Sent Events lane (`/stream`) for following a single bus smoothly with zero polling jitter.
* **⭐ Commuter Bookmarks:** Saved favorite stops and transit lines stored in SQLite via Prisma.

---

## 🏗️ Architecture Pipeline

```
[OTD Delhi VehiclePositions.pb]
         │ (520 KB Protobuf polled every 9s)
         ▼
[IngestionService (Circuit Breaker & Backoff)]
         │
         ▼
[Protobuf Decoder (gtfs-realtime-bindings)]
         │
         ▼
[NormalizerService (DTC vs DIMTS + EV + AC Classification)]
         │
         ▼
[SpatialIndexService (In-Memory KDBush 2D Tree)] ───▶ Sub-millisecond Radius Queries (<0.05ms)
         │
         ├───▶ [EtaService] ───▶ Stop Arrival Countdown Boards
         ├───▶ [VehicleStreamService] ───▶ SSE Live Streaming Lane
         ▼
[Fastify API Gateway & JWT Auth] ───▶ Serves Mobile App & Web Dashboard
```

---

## 🔌 API Endpoints Reference

### 1. Authentication & Profile (`/api/v1/auth`)
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/auth/google` | Public | Exchange Google ID token for TransitDilli JWT & Profile |
| `GET` | `/api/v1/auth/me` | Bearer JWT | Returns current authenticated commuter profile |
| `PUT` | `/api/v1/auth/profile` | Bearer JWT | Update commuter Name & 10-digit Indian Mobile Number |
| `POST` | `/api/v1/auth/logout` | Bearer JWT | Commuter logout acknowledgment |

### 2. Live Bus Telemetry & Spatial Radar (`/api/v1/buses`)
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/buses/nearby` | Query buses within radius (`lat`, `lon`, `radius`, `agency`, `electric`, `limit`) |
| `GET` | `/api/v1/buses/:vehicleId` | Single bus telemetry, route details, and stop-by-stop ETAs |
| `GET` | `/api/v1/buses/:vehicleId/stream` | **Server-Sent Events (SSE)** real-time live position stream |
| `GET` | `/api/v1/buses/stats` | Real-time fleet counters (Total, DTC, DIMTS, EV, AC) |
| `POST` | `/api/v1/buses/refresh` | Force manual refresh of OTD Delhi feed |

### 3. Transit Lines & Bus Stops (`/api/v1/transit`)
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/transit/routes` | All transit routes with active bus counts (supports `?search=`) |
| `GET` | `/api/v1/transit/:routeId` | Ordered stop sequence and active buses currently running on line |
| `GET` | `/api/v1/transit/stops/nearby` | Bus stops within walking distance of commuter (`lat`, `lon`, `radius`) |
| `GET` | `/api/v1/transit/stops/:stopId` | Bus stop metadata |
| `GET` | `/api/v1/transit/stops/:stopId/arrivals` | **PIS Arrival Board**: Incoming buses across all routes with countdown ETAs |

### 4. Commuter Bookmarks (`/api/v1/bookmarks` - Bearer JWT)
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/bookmarks/stops` | List commuter's saved bus stops |
| `POST` | `/api/v1/bookmarks/stops` | Save bus stop to favorites (`{ "stopId": "ST_AIIMS" }`) |
| `DELETE` | `/api/v1/bookmarks/stops/:stopId` | Remove stop from favorites |
| `GET` | `/api/v1/bookmarks/routes` | List commuter's saved transit lines |
| `POST` | `/api/v1/bookmarks/routes` | Save transit line to favorites (`{ "routeId": "534UP" }`) |
| `DELETE` | `/api/v1/bookmarks/routes/:routeId` | Remove line from favorites |

---

## 🚀 Quick Start

### 1. Install & Setup
```bash
cd TransitDilliBack
npm install

# Initialize SQLite database migrations
npx prisma migrate dev --name init

# Start in development mode (hot-reload)
npm run dev
```

### 2. Verify Health & Live Fleet
```bash
curl -s http://localhost:3000/health | jq .
```

### 3. Test Nearby Buses (AIIMS Hospital)
```bash
curl -s "http://localhost:3000/api/v1/buses/nearby?lat=28.5694&lon=77.2085&radius=2&limit=5" | jq .
```

---

## 🧪 Automated Testing

TransitDilliBack includes an end-to-end automated test suite powered by **Vitest**:
```bash
npm test
```
```text
 ✓ test/auth.test.ts (8 tests)
 ✓ test/bus.test.ts (15 tests)
 ✓ test/eta-stream.test.ts (5 tests)
 ✓ test/bookmark.test.ts (7 tests)

 Test Files  4 passed (4)
      Tests  35 passed (35)
   Duration  607ms
```

---

## ☁️ Production AWS Deployment (EC2 / Lightsail)

TransitDilliBack is designed for zero-maintenance single-instance AWS hosting using **PM2** and **Nginx**:

### 1. Start with PM2
```bash
npm run build
pm2 start ecosystem.config.js
pm2 save
```

### 2. Nginx Reverse Proxy & SSL
Copy `nginx-transitdilli.conf` to `/etc/nginx/sites-available/transitdilli`:
```bash
sudo ln -s /etc/nginx/sites-available/transitdilli /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.transitdilli.in
```

---

<div align="center">
  <b>Built for Delhi Commuters • Fast • Open Data • Private</b>
</div>
# TransitDilliBack
