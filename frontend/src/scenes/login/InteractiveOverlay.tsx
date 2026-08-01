/**
 * INTERACTIVE OVERLAY — SVG transparente sobre la imagen base del almacén.
 *
 * Usa viewBox con las mismas proporciones que el asset recortado para que
 * las coordenadas % de los hotspots se alineen perfectamente con la imagen.
 *
 * preserveAspectRatio="xMidYMid slice" coincide con object-fit:cover del <img>.
 *
 * Proporciona:
 *   - Hotspots con hover/click
 *   - Evento demo en loop (pulso cyan localizado)
 *   - Labels con líneas cortas de conexión
 *   - Iluminación localizada (solo rack activo)
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LOGIN_RACK_HOTSPOTS,
  EVENT_SEQUENCE,
  type RackHotspot,
} from './hotspots';
import { easing } from '../../design/motion/easing';

interface InteractiveOverlayProps {
  reducedMotion: boolean;
}

export const InteractiveOverlay = memo(function InteractiveOverlay({ reducedMotion }: InteractiveOverlayProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [eventRackId, setEventRackId] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ── EVENT DEMO LOOP ─────────────────────────────────────────────────────
  useEffect(() => {
    if (reducedMotion) return;
    let idx = 0;
    let cancelled = false;

    function clearTimers() {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    }

    function tick() {
      if (cancelled) return;
      clearTimers();
      const ev = EVENT_SEQUENCE[idx % EVENT_SEQUENCE.length]!;
      setEventRackId(ev.rackId);
      setShowConfirmation(false);

      // Show "lectura confirmada" after 40% of duration
      const t1 = setTimeout(() => {
        if (cancelled) return;
        setShowConfirmation(true);
      }, ev.durationMs * 0.4);
      timersRef.current.push(t1);

      // Move to next rack
      const t2 = setTimeout(() => {
        if (cancelled) return;
        setShowConfirmation(false);
        idx++;
        tick();
      }, ev.durationMs);
      timersRef.current.push(t2);
    }

    // Start after 2s initial delay
    const startTimer = setTimeout(tick, 2000);
    timersRef.current.push(startTimer);

    return () => {
      cancelled = true;
      clearTimers();
    };
  }, [reducedMotion]);

  // ── ESCAPE TO CLEAR ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleClick = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  const activeId = selectedId ?? hoveredId ?? eventRackId;

  // viewBox uses normalized 0–100 coordinate system (hotspots are in %)
  // preserveAspectRatio matches object-fit:cover behavior
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      style={{ pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <defs>
        <filter id="login-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* ── HOTSPOT REGIONS ────────────────────────────────────────── */}
      {LOGIN_RACK_HOTSPOTS.map((hs) => (
        <HotspotRegion
          key={hs.id}
          hotspot={hs}
          isActive={activeId === hs.id}
          isEvent={eventRackId === hs.id && !selectedId && !hoveredId}
          onHover={setHoveredId}
          onClick={handleClick}
        />
      ))}

      {/* ── LABELS ─────────────────────────────────────────────────── */}
      {LOGIN_RACK_HOTSPOTS.map((hs) => (
        <RackLabel
          key={`lbl-${hs.id}`}
          hotspot={hs}
          visible={activeId === hs.id}
          reducedMotion={reducedMotion}
        />
      ))}

      {/* ── EVENT PULSE ────────────────────────────────────────────── */}
      <AnimatePresence>
        {eventRackId && !selectedId && !hoveredId && (
          <EventPulse
            key={eventRackId}
            hotspot={LOGIN_RACK_HOTSPOTS.find((h) => h.id === eventRackId)!}
            showConfirmation={showConfirmation}
            reducedMotion={reducedMotion}
          />
        )}
      </AnimatePresence>
    </svg>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

interface HotspotRegionProps {
  hotspot: RackHotspot;
  isActive: boolean;
  isEvent: boolean;
  onHover: (id: string | null) => void;
  onClick: (id: string) => void;
}

function HotspotRegion({ hotspot, isActive, isEvent, onHover, onClick }: HotspotRegionProps) {
  const { bounds } = hotspot;
  const strokeColor = isActive ? 'rgba(0,216,255,0.55)' : 'rgba(0,216,255,0.12)';
  const fillColor = isActive ? 'rgba(0,216,255,0.05)' : 'transparent';

  return (
    <g>
      {/* Visible boundary — subtle rectangle over rack area */}
      <rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.w}
        height={bounds.h}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={isActive ? 0.25 : 0.1}
        rx={0.3}
        opacity={isActive || isEvent ? 1 : 0.4}
        filter={isActive ? 'url(#login-glow)' : undefined}
      />
      {/* Invisible clickable area (slightly larger hit target) */}
      <rect
        x={bounds.x - 1}
        y={bounds.y - 1}
        width={bounds.w + 2}
        height={bounds.h + 2}
        fill="transparent"
        style={{ pointerEvents: 'all', cursor: 'pointer' }}
        onMouseEnter={() => onHover(hotspot.id)}
        onMouseLeave={() => onHover(null)}
        onClick={() => onClick(hotspot.id)}
      />
    </g>
  );
}

interface RackLabelProps {
  hotspot: RackHotspot;
  visible: boolean;
  reducedMotion: boolean;
}

function RackLabel({ hotspot, visible, reducedMotion }: RackLabelProps) {
  const { anchor, label, id, locations } = hotspot;

  return (
    <g
      opacity={visible ? 1 : 0}
      style={{ transition: reducedMotion ? 'none' : 'opacity 0.3s ease' }}
    >
      {/* Connector line — short, from anchor to label */}
      <line
        x1={anchor.x}
        y1={anchor.y}
        x2={label.x + 4}
        y2={label.y + 2.5}
        stroke="rgba(0,216,255,0.45)"
        strokeWidth={0.1}
        strokeDasharray="0.3,0.25"
      />
      {/* Anchor dot on rack */}
      <circle cx={anchor.x} cy={anchor.y} r={0.35} fill="rgba(0,216,255,0.75)" />
      {/* Label background pill */}
      <rect
        x={label.x}
        y={label.y}
        width={10}
        height={4.5}
        rx={0.4}
        fill="rgba(2,12,22,0.88)"
        stroke="rgba(0,216,255,0.35)"
        strokeWidth={0.1}
      />
      {/* Rack code */}
      <text
        x={label.x + 0.8}
        y={label.y + 1.8}
        fill="rgb(0,216,255)"
        fontSize={1.4}
        fontFamily="var(--font-data)"
        fontWeight={600}
      >
        {id}
      </text>
      {/* Location count */}
      <text
        x={label.x + 0.8}
        y={label.y + 3.5}
        fill="rgba(200,220,240,0.65)"
        fontSize={1.0}
        fontFamily="var(--font-data)"
      >
        {locations} ubicaciones
      </text>
    </g>
  );
}

interface EventPulseProps {
  hotspot: RackHotspot;
  showConfirmation: boolean;
  reducedMotion: boolean;
}

function EventPulse({ hotspot, showConfirmation, reducedMotion }: EventPulseProps) {
  const { eventPoint } = hotspot;

  return (
    <g>
      {/* Outer breathing ring */}
      {!reducedMotion && (
        <motion.circle
          cx={eventPoint.x}
          cy={eventPoint.y}
          r={1.6}
          fill="none"
          stroke="rgba(0,216,255,0.45)"
          strokeWidth={0.12}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{
            scale: [0.8, 1.4, 0.8],
            opacity: [0.2, 0.6, 0.2],
          }}
          exit={{ opacity: 0 }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      {/* Core dot */}
      <motion.circle
        cx={eventPoint.x}
        cy={eventPoint.y}
        r={0.5}
        fill="rgba(0,216,255,0.85)"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
      />
      {/* "lectura confirmada" badge */}
      <AnimatePresence>
        {showConfirmation && (
          <motion.g
            initial={{ opacity: 0, y: 0.8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: easing.emerge }}
          >
            <rect
              x={eventPoint.x + 2.5}
              y={eventPoint.y - 1.8}
              width={15}
              height={3.2}
              rx={0.4}
              fill="rgba(2,12,22,0.9)"
              stroke="rgba(0,216,255,0.45)"
              strokeWidth={0.08}
            />
            <text
              x={eventPoint.x + 3.5}
              y={eventPoint.y + 0.3}
              fill="rgba(0,216,255,0.85)"
              fontSize={1.2}
              fontFamily="var(--font-data)"
            >
              lectura confirmada ✓
            </text>
          </motion.g>
        )}
      </AnimatePresence>
    </g>
  );
}
