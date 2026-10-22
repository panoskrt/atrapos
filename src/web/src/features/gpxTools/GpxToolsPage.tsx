import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { useSearchParams } from 'react-router';
import { Icon, type IconName } from '../../components/Icon';
import { Spinner } from '../../components/Spinner';
import { baseLayers } from '../editor/baseLayers';
import { useUploadLimit } from '../import/api';
import { simplifyIndices } from '../import/simplify';
import type { Coord } from '../editor/geo';
import { ImportDialog } from '../import/ImportDialog';
import { formatBytes, postForFile, saveFile } from './fileApi';
import { mergeGpxFiles, readGpxPoints, type GpxPoint } from './mergeGpx';
import { ShrinkTool } from './ShrinkTool';
import { splitGpxPoints } from './splitGpx';
import styles from './GpxToolsPage.module.css';

type ToolId = 'merge' | 'split' | 'shrink' | 'convert';

const TOOLS: { id: ToolId; title: string; summary: string; icon: IconName; drop: string }[] = [
  { id: 'merge', title: 'Merge', summary: 'Join several GPX files into one route.', icon: 'routePlus', drop: 'Drop GPX files to add them' },
  { id: 'split', title: 'Split', summary: 'Cut a GPX route into parts on the map.', icon: 'scissors', drop: 'Drop a GPX file to split it' },
  { id: 'shrink', title: 'Shrink', summary: 'Fewer points, same route. GPX or FIT.', icon: 'shrink', drop: 'Drop a GPX or FIT file to shrink it' },
  { id: 'convert', title: 'Convert', summary: 'Turn GPX into FIT, or FIT into GPX.', icon: 'reverse', drop: 'Drop a GPX or FIT file to convert it' },
];

function isToolId(value: string | null): value is ToolId {
  return TOOLS.some((tool) => tool.id === value);
}

export function GpxToolsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const toolParam = searchParams.get('tool');
  const activeTool: ToolId = isToolId(toolParam) ? toolParam : 'merge';
  const tabRefs = useRef<Partial<Record<ToolId, HTMLButtonElement | null>>>({});
  const { maxFileBytes, maxFileLabel } = useUploadLimit();
  const inputRef = useRef<HTMLInputElement>(null);
  const splitInputRef = useRef<HTMLInputElement>(null);
  const convertInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [files, setFiles] = useState<File[]>([]);
  const [routeName, setRouteName] = useState('Merged route');
  const [splitRouteName, setSplitRouteName] = useState('Split route');
  const [mergedFile, setMergedFile] = useState<File | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourcePoints, setSourcePoints] = useState<GpxPoint[]>([]);
  const [cuts, setCuts] = useState<number[]>([]);
  const [createRoutes, setCreateRoutes] = useState(true);
  const [splitParts, setSplitParts] = useState<File[]>([]);
  const [routeQueue, setRouteQueue] = useState<File[]>([]);
  const [createdCount, setCreatedCount] = useState(0);
  const [splitComplete, setSplitComplete] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [mapHint, setMapHint] = useState('Click the route to add a split point.');
  const [dragging, setDragging] = useState(false);
  const [merging, setMerging] = useState(false);
  const [convertFile, setConvertFile] = useState<File | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [shrinkFile, setShrinkFile] = useState<File | null>(null);

  const selectTool = (id: ToolId, focus = false) => {
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      next.set('tool', id);
      return next;
    }, { replace: true });
    if (focus) tabRefs.current[id]?.focus();
  };

  const onTabKeyDown = (event: KeyboardEvent, index: number) => {
    const last = TOOLS.length - 1;
    const target = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index === 0 ? last : index - 1)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? last
            : null;
    if (target === null) return;
    event.preventDefault();
    selectTool(TOOLS[target]!.id, true);
  };

  /** Files dropped anywhere on the page go to the tool that is open. */
  const dropFiles = (list: FileList) => {
    const first = list[0];
    if (activeTool === 'merge') addFiles(list);
    else if (activeTool === 'split') void loadSplitFile(first);
    else if (activeTool === 'shrink') setShrinkFile(first ?? null);
    else if (first) {
      setConvertError(null);
      setConvertFile(first);
    }
  };

  const addFiles = (list: FileList | File[]) => {
    const selected = Array.from(list);
    const invalid = selected.find((file) => !file.name.toLowerCase().endsWith('.gpx') || file.size > maxFileBytes);
    if (invalid) {
      setMergeError(
        !invalid.name.toLowerCase().endsWith('.gpx')
          ? `${invalid.name} isn't a GPX file.`
          : `${invalid.name} is larger than ${maxFileLabel}.`,
      );
      return;
    }
    setMergeError(null);
    setFiles((current) => [...current, ...selected]);
  };

  const moveFile = (index: number, offset: number) => {
    setFiles((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const merge = async () => {
    setMerging(true);
    setMergeError(null);
    try {
      const inputs = await Promise.all(files.map(async (file) => ({ fileName: file.name, contents: await file.text() })));
      const result = mergeGpxFiles(inputs, routeName);
      const fileName = `${safeFileName(routeName)}.gpx`;
      const mergedFile = new File([result.xml], fileName, { type: 'application/gpx+xml' });
      if (mergedFile.size > maxFileBytes) {
        throw new Error(`The merged GPX is larger than ${maxFileLabel} and cannot be imported. Remove some files and try again.`);
      }
      setMergedFile(mergedFile);
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : 'The GPX files could not be merged.');
    } finally {
      setMerging(false);
    }
  };

  const loadSplitFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.gpx')) {
      setSplitError(`${file.name} isn't a GPX file.`);
      return;
    }
    if (file.size > maxFileBytes) {
      setSplitError(`${file.name} is larger than ${maxFileLabel}.`);
      return;
    }

    setSplitError(null);
    setMapHint('Click the route to add a split point.');
    setSourceFile(null);
    setSourcePoints([]);
    setSplitParts([]);
    setRouteQueue([]);
    setSplitComplete(false);
    try {
      const points = readGpxPoints({ fileName: file.name, contents: await file.text() });
      if (points.length < 2) throw new Error('The GPX needs at least two points to split.');
      setSourceFile(file);
      setSourcePoints(points);
      setCuts([]);
    } catch (e) {
      setSplitError(e instanceof Error ? e.message : 'The GPX file could not be read.');
    }
  };

  const addCut = (pointIndex: number): boolean => {
    if (cuts.includes(pointIndex)) return false;
    const ordered = [...cuts].sort((a, b) => a - b);
    const slot = ordered.findIndex((cut) => cut > pointIndex);
    const previous = slot <= 0 ? -1 : ordered[slot - 1]!;
    const next = slot < 0 ? sourcePoints.length - 1 : ordered[slot]!;
    if (pointIndex - previous < 2 || next - pointIndex < 2) return false;
    setCuts([...ordered, pointIndex].sort((a, b) => a - b));
    setSplitParts([]);
    setSplitComplete(false);
    setSplitError(null);
    setMapHint(`Added a split after point ${pointIndex + 1}.`);
    return true;
  };

  const removeCut = (pointIndex: number) => {
    setCuts((current) => current.filter((cut) => cut !== pointIndex));
    setSplitParts([]);
    setSplitComplete(false);
    setSplitError(null);
    setMapHint(`Removed split after point ${pointIndex + 1}.`);
  };

  const split = () => {
    if (!sourceFile) return;
    setSplitError(null);
    setSplitComplete(false);
    setCreatedCount(0);
    try {
      const splitParts = splitGpxPoints(sourcePoints, cuts, splitRouteName);
      const partFiles = splitParts.map((part) => new File([part.xml], part.fileName, { type: 'application/gpx+xml' }));
      if (createRoutes) {
        const tooLarge = partFiles.find((part) => part.size > maxFileBytes);
        if (tooLarge) throw new Error(`${tooLarge.name} is larger than ${maxFileLabel} and cannot be imported.`);
        setRouteQueue(partFiles);
      } else {
        setSplitParts(partFiles);
      }
    } catch (e) {
      setSplitError(e instanceof Error ? e.message : 'The GPX could not be split.');
    }
  };

  const routeImported = () => {
    const remaining = routeQueue.slice(1);
    setCreatedCount((count) => count + 1);
    setRouteQueue(remaining);
    if (remaining.length === 0) setSplitComplete(true);
  };

  const convert = async () => {
    if (!convertFile) return;
    setConverting(true);
    setConvertError(null);
    try {
      const form = new FormData();
      form.append('file', convertFile);
      const fallbackName = `${safeFileName(convertFile.name.replace(/\.(gpx|fit)$/i, ''))}.${convertFile.name.toLowerCase().endsWith('.fit') ? 'gpx' : 'fit'}`;
      saveFile(await postForFile('/api/imports/convert', form, fallbackName, 'Conversion'));
    } catch (error) {
      setConvertError(error instanceof Error ? error.message : 'The file could not be converted.');
    } finally {
      setConverting(false);
    }
  };

  const displayLine = useMemo(() => {
    const coordinates: Coord[] = sourcePoints.map((point) => [point.lon, point.lat, null]);
    return simplifyIndices(coordinates, 3).map((index) => {
      const point = sourcePoints[index]!;
      return [point.lat, point.lon] as [number, number];
    });
  }, [sourcePoints]);
  const layer = baseLayers.find((item) => item.id === 'topo')!;

  const onDragEnter = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  return (
    <div
      className={styles.page}
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        dropFiles(event.dataTransfer.files);
      }}
    >
      {dragging && (
        <div className={styles.dropOverlay} aria-hidden="true">
          <Icon name="fileUp" size={40} />
          {TOOLS.find((tool) => tool.id === activeTool)!.drop}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".gpx,application/gpx+xml,application/xml,text/xml"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files);
          event.target.value = '';
        }}
      />
      {mergedFile && (
        <ImportDialog
          file={mergedFile}
          onClose={() => setMergedFile(null)}
          onDownload={() => saveFile(mergedFile)}
        />
      )}
      {routeQueue[0] && (
        <ImportDialog
          key={`${routeQueue[0].name}-${routeQueue[0].size}`}
          file={routeQueue[0]}
          onClose={() => {
            setRouteQueue([]);
            if (createdCount > 0) setSplitComplete(true);
          }}
          onImported={routeImported}
        />
      )}

      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>WORK WITH YOUR ROUTE FILES</p>
          <h1 className={`display ${styles.title}`}>GPX tools</h1>
          <p className={styles.subtitle}>Small tools to prepare GPX and FIT files for your next adventure.</p>
        </div>
      </header>

      <div className={styles.toolPicker} role="tablist" aria-label="GPX tools">
        {TOOLS.map((tool, index) => (
          <button
            key={tool.id}
            ref={(el) => {
              tabRefs.current[tool.id] = el;
            }}
            type="button"
            role="tab"
            id={`tool-tab-${tool.id}`}
            aria-selected={tool.id === activeTool}
            aria-controls={`tool-panel-${tool.id}`}
            tabIndex={tool.id === activeTool ? 0 : -1}
            className={tool.id === activeTool ? `${styles.toolTile} ${styles.toolTileActive}` : styles.toolTile}
            onClick={() => selectTool(tool.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            <span className={styles.toolIcon}><Icon name={tool.icon} size={22} /></span>
            <span className={styles.toolTileText}>
              <strong>{tool.title}</strong>
              <span>{tool.summary}</span>
            </span>
          </button>
        ))}
      </div>

      {activeTool === 'merge' && (
        <section className={styles.tool} role="tabpanel" id="tool-panel-merge" aria-labelledby="merge-title">
          <div className={styles.toolHeader}>
            <span className={styles.toolIcon}><Icon name="routePlus" size={22} /></span>
            <div>
              <h2 id="merge-title">Merge GPX files</h2>
              <p>Add files, then set the order they will be joined in the merged route.</p>
            </div>
          </div>

          <div className={styles.controls}>
            <label className={styles.nameField}>
              <span>Route name</span>
              <input value={routeName} maxLength={120} onChange={(event) => setRouteName(event.target.value)} />
            </label>
            <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
              <Icon name="fileUp" size={18} />
              Choose GPX files
            </button>
          </div>

          {files.length ? (
            <>
              <p className={styles.orderPrompt}>Set merge order: use the up and down buttons. Files are joined from top to bottom.</p>
              <ol className={styles.fileList} aria-label="GPX files in merge order">
                {files.map((file, index) => (
                  <li className={styles.file} key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
                    <span className={styles.orderPosition} aria-label={`Merge position ${index + 1}`}>
                      {index + 1}
                    </span>
                    <span className={styles.fileIcon}><Icon name="fit" size={18} /></span>
                    <span className={styles.fileInfo}>
                      <strong>{file.name}</strong>
                      <span>{formatBytes(file.size)}</span>
                    </span>
                    <div className={styles.fileActions}>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={`Move ${file.name} up`}
                        disabled={index === 0}
                        onClick={() => moveFile(index, -1)}
                      >
                        <Icon name="arrowUp" size={17} />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={`Move ${file.name} down`}
                        disabled={index === files.length - 1}
                        onClick={() => moveFile(index, 1)}
                      >
                        <Icon name="arrowDown" size={17} />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={`Remove ${file.name}`}
                        onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                      >
                        <Icon name="close" size={17} />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <button type="button" className={styles.dropTarget} onClick={() => inputRef.current?.click()}>
              <Icon name="fileUp" size={30} />
              <strong>Drop GPX files here or browse</strong>
              <span>Choose at least two GPX files. Each file can be up to {maxFileLabel}.</span>
            </button>
          )}

          <div className={styles.footer}>
            <p className={styles.note}>
              Files are processed in your browser. Track points are joined in order; GPX routes are used when a file has no track points.
              Missing timestamps are generated at one-second intervals for activity uploads; generated times won't reflect the actual recording pace.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              disabled={files.length < 2 || merging}
              aria-busy={merging}
              onClick={() => void merge()}
            >
              {merging ? <Spinner /> : <Icon name="routePlus" size={18} />}
              {merging ? 'Preparing route…' : 'Merge and create route'}
            </button>
          </div>
          {mergeError && (
            <p role="alert" className={styles.error}>
              <Icon name="alert" size={18} />
              {mergeError}
            </p>
          )}
        </section>
      )}

      {activeTool === 'split' && (
        <section className={styles.tool} role="tabpanel" id="tool-panel-split" aria-labelledby="split-title">
          <div className={styles.toolHeader}>
            <span className={styles.toolIcon}><Icon name="scissors" size={22} /></span>
            <div>
              <h2 id="split-title">Split a GPX route</h2>
              <p>Choose cut points along a GPX track or route to divide it into as many parts as you need.</p>
            </div>
          </div>

          <input
            ref={splitInputRef}
            type="file"
            accept=".gpx,application/gpx+xml,application/xml,text/xml"
            hidden
            onChange={(event) => {
              void loadSplitFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <div className={styles.controls}>
            <p className={styles.note}>
              {sourceFile ? `${sourceFile.name} · ${sourcePoints.length.toLocaleString()} points` : 'Select a GPX file containing a track or route.'}
            </p>
            <button type="button" className="btn" onClick={() => splitInputRef.current?.click()}>
              <Icon name="fileUp" size={18} />
              {sourceFile ? 'Choose another GPX' : 'Choose GPX file'}
            </button>
          </div>

          {sourceFile && (
            <>
              <div className={styles.splitSettings}>
                <label className={styles.nameField}>
                  <span>Route name prefix</span>
                  <input value={splitRouteName} maxLength={120} onChange={(event) => setSplitRouteName(event.target.value)} />
                </label>
              </div>

              <div className={styles.mapHelp}>
                <strong>Choose split points on the route</strong>
                <span>Click the route line to add a split. Click a numbered marker to remove it. Each part needs at least two points.</span>
              </div>
              <div className={styles.splitMap} role="region" aria-label="GPX route split map">
                <MapContainer
                  className="rpm-split-map"
                  center={[sourcePoints[0]!.lat, sourcePoints[0]!.lon]}
                  zoom={5}
                  zoomControl
                  scrollWheelZoom
                >
                  <TileLayer
                    url={layer.url}
                    attribution={layer.attribution}
                    maxZoom={layer.maxZoom}
                    subdomains={layer.subdomains ?? 'abc'}
                    className="rpm-tiles"
                  />
                  <SplitMapBehavior
                    points={sourcePoints}
                    onAddCut={addCut}
                    onNotice={setMapHint}
                  />
                  <Polyline positions={displayLine} pathOptions={{ color: 'var(--accent)', weight: 5, opacity: 0.9 }} />
                  <CircleMarker
                    center={[sourcePoints[0]!.lat, sourcePoints[0]!.lon]}
                    radius={7}
                    pathOptions={{ color: '#fff', weight: 2, fillColor: '#31a66a', fillOpacity: 1 }}
                    interactive={false}
                  />
                  <CircleMarker
                    center={[sourcePoints[sourcePoints.length - 1]!.lat, sourcePoints[sourcePoints.length - 1]!.lon]}
                    radius={7}
                    pathOptions={{ color: '#fff', weight: 2, fillColor: '#2878cf', fillOpacity: 1 }}
                    interactive={false}
                  />
                  {cuts.map((cut, index) => {
                    const point = sourcePoints[cut]!;
                    return (
                      <CircleMarker
                        key={cut}
                        center={[point.lat, point.lon]}
                        radius={11}
                        pathOptions={{ color: '#fff', weight: 2, fillColor: 'var(--poi)', fillOpacity: 1 }}
                        bubblingMouseEvents={false}
                        eventHandlers={{ click: () => removeCut(cut) }}
                      >
                        <Tooltip direction="center" permanent>
                          {index + 1}
                        </Tooltip>
                      </CircleMarker>
                    );
                  })}
                </MapContainer>
              </div>
              <p className={styles.mapHint} role="status">{mapHint}</p>
              <p className={styles.note}>
                {cuts.length} split point{cuts.length === 1 ? '' : 's'} selected · {cuts.length + 1}{' '}
                {cuts.length === 0 ? 'part' : 'parts'}
              </p>
              <div className={styles.cutList}>
                {cuts.map((cut, index) => {
                  const point = sourcePoints[cut]!;
                  return (
                    <div className={styles.cut} key={cut}>
                      <span>
                        <strong>Split point {index + 1}</strong>
                        <span>After point {cut + 1} · {point.lat.toFixed(5)}, {point.lon.toFixed(5)}</span>
                      </span>
                      <button type="button" className="btn" onClick={() => removeCut(cut)}>Remove</button>
                    </div>
                  );
                })}
              </div>

              <label className={styles.createRoutes}>
                <input
                  type="checkbox"
                  checked={createRoutes}
                  onChange={(event) => {
                    setCreateRoutes(event.target.checked);
                    setSplitParts([]);
                    setRouteQueue([]);
                    setSplitComplete(false);
                  }}
                />
                Create a route in the app for each split part
              </label>
              <div className={styles.footer}>
                <p className={styles.note}>Each selected cut divides between adjacent points. Point data such as elevation and time is retained.</p>
                <button type="button" className="btn btn-primary" onClick={split}>
                  <Icon name={createRoutes ? 'routePlus' : 'scissors'} size={18} />
                  {createRoutes ? 'Split and create routes' : 'Split GPX'}
                </button>
              </div>
            </>
          )}

          {splitParts.length > 0 && (
            <ol className={styles.fileList} aria-label="Split GPX parts">
              {splitParts.map((part) => (
                <li className={styles.file} key={part.name}>
                  <span className={styles.fileIcon}><Icon name="fileUp" size={18} /></span>
                  <span className={styles.fileInfo}>
                    <strong>{part.name}</strong>
                    <span>{formatBytes(part.size)}</span>
                  </span>
                  <button type="button" className="btn" onClick={() => saveFile(part)}>
                    <Icon name="download" size={18} />
                    Download
                  </button>
                </li>
              ))}
            </ol>
          )}
          {splitComplete && (
            <p role="status" className={styles.success}>
              <Icon name="check" size={18} />
              Created {createdCount} {createdCount === 1 ? 'route' : 'routes'} in your library.
            </p>
          )}
          {splitError && (
            <p role="alert" className={styles.error}>
              <Icon name="alert" size={18} />
              {splitError}
            </p>
          )}
        </section>
      )}

      {activeTool === 'shrink' && (
        <section className={styles.tool} role="tabpanel" id="tool-panel-shrink" aria-labelledby="shrink-title">
          <div className={styles.toolHeader}>
            <span className={styles.toolIcon}><Icon name="shrink" size={22} /></span>
            <div>
              <h2 id="shrink-title">Shrink a GPX or FIT file</h2>
              <p>Remove points that don't change the route, for a smaller file that loads faster on your watch.</p>
            </div>
          </div>
          <ShrinkTool
            key={shrinkFile ? `${shrinkFile.name}-${shrinkFile.size}-${shrinkFile.lastModified}` : 'none'}
            file={shrinkFile}
            onFile={setShrinkFile}
          />
        </section>
      )}

      {activeTool === 'convert' && (
        <section className={styles.tool} role="tabpanel" id="tool-panel-convert" aria-labelledby="convert-title">
          <div className={styles.toolHeader}>
            <span className={styles.toolIcon}><Icon name="reverse" size={22} /></span>
            <div>
              <h2 id="convert-title">Convert FIT and GPX</h2>
              <p>Convert a route file between GPX and FIT formats and download the result.</p>
            </div>
          </div>
          <input
            ref={convertInputRef}
            type="file"
            accept=".gpx,.fit,application/gpx+xml,application/vnd.ant.fit"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setConvertError(null);
              setConvertFile(file);
              event.target.value = '';
            }}
          />
          <div className={styles.controls}>
            <p className={styles.note}>
              {convertFile ? `${convertFile.name} · ${formatBytes(convertFile.size)}` : `Choose one GPX or FIT file (up to ${maxFileLabel}).`}
            </p>
            <button type="button" className="btn" onClick={() => convertInputRef.current?.click()}>
              <Icon name="fileUp" size={18} />
              {convertFile ? 'Choose another file' : 'Choose GPX or FIT'}
            </button>
          </div>
          <div className={styles.footer}>
            <p className={styles.note}>The first track is converted point for point, keeping elevation, recorded times, and waypoints where supported.</p>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!convertFile || convertFile.size > maxFileBytes || converting}
              aria-busy={converting}
              onClick={() => void convert()}
            >
              {converting ? <Spinner /> : <Icon name="download" size={18} />}
              {converting ? 'Converting…' : 'Convert and download'}
            </button>
          </div>
          {convertFile && convertFile.size > maxFileBytes && (
            <p role="alert" className={styles.error}>This file is larger than {maxFileLabel}.</p>
          )}
          {convertError && (
            <p role="alert" className={styles.error}>
              <Icon name="alert" size={18} />
              {convertError}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function SplitMapBehavior({
  points,
  onAddCut,
  onNotice,
}: {
  points: GpxPoint[];
  onAddCut: (pointIndex: number) => boolean;
  onNotice: (message: string) => void;
}) {
  const map = useMap();

  useMapEvents({
    click(event) {
      const clickPoint = map.latLngToContainerPoint(event.latlng);
      let nearest = -1;
      let nearestDistance = Infinity;
      for (let index = 0; index < points.length; index++) {
        const point = points[index]!;
        const screenPoint = map.latLngToContainerPoint([point.lat, point.lon]);
        const distance = clickPoint.distanceTo(screenPoint);
        if (distance < nearestDistance) {
          nearest = index;
          nearestDistance = distance;
        }
      }
      if (nearest >= 0 && nearestDistance <= 28) {
        if (!onAddCut(nearest)) onNotice('Choose another point, leaving at least two route points in each part.');
      } else {
        onNotice('Click closer to the highlighted route line to place a split.');
      }
    },
  });

  useEffect(() => {
    if (points.length > 1)
      map.fitBounds(L.latLngBounds(points.map((point) => [point.lat, point.lon] as [number, number])), { padding: [36, 36] });
    else if (points.length === 1) map.setView([points[0]!.lat, points[0]!.lon], 13);
  }, [map, points]);

  return null;
}

function safeFileName(name: string): string {
  const safe = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '');
  return safe || 'merged-route';
}
