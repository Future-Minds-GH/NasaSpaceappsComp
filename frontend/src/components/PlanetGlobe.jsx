// A 3D Earth, Moon or Mars globe (globe.gl on three.js). On the landing page it spins slowly as a picture; on Explore
// a click picks that spot and outlines its HEALPix tile, while a drag only turns the globe, so people can keep looking
// around and pick again. Named sites are clickable labels.
import { useEffect, useRef, useState } from "react";
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
// How close (in degrees of arc) a press must be to a site dot to select the site: the dot's own radius (labelDotRadius), and a bigger reach for a finger.
const SITE_DOT_DEG = 2.4;
const TOUCH_REACH_DEG = 4;

/** The site nearest to (lat, lon) within `maxDeg` degrees of arc, or null. */
function siteNear(sites, lat, lon, maxDeg) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  let best = null;
  let bestDeg = maxDeg;
  for (const site of sites) {
    const cosine = Math.sin(radians(lat)) * Math.sin(radians(site.lat)) + Math.cos(radians(lat)) * Math.cos(radians(site.lat)) * Math.cos(radians(lon - site.lon));
    const deg = (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
    if (deg <= bestDeg) { best = site; bestDeg = deg; }
  }
  return best;
}
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
  const hoveredSiteRef = useRef(null);
  hoveredSiteRef.current = hoveredSite;
  // globe.gl and three.js (about 1.9 MB) load on first use, so they stay out of the main bundle. The data effects below wait for it.
  const [isReady, setIsReady] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  const sitesRef = useRef(sites);
  sitesRef.current = sites;

  // Create the globe once per body; later effects only update its data.
  useEffect(() => {
    const container = containerRef.current;
    let isCancelled = false;
    let teardown = () => {};
    setIsReady(false);
    setHasFailed(false);
    import("globe.gl").then(({ default: Globe }) => {
      if (!isCancelled) teardown = buildGlobe(Globe);
    }, () => {
      if (!isCancelled) setHasFailed(true);   // offline, or the file name changed after a new deploy
    });
    return () => {
      isCancelled = true;
      teardown();
    };

    function buildGlobe(Globe) {
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
    // globe.gl's own click is dropped after ANY pointer movement while pressed (three-render-objects sets "dragging" on the
    // first pointermove, with no distance limit), so a click with a little hand jitter never picked. We measure the press
    // ourselves: a press that ends within DRAG_TOLERANCE_PX of where it began is a pick; anything further is a drag.
    const pressStart = { x: 0, y: 0, isDown: false };
    const rememberPress = (event) => {
      pressStart.isDown = event.button === 0 && event.isPrimary;
      pressStart.x = event.clientX;
      pressStart.y = event.clientY;
    };
    const forgetPress = () => { pressStart.isDown = false; };   // pointercancel: the browser took the touch (scroll, call)
    const pickOnRelease = (event) => {
      if (!pressStart.isDown || event.button !== 0) return;
      pressStart.isDown = false;
      if (Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > DRAG_TOLERANCE_PX) return;
      // A mouse hovers a site dot before it clicks. A touch never hovers (and the library only knows a dot is under the finger
      // after its next raycast frame), so a tap is hit-tested here: the site whose dot is nearest the tapped spot, within reach.
      const rect = container.getBoundingClientRect();
      const coords = globe.toGlobeCoords(event.clientX - rect.left, event.clientY - rect.top); // null when the press misses the globe
      const site = hoveredSiteRef.current ?? (coords && siteNear(sitesRef.current, coords.lat, coords.lng, event.pointerType === "touch" ? TOUCH_REACH_DEG : SITE_DOT_DEG));
      if (site) handlersRef.current.onSelectSite?.(site);
      else if (coords) handlersRef.current.onPick?.(coords.lat, coords.lng);
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
      container.addEventListener("pointerdown", rememberPress, true);
      container.addEventListener("pointerup", pickOnRelease, true);
      container.addEventListener("pointercancel", forgetPress, true);
      container.addEventListener("pointermove", trackHover);
      container.addEventListener("pointerleave", clearHover);
    }
    globeRef.current = globe;
    setIsReady(true);

    const resizeObserver = new ResizeObserver(() => globe.width(container.clientWidth).height(container.clientHeight));
    resizeObserver.observe(container);
    return () => {
      container.removeEventListener("pointerdown", rememberPress, true);
      container.removeEventListener("pointerup", pickOnRelease, true);
      container.removeEventListener("pointercancel", forgetPress, true);
      container.removeEventListener("pointermove", trackHover);
      container.removeEventListener("pointerleave", clearHover);
      cancelAnimationFrame(hoverFrame);
      resizeObserver.disconnect();
      globe._destructor?.();
      container.replaceChildren();
      globeRef.current = null;
    };
    }
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
      // Pick globes handle site presses in pickOnRelease (mouse and touch); picture globes use the library click.
      .onLabelClick((site) => { if (!isInteractive) handlersRef.current.onSelectSite?.(site); });
  }, [sites, isReady]);

  // A picture globe can be made draggable later (output globes after Compute): turn and zoom, but no picking.
  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.enableRotate = isInteractive || isDraggable;
    controls.enableZoom = isInteractive || isDraggable;
  }, [isInteractive, isDraggable, isReady]);

  // Spinning can stop later (an output globe stops once it shows its best match, so it doesn't drift away from it).
  useEffect(() => {
    const controls = globeRef.current?.controls();
    if (!controls) return;
    controls.autoRotate = isSpinning && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, [isSpinning, isReady]);

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
  }, [markers, isReady]);

  useEffect(() => {
    const outline = selectedTile ? tileOutline(selectedTile.nside, selectedTile.index, 4) : null;
    globeRef.current
      // globe.gl follows d3-geo: an outer ring must run clockwise, or it fills everything except the tile.
      ?.polygonsData(outline ? [{ type: "Feature", geometry: { type: "Polygon", coordinates: [[...outline, outline[0]].reverse().map(([lat, lon]) => [lon, lat])] } }] : [])
      .polygonAltitude(0.012)
      .polygonCapColor(() => "rgba(99, 176, 138, 0.45)")
      .polygonSideColor(() => "rgba(99, 176, 138, 0.25)")
      .polygonStrokeColor(() => "#ffffff");
  }, [selectedTile, isReady]);

  useEffect(() => {
    if (!focus || !globeRef.current) return;
    const isReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    globeRef.current.pointOfView({ lat: focus.lat, lng: focus.lon, altitude: 1.6 }, isReducedMotion ? 0 : 900);
  }, [focus, isReady]);

  const failure = hasFailed && <p className="page-message globe-failed" role="alert">The globe could not load. Reload the page.</p>;
  if (!isInteractive) {
    return (
      <>
        <div ref={containerRef} className={`planet-globe${isDraggable ? " is-draggable" : ""}`} role="img" aria-label={label} />
        {failure}
      </>
    );
  }
  return (
    <div className="planet-globe-wrap">
      <div ref={containerRef} className="planet-globe is-pickable" role="img" aria-label={label} />
      {failure}
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
