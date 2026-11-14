import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMap } from '../../components/LeafletMap';
import { MapPanel } from './MapPanel';
import { useEditorStore } from './store';
import styles from './Editor.module.css';

interface Place {
  lat: number;
  lon: number;
  label: string;
}

const resultCache = new Map<string, Place[]>();
let lastSearchStarted = 0;

async function searchPlaces(query: string, signal: AbortSignal): Promise<Place[]> {
  const key = query.trim().toLocaleLowerCase();
  const cached = resultCache.get(key);
  if (cached) return cached;

  const wait = Math.max(0, 1100 - (Date.now() - lastSearchStarted));
  if (wait) await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, wait);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException('Search cancelled', 'AbortError'));
      },
      { once: true },
    );
  });
  if (signal.aborted) throw new DOMException('Search cancelled', 'AbortError');

  lastSearchStarted = Date.now();
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q: query.trim(), format: 'jsonv2', limit: '5' }).toString();
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Search failed (${response.status}). Try again.`);

  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error('Search returned an invalid response. Try again.');
  const places = data.flatMap((item): Place[] => {
    if (typeof item !== 'object' || item === null) return [];
    const result = item as { lat?: unknown; lon?: unknown; display_name?: unknown };
    const lat = typeof result.lat === 'string' ? Number(result.lat) : NaN;
    const lon = typeof result.lon === 'string' ? Number(result.lon) : NaN;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180 ||
      typeof result.display_name !== 'string'
    )
      return [];
    return [{ lat, lon, label: result.display_name }];
  });
  resultCache.set(key, places);
  return places;
}

export function LocationSearch() {
  const map = useMap();
  const controllerRef = useRef<AbortController | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = query.trim();
    if (!text || loading) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const places = await searchPlaces(text, controller.signal);
      setResults(places);
      if (places.length === 0) setError('No locations found. Try a different search.');
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setError(reason instanceof Error ? reason.message : 'Location search failed. Try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const selectPlace = (place: Place) => {
    if (useEditorStore.getState().points.length === 0) {
      useEditorStore.getState().addPoint({ lat: place.lat, lon: place.lon });
    }
    map.setView([place.lat, place.lon], Math.max(map.getZoom(), 14), { animate: false });
    setResults([]);
    setQuery(place.label);
  };

  return (
    <MapPanel icon="search" name="location search">
      <div className={styles.locationSearch}>
        <label htmlFor="location-search">Search location</label>
        <form onSubmit={(event) => void submit(event)}>
          <div className={styles.locationSearchRow}>
            <input
              id="location-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Place or address"
              autoComplete="off"
            />
            <button type="submit" disabled={!query.trim() || loading}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
        </form>
        {error && <p className={styles.locationSearchMessage} role="status">{error}</p>}
        {results.length > 0 && (
          <ul className={styles.locationSearchResults} aria-label="Search results">
            {results.map((place) => (
              <li key={`${place.lat},${place.lon}`}>
                <button type="button" onClick={() => selectPlace(place)} title={place.label}>
                  {place.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        <a
          className={styles.locationSearchAttribution}
          href="https://nominatim.openstreetmap.org/"
          target="_blank"
          rel="noreferrer"
        >
          Search by OpenStreetMap Nominatim
        </a>
      </div>
    </MapPanel>
  );
}
