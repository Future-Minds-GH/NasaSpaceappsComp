// A 3D Earth, Moon or Mars globe (globe.gl on three.js). On the landing page it spins slowly as a picture; on Explore
// a click picks that spot and outlines its HEALPix tile, while a drag only turns the globe, so people can keep looking
// around and pick again. Named sites are clickable labels.
import { useEffect, useRef, useState } from "react";
import Globe from "globe.gl";
import { tileOutline } from "../data/healpix.js";

export const GLOBE_TEXTURES = {
  earth: { url: "textures/earth.jpg", credit: "Blue Marble shaded relief, NASA GIBS" },
  moon: { url: "textures/moon.jpg", credit: "LRO WAC global mosaic, NASA Moon Trek" },
  mars: { url: "textures/mars.jpg", credit: "Viking MDIM 2.1 colour mosaic, NASA Mars Trek" },
};
// Where an Explore globe first looks: the Moon's south pole (where the base sites are), Mars's equatorial belt.
// Picture globes face the equator: the source mosaics are smeared right at the poles.
const START_VIEW = { earth: { lat: 20, lng: -40, altitude: 2.2 }, moon: { lat: -55, lng: 30, altitude: 2.2 }, mars: { lat: 10, lng: 100, altitude: 2.2 } };
const PICTURE_VIEW = { earth: { lat: 15, lng: -30, altitude: 2.2 }, moon: { lat: 5, lng: 20, altitude: 2.2 }, mars: { lat: 5, lng: -60, altitude: 2.2 } };
// A press that moves further than this before release is a drag (turning the globe), not a pick.
const DRAG_TOLERANCE_PX = 6;
const SPIN_SPEED = 0.6;

/**
 * @param {{ body: "earth"|"moon"|"mars", isInteractive?: boolean, isSpinning?: boolean, sites?: object[], markers?: { lat: number, lon: number, color: string }[], selectedTile?: { index: number, nside: number } | null,
 *           focus?: { lat: number, lon: number } | null, onPick?: (lat: number, lon: number) => void, onSelectSite?: (site: object) => void, label: string }} props
 */
export default function PlanetGlobe({ body, isInteractive = false, isDraggable = false, isSpinning = false, sites = [], markers = [], selectedTile = null, focus = null, onPick, onSelectSite, label }) {
  const containerRef = useRef(null);
  const globeRef = useRef(null);
  const handlersRef = useRef({ onPick, onSelectSite });
  handlersRef.current = { onPick, onSelectSite };
  // Live readout of the spot under the cursor (interactive globes only), so people can aim at an exact place.
  const [hover, setHover] = useState(null);
  const [hoveredSite, setHoveredSite] = useState(null); // a notable-site dot under the cursor

  // Create the globe once per body; later effects only update its data.
  useEffect(() => {
    const container = containerRef.current;
    const isReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const globe = new Globe(container, { animateIn: false })
      // No fade-in/out when markers, labels or the tile outline change: a new pick should appear the moment you click.
      .pointsTransitionDuration(0)
      .labelsTransitionDuration(0)
      .polygonsTransitionDuration(0)
      .globeImageUrl(GLOBE_TEXTURES[body].url)
      .backgroundColor("rgba(0,0,0,0)")
      .showAtmosphere(false)
      .width(container.clientWidth)
      .height(container.clientHeight)
      .pointOfView(isInteractive ? START_VIEW[body] : PICTURE_VIEW[body]);
    const controls = globe.controls();
    controls.autoRotate = isSpinning && !isReducedMotion;
    controls.autoRotateSpeed = SPIN_SPEED;
    controls.enableZoom = isInteractive;
    controls.enableRotate = isInteractive;
    const pressStart = { x: 0, y: 0 };
    const rememberPress = (event) => { pressStart.x = event.clientX; pressStart.y = event.clientY; };
    const pickUnlessDragged = ({ lat, lng }, event) => {
      if (event && Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > DRAG_TOLERANCE_PX) return;
      handlersRef.current.onPick?.(lat, lng);
    };
    let hoverFrame = 0;
    const trackHover = (event) => {
      cancelAnimationFrame(hoverFrame);
      hoverFrame = requestAnimationFrame(() => {
        const rect = container.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const coords = globe.toGlobeCoords(x, y);
        setHover(coords ? { lat: coords.lat, lon: coords.lng, x, y } : null);
      });
    };
    const clearHover = () => { cancelAnimationFrame(hoverFrame); setHover(null); setHoveredSite(null); };
    if (isInteractive) {
      container.addEventListener("pointerdown", rememberPress);
      container.addEventListener("pointermove", trackHover);
      container.addEventListener("pointerleave", clearHover);
      globe.onGlobeClick((coords, event) => pickUnlessDragged(coords, event));
      globe.onPolygonClick((polygon, event, coords) => pickUnlessDragged(coords, event));
      globe.onPointClick((point, event, coords) => pickUnlessDragged(coords, event));
    }
    globeRef.current = globe;

    const resizeObserver = new ResizeObserver(() => globe.width(container.clientWidth).height(container.clientHeight));
    resizeObserver.observe(container);
    return () => {
      container.removeEventListener("pointerdown", rememberPress);
      container.removeEventListener("pointermove", trackHover);
      container.removeEventListener("pointerleave", clearHover);
      cancelAnimationFrame(hoverFrame);
      resizeObserver.disconnect();
      globe._destructor?.();
      container.replaceChildren();
      globeRef.current = null;
    };
    // The globe is rebuilt only when the body changes; the props below are applied by their own effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  useEffect(() => {
    setHoveredSite(null); // a hovered dot from the previous planet or site list must not linger in the readout
    globeRef.current
      ?.labelsData(sites)
      .labelLat((site) => site.lat)
      .labelLng((site) => site.lon)
      // On the pick globe, sites are dots only (names would pile up); hovering a dot shows its name in the readout.
      .labelText((site) => (isInteractive ? "" : site.name))
      .labelSize(1.6)
      .labelDotRadius(isInteractive ? 2.4 : 0.7)
      .labelAltitude(0.012)
      .labelColor(() => (isInteractive ? "rgba(255, 200, 90, 0.95)" : "rgba(255, 255, 255, 0.92)"))
      .labelResolution(2)
      .onLabelHover((site) => setHoveredSite(site ?? null))
      .onLabelClick((site) => handlersRef.current.onSelectSite?.(site));
  }, [sites]);

  // A picture globe can be made draggable later (output globes after Compute): turn and zoom, but no picking.
  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.enableRotate = isInteractive || isDraggable;
    controls.enableZoom = isInteractive || isDraggable;
  }, [isInteractive, isDraggable]);

  // Spinning can stop later (an output globe stops once it shows its best match, so it doesn't drift away from it).
  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = isSpinning && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, [isSpinning]);

  // Markers: a bright raised dot with a pulsing ring, so a picked spot or a best match stands out on the globe.
  useEffect(() => {
    const isReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    globeRef.current
      ?.pointsData(markers)
      .pointLat((marker) => marker.lat)
      .pointLng((marker) => marker.lon)
      .pointColor((marker) => marker.color)
      .pointAltitude(0.06)
      .pointRadius(2.2)
      .pointsMerge(false)
      .ringsData(isReducedMotion ? [] : markers)
      .ringLat((marker) => marker.lat)
      .ringLng((marker) => marker.lon)
      .ringColor((marker) => (t) => hexToRgba(marker.color, 1 - t))
      .ringMaxRadius(12)
      .ringPropagationSpeed(6)
      .ringRepeatPeriod(800);
  }, [markers]);

  useEffect(() => {
    const outline = selectedTile ? tileOutline(selectedTile.nside, selectedTile.index, 4) : null;
    globeRef.current
      // globe.gl follows d3-geo: an outer ring must run clockwise, or it fills everything except the tile.
      ?.polygonsData(outline ? [{ type: "Feature", geometry: { type: "Polygon", coordinates: [[...outline, outline[0]].reverse().map(([lat, lon]) => [lon, lat])] } }] : [])
      .polygonAltitude(0.012)
      .polygonCapColor(() => "rgba(99, 176, 138, 0.45)")
      .polygonSideColor(() => "rgba(99, 176, 138, 0.25)")
      .polygonStrokeColor(() => "#ffffff");
  }, [selectedTile]);

  useEffect(() => {
    if (!focus || !globeRef.current) return;
    const isReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    globeRef.current.pointOfView({ lat: focus.lat, lng: focus.lon, altitude: 1.6 }, isReducedMotion ? 0 : 900);
  }, [focus]);

  if (!isInteractive) return <div ref={containerRef} className={`planet-globe${isDraggable ? " is-draggable" : ""}`} role="img" aria-label={label} />;
  return (
    <div className="planet-globe-wrap">
      <div ref={containerRef} className="planet-globe is-pickable" role="img" aria-label={label} />
      {hover && (
        <span className={`globe-readout${hoveredSite ? " is-site" : ""}`} style={{ left: hover.x, top: hover.y }} aria-hidden="true">
          {hoveredSite && <strong className="globe-readout-site">{hoveredSite.name}</strong>}
          {Math.abs(hover.lat).toFixed(2)}°{hover.lat >= 0 ? "N" : "S"} {Math.abs(hover.lon).toFixed(2)}°{hover.lon >= 0 ? "E" : "W"}
        </span>
      )}
    </div>
  );
}

function hexToRgba(hex, alpha) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${Math.max(alpha, 0).toFixed(3)})`;
}
