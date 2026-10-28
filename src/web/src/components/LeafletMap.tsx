import L from 'leaflet';
import { createContext, useContext, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';

// Leaflet bound to React. The map and each layer are created once from their first props, updated in place when
// props change, and removed on unmount. (Not react-leaflet: its Hippocratic licence adds conditions the AGPL
// doesn't allow.)

const MapContext = createContext<L.Map | null>(null);

/** The map of the enclosing LeafletMap. */
export function useMap(): L.Map {
  const map = useContext(MapContext);
  if (!map) throw new Error('useMap needs a LeafletMap around it');
  return map;
}

interface LeafletMapProps extends L.MapOptions {
  center: L.LatLngExpression;
  zoom: number;
  className?: string;
  children?: ReactNode;
}

/** The map's container. The view and options are only read when the map is created; children render inside the
 *  container once the map exists. */
export function LeafletMap({ center, zoom, className, children, ...options }: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [initial] = useState({ center, zoom, options });
  const [map, setMap] = useState<L.Map | null>(null);

  // Leaflet adds its own classes to the container, so React mustn't own `className`: a change would replace them.
  // Applied before the map is created, which measures the container.
  useLayoutEffect(() => {
    const el = containerRef.current!;
    const names = className?.split(/\s+/).filter(Boolean) ?? [];
    el.classList.add(...names);
    return () => el.classList.remove(...names);
  }, [className]);

  useLayoutEffect(() => {
    const created = L.map(containerRef.current!, initial.options).setView(initial.center, initial.zoom);
    setMap(created);
    return () => {
      created.remove();
      setMap(null);
    };
  }, [initial]);

  return <div ref={containerRef}>{map && <MapContext value={map}>{children}</MapContext>}</div>;
}

/** Map-level event handlers, e.g. `click` or `moveend`. */
export function useMapEvents(handlers: L.LeafletEventHandlerFnMap) {
  const map = useMap();
  useEvents(map, handlers);
  return map;
}

/** A tile layer; replaced when any of its settings change. */
export function TileLayer({
  url,
  attribution,
  maxZoom,
  subdomains,
  className,
}: {
  url: string;
  attribution: string;
  maxZoom: number;
  subdomains: string;
  className?: string;
}) {
  const map = useMap();
  useEffect(() => {
    const layer = L.tileLayer(url, { attribution, maxZoom, subdomains, className }).addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, url, attribution, maxZoom, subdomains, className]);
  return null;
}

interface LayerProps {
  eventHandlers?: L.LeafletEventHandlerFnMap;
  /** Shown as plain text. */
  tooltip?: string;
  /** Only read when the tooltip is bound. */
  tooltipOptions?: L.TooltipOptions;
}

interface PathProps extends LayerProps {
  pathOptions?: L.PathOptions;
  interactive?: boolean;
  bubblingMouseEvents?: boolean;
}

export function Polyline({
  positions,
  pathOptions,
  interactive = true,
  bubblingMouseEvents = true,
  ...rest
}: PathProps & { positions: L.LatLngExpression[] }) {
  const [line] = useState(() => L.polyline(positions, { ...pathOptions, interactive, bubblingMouseEvents }));
  usePath(line, pathOptions, rest);
  useOnChange(positions, (p) => line.setLatLngs(p));
  return null;
}

export function CircleMarker({
  center,
  radius,
  pathOptions,
  interactive = true,
  bubblingMouseEvents = true,
  ...rest
}: PathProps & { center: L.LatLngExpression; radius: number }) {
  const [circle] = useState(() => L.circleMarker(center, { ...pathOptions, radius, interactive, bubblingMouseEvents }));
  usePath(circle, pathOptions, rest);
  useOnChange(center, (c) => circle.setLatLng(c), sameLatLng);
  useOnChange(radius, (r) => circle.setRadius(r));
  return null;
}

interface MarkerProps extends LayerProps {
  position: L.LatLngExpression;
  icon: L.Icon | L.DivIcon;
  title?: string;
  draggable?: boolean;
  keyboard?: boolean;
  zIndexOffset?: number;
  ref?: Ref<L.Marker>;
}

export function Marker({
  position,
  icon,
  title = '',
  draggable = false,
  keyboard = true,
  zIndexOffset = 0,
  ref,
  eventHandlers,
  tooltip,
  tooltipOptions,
}: MarkerProps) {
  const [marker] = useState(() => L.marker(position, { icon, title, draggable, keyboard, zIndexOffset }));
  useImperativeHandle(ref, () => marker, [marker]);
  useEvents(marker, eventHandlers);
  useTooltip(marker, tooltip, tooltipOptions);
  useLayer(marker);
  useOnChange(position, (p) => marker.setLatLng(p), sameLatLng);
  useOnChange(icon, (i) => marker.setIcon(i));
  useOnChange(zIndexOffset, (z) => marker.setZIndexOffset(z));
  useOnChange(draggable, (d) => {
    marker.options.draggable = d;
    if (d) marker.dragging?.enable();
    else marker.dragging?.disable();
  });
  // Leaflet only applies the title when it creates the icon element; keep it (and the accessible name) current.
  useOnChange(title, (t) => {
    marker.options.title = t;
    const el = marker.getElement();
    if (el) el.title = t;
  });
  return null;
}

function usePath(layer: L.Path, pathOptions: L.PathOptions | undefined, { eventHandlers, tooltip, tooltipOptions }: LayerProps) {
  useEvents(layer, eventHandlers);
  useTooltip(layer, tooltip, tooltipOptions);
  useLayer(layer);
  // A `className` here only takes effect when the path is created, like Leaflet's own.
  useOnChange(pathOptions, (o) => layer.setStyle(o ?? {}));
}

/** On the map while mounted. */
function useLayer(layer: L.Layer) {
  const map = useMap();
  useEffect(() => {
    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, layer]);
}

/** Each event type is bound once and calls the latest handler, so handlers can be new functions every render. */
function useEvents(target: L.Evented, handlers: L.LeafletEventHandlerFnMap | undefined) {
  const latest = useRef(handlers);
  latest.current = handlers;
  const types = handlers ? Object.keys(handlers).join(' ') : '';
  useEffect(() => {
    if (!types) return;
    const dispatch = (e: L.LeafletEvent) => (latest.current as Record<string, L.LeafletEventHandlerFn | undefined> | undefined)?.[e.type]?.(e);
    target.on(types, dispatch);
    return () => {
      target.off(types, dispatch);
    };
  }, [target, types]);
}

function useTooltip(layer: L.Layer, text: string | undefined, options: L.TooltipOptions | undefined) {
  const [initialOptions] = useState(options);
  const bound = text !== undefined;
  useEffect(() => {
    if (!bound) return;
    layer.bindTooltip('', initialOptions);
    return () => {
      layer.unbindTooltip();
    };
  }, [layer, bound, initialOptions]);
  useEffect(() => {
    // Leaflet reads string content as HTML; route and POI names come from users and files.
    if (text !== undefined) layer.setTooltipContent(Object.assign(document.createElement('span'), { textContent: text }));
  }, [layer, text, bound]);
}

/** Calls `apply` when `value` differs from what the layer has: first the value it was created with, then the last
 *  one applied. */
function useOnChange<T>(value: T, apply: (value: T) => void, same: (a: T, b: T) => boolean = Object.is) {
  const applied = useRef(value);
  useEffect(() => {
    if (same(applied.current, value)) return;
    applied.current = value;
    apply(value);
  });
}

const sameLatLng = (a: L.LatLngExpression, b: L.LatLngExpression) => L.latLng(a).equals(L.latLng(b));
