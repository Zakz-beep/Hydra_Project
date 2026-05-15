'use client';
import React, { useEffect, useRef, useState, useCallback } from 'react';

const AIS_API_KEY = '7b5ed5c64b27204e09a3cdede6989046d1fb8c09';
const MAX_SHIPS = 3000;

interface ShipData {
  mmsi: string;
  name: string;
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  course: number;
  shipType: number;
  status: number;
  timestamp: number;
  destination: string;
  length?: number;
}

type ShipFilter = 'all' | 'cargo' | 'tanker' | 'passenger' | 'fishing' | 'utility';

function getShipType(typeCode: number): { label: string; color: string } {
  if (typeCode >= 70 && typeCode <= 79) return { label: 'Cargo', color: '#3b82f6' };
  if (typeCode >= 80 && typeCode <= 89) return { label: 'Tanker', color: '#f59e0b' };
  if (typeCode >= 60 && typeCode <= 69) return { label: 'Passenger', color: '#10b981' };
  if (typeCode >= 30 && typeCode <= 39) return { label: 'Fishing', color: '#8b5cf6' };
  if (typeCode >= 50 && typeCode <= 59) return { label: 'Utility', color: '#06b6d4' };
  return { label: 'Other', color: '#52525b' };
}

function matchesFilter(typeCode: number, f: ShipFilter): boolean {
  if (f === 'all') return true;
  if (f === 'cargo' && typeCode >= 70 && typeCode <= 79) return true;
  if (f === 'tanker' && typeCode >= 80 && typeCode <= 89) return true;
  if (f === 'passenger' && typeCode >= 60 && typeCode <= 69) return true;
  if (f === 'fishing' && typeCode >= 30 && typeCode <= 39) return true;
  if (f === 'utility' && typeCode >= 50 && typeCode <= 59) return true;
  return false;
}

function lonToX(lon: number, W: number) { return (lon + 180) * (W / 360); }
function latToY(lat: number, H: number) {
  const clamped = Math.max(-85, Math.min(85, lat));
  const r = (clamped * Math.PI) / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + r / 2));
  return H / 2 - (H * mercN) / (2 * Math.PI);
}

function decodeLand(topo: any): number[][][] {
  const { arcs, transform, objects } = topo;
  const { scale, translate } = transform;
  const decoded = arcs.map((arc: number[][]) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]: number[]) => {
      x += dx; y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
  const polys: number[][][] = [];
  const geoms = objects.land?.geometries || [];
  for (const g of geoms) {
    const process = (arcIdxs: number[]) => {
      const ring = arcIdxs.flatMap((i: number) =>
        i < 0 ? [...decoded[~i]].reverse() : decoded[i]
      );
      polys.push(ring);
    };
    if (g.type === 'Polygon') process(g.arcs[0]);
    else if (g.type === 'MultiPolygon') g.arcs.forEach((p: number[][]) => process(p[0]));
  }
  return polys;
}

const NAV_STATUS = ['Underway (Engine)','At Anchor','Not Under Command','Restricted Manoeuvrability','Constrained by Draft','Moored','Aground','Fishing','Underway (Sailing)'];

export default function AISMapDashboard() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const shipsRef = useRef<Map<string, ShipData>>(new Map());
  const rafRef = useRef<number>(0);
  const worldRef = useRef<number[][][]>([]);
  const filterRef = useRef<ShipFilter>('all');
  const selectedRef = useRef<string | null>(null);

  const [connStatus, setConnStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [shipCount, setShipCount] = useState(0);
  const [msgRate, setMsgRate] = useState(0);
  const [selectedShip, setSelectedShip] = useState<ShipData | null>(null);
  const [filter, setFilter] = useState<ShipFilter>('all');

  // Load world atlas
  useEffect(() => {
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json')
      .then(r => r.json())
      .then(topo => { worldRef.current = decodeLand(topo); })
      .catch(console.error);
  }, []);

  // Canvas draw loop
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    // Ocean
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0a1628');
    grad.addColorStop(1, '#0d1f38');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 0.5;
    for (let lon = -180; lon <= 180; lon += 30) {
      ctx.beginPath(); ctx.moveTo(lonToX(lon, W), 0); ctx.lineTo(lonToX(lon, W), H); ctx.stroke();
    }
    for (let lat = -60; lat <= 75; lat += 30) {
      ctx.beginPath(); ctx.moveTo(0, latToY(lat, H)); ctx.lineTo(W, latToY(lat, H)); ctx.stroke();
    }

    // Equator highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, latToY(0, H)); ctx.lineTo(W, latToY(0, H)); ctx.stroke();

    // Continents
    if (worldRef.current.length > 0) {
      ctx.fillStyle = '#162030';
      ctx.strokeStyle = '#1e3050';
      ctx.lineWidth = 0.7;
      for (const poly of worldRef.current) {
        if (poly.length < 3) continue;
        ctx.beginPath();
        ctx.moveTo(lonToX(poly[0][0], W), latToY(poly[0][1], H));
        for (let i = 1; i < poly.length; i++) ctx.lineTo(lonToX(poly[i][0], W), latToY(poly[i][1], H));
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }

    // Ships
    const activeFilter = filterRef.current;
    const selMmsi = selectedRef.current;
    for (const ship of Array.from(shipsRef.current.values())) {
      if (!matchesFilter(ship.shipType, activeFilter)) continue;
      const x = lonToX(ship.lon, W);
      const y = latToY(ship.lat, H);
      if (x < -5 || x > W + 5 || y < -5 || y > H + 5) continue;
      const type = getShipType(ship.shipType);
      const isSel = ship.mmsi === selMmsi;
      const size = isSel ? 8 : 4;
      const hdg = (ship.heading > 0 && ship.heading < 360 ? ship.heading : ship.course) || 0;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((hdg * Math.PI) / 180);
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(size * 0.55, size * 0.7);
      ctx.lineTo(0, size * 0.35);
      ctx.lineTo(-size * 0.55, size * 0.7);
      ctx.closePath();

      if (isSel) {
        ctx.shadowColor = type.color;
        ctx.shadowBlur = 18;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.fillStyle = type.color;
        ctx.fill(); ctx.stroke();
      } else {
        ctx.fillStyle = type.color;
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    // Selected ship ring
    if (selMmsi) {
      const s = shipsRef.current.get(selMmsi);
      if (s) {
        const x = lonToX(s.lon, W), y = latToY(s.lat, H);
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    rafRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  // Canvas resize
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // WebSocket
  useEffect(() => {
    let msgCount = 0;
    let rateTimer: NodeJS.Timeout;

    const connect = () => {
      setConnStatus('connecting');
      const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
      wsRef.current = ws;

      ws.onopen = () => {
        setConnStatus('connected');
        ws.send(JSON.stringify({
          APIKey: AIS_API_KEY,
          BoundingBoxes: [[[-90, -180], [90, 180]]],
          FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
        }));
        rateTimer = setInterval(() => {
          setMsgRate(msgCount);
          msgCount = 0;
          setShipCount(shipsRef.current.size);
        }, 1000);
      };

      ws.onmessage = (e) => {
        try {
          msgCount++;
          const msg = JSON.parse(e.data);
          const mmsi = msg.MetaData?.MMSI?.toString();
          if (!mmsi) return;

          if (msg.MessageType === 'PositionReport') {
            const pos = msg.Message?.PositionReport;
            if (!pos || !pos.Latitude || !pos.Longitude) return;
            const existing = shipsRef.current.get(mmsi) || {} as ShipData;
            shipsRef.current.set(mmsi, {
              ...existing, mmsi,
              name: msg.MetaData?.ShipName?.trim() || existing.name || `#${mmsi}`,
              lat: pos.Latitude, lon: pos.Longitude,
              speed: pos.Sog ?? 0, heading: pos.TrueHeading ?? 511,
              course: pos.Cog ?? 0, status: pos.NavigationalStatus ?? 0,
              timestamp: Date.now(),
              shipType: existing.shipType ?? 0,
              destination: existing.destination ?? '',
            });
            if (shipsRef.current.size > MAX_SHIPS) {
              const k = shipsRef.current.keys().next().value;
              if (k) shipsRef.current.delete(k);
            }
          } else if (msg.MessageType === 'ShipStaticData') {
            const stat = msg.Message?.ShipStaticData;
            if (!stat) return;
            const existing = shipsRef.current.get(mmsi) || {} as ShipData;
            shipsRef.current.set(mmsi, {
              ...existing, mmsi,
              name: stat.Name?.trim() || existing.name || `#${mmsi}`,
              shipType: stat.Type ?? existing.shipType ?? 0,
              destination: stat.Destination?.trim() ?? existing.destination ?? '',
              length: stat.Dimension?.A + stat.Dimension?.B || existing.length,
              lat: existing.lat ?? 0, lon: existing.lon ?? 0,
              speed: existing.speed ?? 0, heading: existing.heading ?? 0,
              course: existing.course ?? 0, status: existing.status ?? 0,
              timestamp: Date.now(),
            });
          }

          if (selectedRef.current === mmsi) {
            const updated = shipsRef.current.get(mmsi);
            if (updated) setSelectedShip({ ...updated });
          }
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        setConnStatus('disconnected');
        clearInterval(rateTimer);
        setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      clearInterval(rateTimer);
      wsRef.current?.close();
    };
  }, []);

  // Click handler
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = (canvas.width / window.devicePixelRatio) / rect.width;
    const scaleY = (canvas.height / window.devicePixelRatio) / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const W = canvas.width / window.devicePixelRatio;
    const H = canvas.height / window.devicePixelRatio;

    let best: ShipData | null = null, bestDist = Infinity;
    for (const ship of Array.from(shipsRef.current.values())) {
      if (!matchesFilter(ship.shipType, filterRef.current)) continue;
      const sx = lonToX(ship.lon, W), sy = latToY(ship.lat, H);
      const d = Math.hypot(sx - cx, sy - cy);
      if (d < bestDist && d < 20) { bestDist = d; best = ship; }
    }
    selectedRef.current = best?.mmsi ?? null;
    setSelectedShip(best ? { ...best } : null);
  }, []);

  const setFilterBoth = (f: ShipFilter) => { filterRef.current = f; setFilter(f); };

  const FILTERS: { key: ShipFilter; label: string; color: string; dot: string }[] = [
    { key: 'all', label: 'ALL', color: 'text-zinc-300', dot: '#94a3b8' },
    { key: 'cargo', label: 'CARGO', color: 'text-blue-400', dot: '#3b82f6' },
    { key: 'tanker', label: 'TANKER', color: 'text-amber-400', dot: '#f59e0b' },
    { key: 'passenger', label: 'PASSENGER', color: 'text-emerald-400', dot: '#10b981' },
    { key: 'fishing', label: 'FISHING', color: 'text-violet-400', dot: '#8b5cf6' },
    { key: 'utility', label: 'UTILITY', color: 'text-cyan-400', dot: '#06b6d4' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-950 border border-zinc-800/80 rounded-xl p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">🌊</span>
              <h2 className="text-sm font-mono font-bold text-zinc-100 uppercase tracking-widest">AIS Live Ship Tracker</h2>
            </div>
            <p className="text-[10px] font-mono text-zinc-600 mt-0.5">Global Maritime Intelligence — AISStream.io WebSocket</p>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-mono font-bold uppercase border ${
            connStatus === 'connected' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : connStatus === 'connecting' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 animate-pulse'
            : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : connStatus === 'connecting' ? 'bg-amber-400 animate-bounce' : 'bg-red-400'}`} />
            {connStatus === 'connected' ? '⚡ LIVE' : connStatus === 'connecting' ? 'CONNECTING...' : 'RECONNECTING...'}
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className="text-2xl font-mono font-bold text-cyan-400">{shipCount.toLocaleString()}</div>
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Ships Tracked</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-mono font-bold text-blue-400">{msgRate}</div>
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Msgs / sec</div>
          </div>
        </div>
      </div>

      {/* Filter bar + legend */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilterBoth(f.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs font-bold border transition-all ${
              filter === f.key ? `bg-zinc-800 border-zinc-600 ${f.color}` : 'bg-zinc-950 border-zinc-800 text-zinc-600 hover:text-zinc-400'
            }`}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: f.dot }} />
            {f.label}
          </button>
        ))}
        <span className="text-[10px] font-mono text-zinc-600 ml-auto">Click a ship marker to inspect</span>
      </div>

      {/* Map canvas */}
      <div className="relative rounded-xl overflow-hidden border border-zinc-800/80 shadow-2xl" style={{ height: '520px' }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', cursor: 'crosshair', display: 'block' }}
          onClick={handleClick}
        />
        {/* Lat/Lon labels */}
        <div className="absolute bottom-3 left-4 text-[10px] font-mono text-zinc-600 pointer-events-none space-y-0.5">
          <div>90°N</div>
          <div>EQ</div>
          <div>90°S</div>
        </div>
        <div className="absolute top-2 right-4 text-[10px] font-mono text-zinc-600 pointer-events-none">
          Mercator Projection
        </div>
        {connStatus !== 'connected' && shipCount === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center space-y-2">
              <div className="text-3xl animate-pulse">🌐</div>
              <div className="text-sm font-mono text-zinc-500">Connecting to AISStream.io...</div>
            </div>
          </div>
        )}
      </div>

      {/* Selected ship detail */}
      {selectedShip ? (
        <div className="bg-zinc-950 border rounded-xl p-5 space-y-4" style={{ borderColor: getShipType(selectedShip.shipType).color + '40' }}>
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl" style={{ backgroundColor: getShipType(selectedShip.shipType).color + '20', border: `1px solid ${getShipType(selectedShip.shipType).color}40` }}>
                {selectedShip.shipType >= 70 && selectedShip.shipType <= 79 ? '📦'
                  : selectedShip.shipType >= 80 && selectedShip.shipType <= 89 ? '🛢️'
                  : selectedShip.shipType >= 60 && selectedShip.shipType <= 69 ? '🛳️'
                  : selectedShip.shipType >= 30 && selectedShip.shipType <= 39 ? '🎣' : '🚢'}
              </div>
              <div>
                <h3 className="font-mono font-bold text-zinc-100 text-lg">{selectedShip.name}</h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ backgroundColor: getShipType(selectedShip.shipType).color + '20', color: getShipType(selectedShip.shipType).color }}>
                    {getShipType(selectedShip.shipType).label}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500">MMSI: {selectedShip.mmsi}</span>
                </div>
              </div>
            </div>
            <button onClick={() => { selectedRef.current = null; setSelectedShip(null); }}
              className="text-zinc-600 hover:text-zinc-400 text-xs font-mono border border-zinc-800 px-2 py-1 rounded hover:bg-zinc-900 transition-colors">
              ✕ Deselect
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Speed', value: `${selectedShip.speed?.toFixed(1) ?? '--'} kn` },
              { label: 'Heading', value: selectedShip.heading > 0 && selectedShip.heading < 360 ? `${selectedShip.heading.toFixed(0)}°` : `${selectedShip.course?.toFixed(0) ?? '--'}° (COG)` },
              { label: 'Latitude', value: `${selectedShip.lat?.toFixed(4)}°` },
              { label: 'Longitude', value: `${selectedShip.lon?.toFixed(4)}°` },
              { label: 'Status', value: NAV_STATUS[selectedShip.status] ?? 'Unknown' },
              { label: 'Destination', value: selectedShip.destination || '—' },
              { label: 'Ship Type Code', value: selectedShip.shipType ? `${selectedShip.shipType}` : '—' },
              { label: 'Last Update', value: `${Math.floor((Date.now() - selectedShip.timestamp) / 1000)}s ago` },
            ].map(({ label, value }) => (
              <div key={label} className="bg-zinc-900/60 rounded-lg p-3 border border-zinc-800/60">
                <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">{label}</div>
                <div className="text-sm font-mono text-zinc-200 mt-0.5 truncate">{value}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-zinc-950/50 border border-zinc-800/40 rounded-xl p-4 text-center">
          <p className="text-[11px] font-mono text-zinc-600">Click on any ship marker on the map to inspect its details</p>
        </div>
      )}

      {/* Type legend */}
      <div className="flex flex-wrap gap-4 justify-center py-2">
        {[
          { color: '#3b82f6', label: 'Cargo (70-79)' },
          { color: '#f59e0b', label: 'Tanker (80-89)' },
          { color: '#10b981', label: 'Passenger (60-69)' },
          { color: '#8b5cf6', label: 'Fishing (30-39)' },
          { color: '#06b6d4', label: 'Utility (50-59)' },
          { color: '#52525b', label: 'Other' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 10 10">
              <polygon points="5,0 9,9 5,6 1,9" fill={color} />
            </svg>
            <span className="text-[10px] font-mono text-zinc-500">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
