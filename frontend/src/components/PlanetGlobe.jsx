// A 3D Earth, Moon or Mars globe (globe.gl on three.js). On the landing page it spins slowly as a picture; on Explore
// a click picks that spot and outlines its HEALPix tile, while a drag only turns the globe, so people can keep looking
// around and pick again. Named sites are clickable labels.
import { useEffect, useRef } from "react";
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
 * @param {{ body: "earth"|"moon"|"mars", isInteractive?: boolean, isSpinning?: boolean, sites?: object[], selectedTile?: { index: number, nside: number } | null,
 *           focus?: { lat: number, lon: number } | null, onPick?: (lat: number, lon: number) => void, onSelectSite?: (site: object) => void, label: string }} props
 */
export default function PlanetGlobe({ body, isInteractive = false, isSpinning = false, sites = [], selectedTile = null, focus = null, onPick, onSelectSite, label }) {
  const containerRef = useRef(null);
  const globeRef = useRef(null);
  const handlersRef = useRef({ onPick, onSelectSite });
  handlersRef.current = { onPick, onSelectSite };

  // Create the globe once per body; later effects only update its data.
  useEffect(() => {
    const container = containerRef.current;
    const isReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const globe = new Globe(container, { animateIn: false })
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
    if (isInteractive) {
      container.addEventListener("pointerdown", rememberPress);
      globe.onGlobeClick((coords, event) => pickUnlessDragged(coords, event));
      globe.onPolygonClick((polygon, event, coords) => pickUnlessDragged(coords, event));
    }
    globeRef.current = globe;

    const resizeObserver = new ResizeObserver(() => globe.width(container.clientWidth).height(container.clientHeight));
    resizeObserver.observe(container);
    return () => {
      container.removeEventListener("pointerdown", rememberPress);
      resizeObserver.disconnect();
      globe._destructor?.();
      container.replaceChildren();
      globeRef.current = null;
    };
    // The globe is rebuilt only when the body changes; the props below are applied by their own effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  useEffect(() => {
    globeRef.current
      ?.labelsData(sites)
      .labelLat((site) => site.lat)
      .labelLng((site) => site.lon)
      .labelText((site) => site.name)
      .labelSize(1.6)
      .labelDotRadius(0.7)
      .labelColor(() => "rgba(255, 255, 255, 0.92)")
      .labelResolution(2)
      .onLabelClick((site) => handlersRef.current.onSelectSite?.(site));
  }, [sites]);

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

  return <div ref={containerRef} className="planet-globe" role="img" aria-label={label} />;
}
