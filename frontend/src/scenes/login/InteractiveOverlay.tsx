/**
 * INTERACTIVE OVERLAY — SVG transparente sobre la imagen base del almacén.
 *
 * Proporciona:
 *   - Hotspots con hover/click
 *   - Evento demo en loop (pulso cyan localizado)
 *   - Labels con líneas cortas de conexión
 *   - Iluminación localizada (solo rack activo)
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LOGIN_RACK_HOTSPOTS, EVENT_SEQUENCE, type RackHotspot } from './hotspots';
import { easing } from '../../design/motion/easing';

interface InteractiveOverlayProps {
  reducedMotion: boolean;
}

export const InteractiveOverlay = memo(function InteractiveOverlay({ reducedMotion }: InteractiveOverlayProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [eventRackId, setEventRackId] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── EVENT DEMO LOOP ─────────────────────────────────────────────────────
  useEffect(() => {
    if (reducedMotion) return;
    let idx = 0;
    let cancelled = false;

    function tick() {
      if (cancelled) return;
      const ev = EVENT_SEQUENCE[idx % EVENT_SEQUENCE.length]!;
      setEventRackId(ev.rackId);
      setShowConfirmation(false);

      // Show confirmation after half the duration
      timerRef.current = setTimeout(() => {
        if (cancelled) return;
        setShowConfirmation(true);
      }, ev.durationMs * 0.4);

      // Move to next
      timerRef.current = setTimeout(() => {
        if (cancelled) return;
        setShowConfirmation(false);
        idx++;
        tick();
      }, ev.durationMs);
    }

    // Start after initial delay
    const startTimer = setTimeout(tick, 2000);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
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

  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ pointerEvents: 'none' }}
    >
      <defs>
        {/* Glow filter for active hotspot */}
        <filter id="login-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.4" result="blur" />
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
      {LOGIN_RACK_HOTSPOTS.map((hs) => {
        const visible = activeId === hs.id;
        return (
          <RackLabel
            key={`lbl-${hs.id}`}
            hotspot={hs}
            visible={visible}
            reducedMotion={reducedMotion}
          />
        );
      })}

      {/* ── EVENT PULSE ────────────────────────────────────────────── */}
      <AnimatePresence>
        {eventRackId && !selectedId && !hoveredId && (
          <EventPulse
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
  const strokeColor = isActive ? 'rgba(0,216,255,0.6)' : 'rgba(0,216,255,0.15)';
  const fillColor = isActive ? 'rgba(0,216,255,0.06)' : 'transparent';

  return (
    <g>
      {/* Visible boundary */}
      <rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.w}
        height={bounds.h}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={isActive ? 0.3 : 0.15}
        rx={0.4}
        opacity={isActive || isEvent ? 1 : 0.5}
        filter={isActive ? 'url(#login-glow)' : undefined}
      />
      {/* Invisible clickable area (larger hit target) */}
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
    <g opacity={visible ? 1 : 0} style={{ transition: reducedMotion ? 'none' : 'opacity 0.3s ease' }}>
      {/* Connector line */}
      <line
        x1={anchor.x}
        y1={anchor.y}
        x2={label.x}
        y2={label.y + 3}
        stroke="rgba(0,216,255,0.5)"
        strokeWidth={0.12}
        strokeDasharray="0.4,0.3"
      />
      {/* Anchor dot */}
      <circle cx={anchor.x} cy={anchor.y} r={0.4} fill="rgba(0,216,255,0.8)" />
      {/* Label background */}
      <rect
        x={label.x - 1}
        y={label.y - 0.5}
        width={11}
        height={4}
        rx={0.4}
        fill="rgba(2,12,22,0.85)"
        stroke="rgba(0,216,255,0.4)"
        strokeWidth={0.12}
      />
      {/* Label text — rack code */}
      <text
        x={label.x + 0.5}
        y={label.y + 1.6}
        fill="rgb(0,216,255)"
        fontSize={1.5}
        fontFamily="var(--font-data)"
        fontWeight={600}
      >
        {id}
      </text>
      {/* Label text — locations */}
      <text
        x={label.x + 0.5}
        y={label.y + 3}
        fill="rgba(200,220,240,0.7)"
        fontSize={1.1}
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
      {/* Outer ring — breathing */}
      <motion.circle
        cx={eventPoint.x}
        cy={eventPoint.y}
        r={1.8}
        fill="none"
        stroke="rgba(0,216,255,0.5)"
        strokeWidth={0.15}
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{
          scale: [0.8, 1.3, 0.8],
          opacity: [0.3, 0.7, 0.3],
        }}
        exit={{ opacity: 0 }}
        transition={{
          duration: reducedMotion ? 0 : 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
      {/* Core dot */}
      <motion.circle
        cx={eventPoint.x}
        cy={eventPoint.y}
        r={0.6}
        fill="rgba(0,216,255,0.9)"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
      />
      {/* Confirmation badge */}
      {showConfirmation && (
        <motion.g
          initial={{ opacity: 0, y: 1 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: easing.emerge }}
        >
          <rect
            x={eventPoint.x + 2}
            y={eventPoint.y - 1.5}
            width={14}
            height={3}
            rx={0.5}
            fill="rgba(2,12,22,0.9)"
            stroke="rgba(0,216,255,0.5)"
            strokeWidth={0.1}
          />
          <text
            x={eventPoint.x + 3}
            y={eventPoint.y + 0.5}
            fill="rgba(0,216,255,0.9)"
            fontSize={1.3}
            fontFamily="var(--font-data)"
          >
            lectura confirmada ✓
          </text>
        </motion.g>
      )}
    </g>
  );
}
