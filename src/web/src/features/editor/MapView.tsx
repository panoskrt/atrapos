import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { baseLayers, loadMapView, storeMapView, type BaseLayerId } from './baseLayers';
import { nearestDistance, positionAtDistance, segmentMidpoint, type Coord, type LonLat } from './geo';
import { LocationSearch } from './LocationSearch';
import { useMe } from '../auth/useMe';
import { lookupElevation, placePoi } from '../pois/placement';
import { poiGlyph } from '../pois/poiTypes';
import { useEditorStore, useHoverStore, type EditorPoi, type EditorPoint } from './store';
import styles from './Editor.module.css';

interface Props {
  segments: Coord[][];
  line: Coord[];
  cumulative: number[];
  /** Where to draw each control point (on the trail for snapped segments). */
  markerPositions: LonLat[];
  baseLayer: BaseLayerId;
  /** Increment to ask the map to fit the route. */
  fitRequest: number;
  /** Increment to centre on the user's location (asks the browser for permission). */
  locateRequest: number;
  /** Pan here when seq changes (e.g. a POI picked from the list). */
  focus: { lon: number; lat: number; seq: number } | null;
}

const prefersReducedMotion =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const toLatLng = (c: Coord | LonLat): L.LatLngTuple => (Array.isArray(c) ? [c[1], c[0]] : [c.lat, c.lon]);

// Marker icons must not change while a marker is being dragged: setIcon() replaces the element the drag is bound
// to, the drag never ends and the drop is lost. So icons depend only on what can't change mid-drag, and
// selection is a CSS class toggled on the existing element.
function vertexIcon(kind: 'start' | 'end' | 'mid') {
  return L.divIcon({
    className: `${styles.vertex} ${styles[`vertex_${kind}`]}`,
    iconSize: kind === 'mid' ? [14, 14] : [18, 18],
    html: kind === 'start' ? '<span>S</span>' : kind === 'end' ? '<span>E</span>' : '',
  });
}

/** Toggles a class on the marker's own element (re-applied if the icon is ever recreated). */
function useMarkerClass(marker: RefObject<L.Marker | null>, className: string | undefined, on: boolean, iconKey: unknown) {
  useEffect(() => {
    if (className) marker.current?.getElement()?.classList.toggle(className, on);
  }, [marker, className, on, iconKey]);
}

/** react-leaflet only applies `title` when the marker is created; keep the tooltip (and its accessible name)
 *  current when points are reordered or POIs renamed. */
function useMarkerTitle(marker: RefObject<L.Marker | null>, title: string, iconKey: unknown) {
  useEffect(() => {
    const el = marker.current?.getElement();
    if (el) el.title = title;
  }, [marker, title, iconKey]);
}

/** The latest value, readable from handlers that are bound once. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

const insertIcon = L.divIcon({ className: styles.insertHandle, iconSize: [12, 12] });

export function MapView({ segments, line, cumulative, markerPositions, baseLayer, fitRequest, locateRequest, focus }: Props) {
  const saved = useMemo(() => loadMapView(), []);
  const layer = baseLayers.find((l) => l.id === baseLayer)!;
  const tool = useEditorStore((s) => s.tool);

  return (
    <MapContainer
      className={`${styles.map} ${tool !== 'select' ? styles.mapExtend : ''}`}
      center={saved ? [saved.lat, saved.lon] : [50, 10]}
      zoom={saved?.zoom ?? 4}
      zoomControl={false}
      doubleClickZoom
      // Respect "reduce motion": no animated zoom/pan.
      zoomAnimation={!prefersReducedMotion}
      fadeAnimation={!prefersReducedMotion}
      markerZoomAnimation={!prefersReducedMotion}
      attributionControl
    >
      <TileLayer
        key={layer.id}
        url={layer.url}
        attribution={layer.attribution}
        maxZoom={layer.maxZoom}
        subdomains={layer.subdomains ?? 'abc'}
        className="rpm-tiles"
      />
      <MapBehaviour line={line} cumulative={cumulative} fitRequest={fitRequest} locateRequest={locateRequest} focus={focus} />
      <RouteLayer segments={segments} line={line} cumulative={cumulative} markerPositions={markerPositions} />
      <PoiLayer line={line} cumulative={cumulative} />
      <LocationSearch />
    </MapContainer>
  );
}

/** Map-level events: click to extend or place a POI, view persistence, fit-to-route, zoom control placement. */
function MapBehaviour({
  line,
  cumulative,
  fitRequest,
  locateRequest,
  focus,
}: {
  line: Coord[];
  cumulative: number[];
  fitRequest: number;
  locateRequest: number;
  focus: Props['focus'];
}) {
  const map = useMap();
  const addPoint = useEditorStore((s) => s.addPoint);
  const addPoi = useEditorStore((s) => s.addPoi);
  const select = useEditorStore((s) => s.select);
  const selectPoi = useEditorStore((s) => s.selectPoi);
  const lineRef = useRef(line);
  lineRef.current = line;
  const cumulativeRef = useRef(cumulative);
  cumulativeRef.current = cumulative;
  // The editor starts fitRequest at 1 for a route that already has a line, 0 for a new one.
  const lastFit = useRef(0);
  const hasLine = line.length > 1;

  useMapEvents({
    click(e) {
      const tool = useEditorStore.getState().tool;
      if (tool === 'extend') {
        addPoint({ lon: e.latlng.lng, lat: e.latlng.lat });
      } else if (tool === 'poi') {
        const placed = placePoi(map, e.latlng, lineRef.current, cumulativeRef.current);
        const id = addPoi(placed);
        if (placed.ele === null)
          void lookupElevation(placed).then((ele) => useEditorStore.getState().setPoiElevationSilently(id, ele));
      } else {
        select(null);
        selectPoi(null);
      }
    },
    moveend() {
      const c = map.getCenter();
      storeMapView({ lat: c.lat, lon: c.lng, zoom: map.getZoom() });
    },
  });

  useEffect(() => {
    const zoom = L.control.zoom({ position: 'bottomright' });
    zoom.addTo(map);
    return () => {
      zoom.remove();
    };
  }, [map]);

  // Fit when an existing route opens and whenever asked; not while the user is drawing.
  useEffect(() => {
    if (!hasLine || lastFit.current === fitRequest) return;
    lastFit.current = fitRequest;
    map.fitBounds(L.latLngBounds(lineRef.current.map(toLatLng)), { padding: [48, 48], maxZoom: 15 });
  }, [map, fitRequest, hasLine]);

  useEffect(() => {
    if (focus) map.panTo([focus.lat, focus.lon], { animate: !prefersReducedMotion });
  }, [map, focus]);

  // Only on an explicit click: the browser asks for location permission.
  useEffect(() => {
    if (locateRequest === 0) return;
    const onError = (e: L.ErrorEvent) => window.alert(`Couldn't get your location: ${e.message}`);
    map.once('locationerror', onError);
    map.locate({ setView: true, maxZoom: 14 });
    return () => {
      map.off('locationerror', onError);
    };
  }, [map, locateRequest]);

  return null;
}

function RouteLayer({
  segments,
  line,
  cumulative,
  markerPositions,
}: {
  segments: Coord[][];
  line: Coord[];
  cumulative: number[];
  markerPositions: LonLat[];
}) {
  const points = useEditorStore((s) => s.points);
  const selectedId = useEditorStore((s) => s.selectedId);
  const hoverDistance = useHoverStore((s) => s.distance);
  const setHover = useHoverStore((s) => s.setDistance);
  const [drag, setDrag] = useState<{ index: number; pos: LonLat; inserting: boolean } | null>(null);

  const latlngs = useMemo(() => line.map(toLatLng), [line]);
  const hoverPos = hoverDistance !== null ? positionAtDistance(line, cumulative, hoverDistance) : null;
  const tool = useEditorStore((s) => s.tool);
  // In Add POI mode a click near the line must place a POI, not hit an insert handle.
  const showInsertHandles = tool !== 'poi' && points.length >= 2 && points.length < 400;

  const lineHandlers = useMemo<L.LeafletEventHandlerFnMap>(
    () => ({
      mousemove: (e) => setHover(nearestDistance(line, cumulative, { lon: e.latlng.lng, lat: e.latlng.lat })),
      mouseout: () => setHover(null),
    }),
    [line, cumulative, setHover],
  );

  // While dragging, show a rubber band to the neighbours; the real segments update on drop.
  // Inserting at index i sits between points i-1 and i; moving point i sits between i-1 and i+1.
  const rubberBand = useMemo(() => {
    if (!drag) return null;
    const prev = markerPositions[drag.index - 1];
    const next = drag.inserting ? markerPositions[drag.index] : markerPositions[drag.index + 1];
    return [prev, drag.pos, next].filter((p): p is LonLat => !!p).map(toLatLng);
  }, [drag, markerPositions]);

  const mids = useMemo(() => segments.map(segmentMidpoint), [segments]);

  return (
    <>
      {latlngs.length > 1 && (
        <>
          <Polyline positions={latlngs} pathOptions={{ className: styles.routeCasing, weight: 9 }} interactive={false} />
          <Polyline positions={latlngs} pathOptions={{ className: styles.routeLine, weight: 5 }} eventHandlers={lineHandlers} />
          {/* Wide invisible hit area so the line is easy to hover. */}
          <Polyline positions={latlngs} pathOptions={{ className: styles.routeHit, weight: 18, opacity: 0 }} eventHandlers={lineHandlers} />
        </>
      )}
      {rubberBand && <Polyline positions={rubberBand} pathOptions={{ className: styles.rubberBand, weight: 3 }} interactive={false} />}

      {showInsertHandles &&
        mids.map((mid, i) => {
          if (!mid || !points[i + 1]) return null;
          return (
            <InsertHandle
              key={`ins-${points[i]!.id}-${points[i + 1]!.id}`}
              position={mid}
              index={i + 1}
              onDrag={(pos) => setDrag(pos ? { index: i + 1, pos, inserting: true } : null)}
            />
          );
        })}

      {points.map((p, i) => (
        <VertexMarker
          key={p.id}
          point={p}
          display={markerPositions[i] ?? p}
          index={i}
          kind={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'mid'}
          selected={p.id === selectedId}
          onDrag={(pos) => setDrag(pos ? { index: i, pos, inserting: false } : null)}
        />
      ))}

      {hoverPos && (
        <CircleMarker
          center={toLatLng(hoverPos)}
          radius={7}
          pathOptions={{ className: styles.hoverMarker, weight: 3 }}
          interactive={false}
        />
      )}
    </>
  );
}

function VertexMarker({
  point,
  display,
  index,
  kind,
  selected,
  onDrag,
}: {
  point: EditorPoint;
  display: LonLat;
  index: number;
  kind: 'start' | 'end' | 'mid';
  selected: boolean;
  onDrag: (pos: LonLat | null) => void;
}) {
  const markerRef = useRef<L.Marker>(null);
  const icon = useMemo(() => vertexIcon(kind), [kind]);
  useMarkerClass(markerRef, styles.vertexSelected, selected, icon);
  const title = `Point ${index + 1}. Drag to move, right-click to delete.`;
  useMarkerTitle(markerRef, title, icon);
  // A new array every render would make react-leaflet reset the marker mid-drag.
  const position = useMemo<L.LatLngTuple>(() => [display.lat, display.lon], [display.lat, display.lon]);
  const onDragRef = useLatest(onDrag);

  // Bound once per point: re-binding during a drag isn't safe either.
  const handlers = useMemo<L.LeafletEventHandlerFnMap>(
    () => ({
      click: (e) => {
        L.DomEvent.stopPropagation(e);
        useEditorStore.getState().select(point.id);
      },
      contextmenu: (e) => {
        L.DomEvent.stopPropagation(e);
        useEditorStore.getState().deletePoint(point.id);
      },
      drag: (e) => {
        const ll = (e.target as L.Marker).getLatLng();
        onDragRef.current({ lon: ll.lng, lat: ll.lat });
      },
      dragend: (e) => {
        const ll = (e.target as L.Marker).getLatLng();
        onDragRef.current(null);
        const s = useEditorStore.getState();
        s.movePoint(point.id, { lon: ll.lng, lat: ll.lat });
        s.select(point.id);
      },
    }),
    [point.id, onDragRef],
  );

  return (
    <Marker
      ref={markerRef}
      position={position}
      icon={icon}
      draggable
      eventHandlers={handlers}
      keyboard={false}
      title={title}
      zIndexOffset={kind === 'mid' ? 500 : 1000}
    />
  );
}

function InsertHandle({ position, index, onDrag }: { position: LonLat; index: number; onDrag: (pos: LonLat | null) => void }) {
  const latLng = useMemo<L.LatLngTuple>(() => [position.lat, position.lon], [position.lat, position.lon]);
  const latest = useLatest({ index, position, onDrag });

  const handlers = useMemo<L.LeafletEventHandlerFnMap>(
    () => ({
      click: (e) => {
        L.DomEvent.stopPropagation(e);
        useEditorStore.getState().insertPoint(latest.current.index, latest.current.position);
      },
      drag: (e) => {
        const ll = (e.target as L.Marker).getLatLng();
        latest.current.onDrag({ lon: ll.lng, lat: ll.lat });
      },
      dragend: (e) => {
        const ll = (e.target as L.Marker).getLatLng();
        latest.current.onDrag(null);
        useEditorStore.getState().insertPoint(latest.current.index, { lon: ll.lng, lat: ll.lat });
      },
    }),
    [latest],
  );

  return (
    <Marker
      position={latLng}
      icon={insertIcon}
      draggable
      eventHandlers={handlers}
      keyboard={false}
      title="Drag to add a point here"
      zIndexOffset={0}
    />
  );
}

function poiIcon(type: number | null) {
  return L.divIcon({
    className: styles.poiMarker,
    iconSize: [30, 30],
    html: type === null ? '' : `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${poiGlyph(type)}"/></svg>`,
  });
}

function PoiLayer({ line, cumulative }: { line: Coord[]; cumulative: number[] }) {
  const me = useMe();
  const suuntoConnected = me.data?.suuntoConnected ?? false;
  const pois = useEditorStore((s) => s.pois);
  const selectedPoiId = useEditorStore((s) => s.selectedPoiId);
  const tool = useEditorStore((s) => s.tool);

  return (
    <>
      {pois.map((p) => (
        <PoiMarker
          key={p.id}
          poi={p}
          selected={p.id === selectedPoiId}
          draggable={tool !== 'extend'}
          line={line}
          cumulative={cumulative}
          suuntoConnected={suuntoConnected}
        />
      ))}
    </>
  );
}

function PoiMarker({
  poi,
  selected,
  draggable,
  line,
  cumulative,
  suuntoConnected,
}: {
  poi: EditorPoi;
  selected: boolean;
  draggable: boolean;
  line: Coord[];
  cumulative: number[];
  suuntoConnected: boolean;
}) {
  const map = useMap();
  const markerRef = useRef<L.Marker>(null);
  // The type can't change mid-drag (it's edited in the card), so it's safe in the icon; selection is a class.
  const icon = useMemo(() => poiIcon(suuntoConnected ? poi.poiType : null), [poi.poiType, suuntoConnected]);
  useMarkerClass(markerRef, styles.poiMarkerSelected, selected, icon);
  const title = `${poi.name}. Click to edit${draggable ? ', drag to move' : ''}.`;
  useMarkerTitle(markerRef, title, icon);
  const position = useMemo<L.LatLngTuple>(() => [poi.lat, poi.lon], [poi.lat, poi.lon]);
  const geometry = useLatest({ line, cumulative });

  const handlers = useMemo<L.LeafletEventHandlerFnMap>(
    () => ({
      click: (e) => {
        L.DomEvent.stopPropagation(e);
        useEditorStore.getState().selectPoi(poi.id);
      },
      dragend: (e) => {
        const placed = placePoi(map, (e.target as L.Marker).getLatLng(), geometry.current.line, geometry.current.cumulative);
        const s = useEditorStore.getState();
        s.updatePoi(poi.id, { lon: placed.lon, lat: placed.lat, ele: placed.ele });
        s.selectPoi(poi.id);
        if (placed.ele === null)
          void lookupElevation(placed).then((ele) => useEditorStore.getState().setPoiElevationSilently(poi.id, ele));
      },
    }),
    [map, poi.id, geometry],
  );

  return (
    <Marker
      ref={markerRef}
      position={position}
      icon={icon}
      draggable={draggable}
      eventHandlers={handlers}
      keyboard={false}
      title={title}
      zIndexOffset={selected ? 2000 : 1500}
    />
  );
}
