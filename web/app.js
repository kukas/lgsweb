// Stage 1 spectrometer web app.
//
// Two modes:
//   - Standalone: served from anywhere (e.g. GitHub Pages). getUserMedia for
//     video, no UVC controls. Detected when the local server is unreachable.
//   - Server-enhanced: local Node server at SERVER_URL is reachable, exposing
//     /api/controls. Controls panel becomes live.
//
// Either mode produces the same live spectrum from a row of pixels.

const SERVER_URL = 'http://localhost:47808';

// ── Server detection & API ────────────────────────────────────────────────

const api = {
  async health() {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    try {
      const r = await fetch(`${SERVER_URL}/api/health`, { signal: ctl.signal });
      return r.ok ? await r.json() : null;
    } catch { return null; }
    finally { clearTimeout(t); }
  },
  async controls() {
    const r = await fetch(`${SERVER_URL}/api/controls`);
    return r.ok ? await r.json() : null;
  },
  async setControl(name, value) {
    const r = await fetch(`${SERVER_URL}/api/controls/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    return r.ok ? await r.json() : null;
  },
  async setMode(mode) {
    const r = await fetch(`${SERVER_URL}/api/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    return r.ok ? await r.json() : null;
  },
  async reset() {
    const r = await fetch(`${SERVER_URL}/api/reset`, { method: 'POST' });
    return r.ok ? await r.json() : null;
  },
};

// ── DOM refs ──────────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
// Mercury / terbium / europium peaks of a typical fluorescent tube.
// Source: lgscli/README. The first four (in intensity order: 546.1, 611.6,
// 542.4, 435.8) are what auto-cal pairs to detected peaks.
// Anchors are the three brightest peaks in a typical CFL/tube spectrum:
//   - 435.8 nm Hg (strong blue)
//   - 546.1 nm Hg (the brightest line in most lamps)
//   - 611.6 nm Eu (strong orange)
// The user only drags those three; the others appear as visual references that
// follow the fit through the anchors. With three anchors the fit is
// over-determined, so r is meaningful as a sanity check.
// `intensity` is the relative emission strength (0..1) used to render the
// expected lamp spectrum. Hg 546.1 nm is normalised to 1.0 — the brightest
// line in a typical CFL. Other intensities are eyeballed from common
// trichromatic-phosphor lamp spectra. `fwhm` is the visible feature width in
// nm at this kit's resolution (instrument-broadened, not intrinsic).
const FLUO_PEAKS = [
  { wavelength: 404.6, label: '404.6', element: 'Hg', intensity: 0.40, fwhm: 1.0 },
  { wavelength: 435.8, label: '435.8', element: 'Hg', intensity: 0.85, fwhm: 1.0, anchor: true },
  { wavelength: 487.7, label: '487.7', element: 'Tb', intensity: 0.30, fwhm: 1.0 },
  { wavelength: 542.4, label: '542.4', element: 'Tb', intensity: 0.40, fwhm: 1.0 },
  { wavelength: 546.1, label: '546.1', element: 'Hg', intensity: 1.00, fwhm: 1.0, anchor: true },
  { wavelength: 611.6, label: '611.6', element: 'Eu', intensity: 0.70, fwhm: 1.2, anchor: true },
  { wavelength: 631.1, label: '631.1', element: 'Eu', intensity: 0.40, fwhm: 1.2 },
  { wavelength: 707.0, label: '707.0', element: 'Eu', intensity: 0.15, fwhm: 1.5 },
  // Mercury near-IR line — typically faint to the eye but a Si webcam with
  // its IR-cut filter removed picks it up clearly. Shows up as a distinct
  // peak around 870 nm in CFL spectra captured with this kit.
  { wavelength: 871.6, label: '871.6', element: 'Hg', intensity: 0.20, fwhm: 1.5 },
];
// Fraunhofer lines for overlay / manual calibration. `depth` is the approximate
// webcam-visible prominence (0..1), not the intrinsic solar depth. `fwhm` is
// the visible width in nm at this kit's resolution, so close doublets still
// render as separate labels while broad O2 bands stay visibly wider.
const FRAUNHOFER_LINES = [
  { wavelength: 299.444, label: 't',         element: 'Ni',    depth: 0.08, fwhm: 1.1 },
  { wavelength: 302.108, label: 'T',         element: 'Fe',    depth: 0.09, fwhm: 1.1 },
  { wavelength: 336.112, label: 'P',         element: 'Ti+',   depth: 0.10, fwhm: 1.1 },
  { wavelength: 358.121, label: 'N',         element: 'Fe',    depth: 0.10, fwhm: 1.1 },
  { wavelength: 382.044, label: 'L',         element: 'Fe',    depth: 0.12, fwhm: 1.0 },
  { wavelength: 393.366, label: 'K',         element: 'Ca+',   depth: 0.20, fwhm: 1.0 },
  { wavelength: 396.847, label: 'H',         element: 'Ca+',   depth: 0.20, fwhm: 1.0 },
  { wavelength: 410.175, label: 'h',         element: 'Hδ',    depth: 0.18, fwhm: 1.0 },
  { wavelength: 430.774, label: 'G',         element: 'Ca',    depth: 0.42, fwhm: 1.8 },
  { wavelength: 430.790, label: 'G',         element: 'Fe',    depth: 0.42, fwhm: 1.8 },
  { wavelength: 434.047, label: "G'",        element: 'Hγ',    depth: 0.24, fwhm: 1.0 },
  { wavelength: 438.355, label: 'e',         element: 'Fe',    depth: 0.16, fwhm: 1.0 },
  { wavelength: 466.814, label: 'd',         element: 'Fe',    depth: 0.14, fwhm: 1.0 },
  { wavelength: 486.134, label: 'F',         element: 'Hβ',    depth: 0.35, fwhm: 1.0 },
  { wavelength: 495.761, label: 'c',         element: 'Fe',    depth: 0.12, fwhm: 1.0 },
  { wavelength: 516.733, label: 'b4',        element: 'Mg',    depth: 0.14, fwhm: 0.9 },
  { wavelength: 516.891, label: 'b3',        element: 'Fe',    depth: 0.14, fwhm: 0.9 },
  { wavelength: 517.270, label: 'b2',        element: 'Mg',    depth: 0.16, fwhm: 0.9 },
  { wavelength: 518.362, label: 'b1',        element: 'Mg',    depth: 0.18, fwhm: 0.9 },
  { wavelength: 527.039, label: 'E2',        element: 'Fe',    depth: 0.10, fwhm: 0.8 },
  { wavelength: 546.073, label: 'e',         element: 'Hg',    depth: 0.10, fwhm: 0.8 },
  // Anchor pair for visual cal: D1 and C are the two most reliably visible
  // dips on a webcam, well-separated in wavelength, so a 2-point fit is
  // stable. The nearby D2 / D3 lines remain as visual references.
  { wavelength: 587.5618, label: 'D3 / d',   element: 'He',    depth: 0.16, fwhm: 1.0 },
  { wavelength: 588.995, label: 'D2',        element: 'Na',    depth: 0.48, fwhm: 1.0 },
  { wavelength: 589.592, label: 'D1',        element: 'Na',    depth: 0.55, fwhm: 1.0, anchor: true },
  { wavelength: 627.661, label: 'a',         element: 'O₂',    depth: 0.14, fwhm: 2.0 },
  { wavelength: 656.281, label: 'C',         element: 'Hα',    depth: 0.55, fwhm: 1.2, anchor: true },
  { wavelength: 686.719, label: 'B',         element: 'O₂',    depth: 0.40, fwhm: 3.0 },
  { wavelength: 759.370, label: 'A',         element: 'O₂',    depth: 0.65, fwhm: 6.0 },
  { wavelength: 822.696, label: 'Z',         element: 'O₂',    depth: 0.22, fwhm: 4.0 },
  { wavelength: 898.765, label: 'y',         element: 'O₂',    depth: 0.18, fwhm: 4.5 },
];

let calibration = null;
// Per-pixel multiplicative response correction (etaloning + grating
// efficiency). Computed from a measured blackbody-lamp spectrum vs Planck's
// law at the lamp's temperature; stored in pixel space, so it survives later
// wavelength recalibration. See applyAmplitudeCalibration() for the math.
// Library of saved amplitude calibrations and which one is currently active.
// Each entry: { id, name, timestamp, temperature, sensorWidth, dark, linearized,
// factors (Float64Array; serialized as plain array) }.
let amplitudeCalibrations = [];
let activeAmplitudeCalibrationId = null;
// Pointer into the library, kept in sync by setActiveAmplitudeCalibration().
// Most existing draw / sample code reads through this, so renaming would be
// noisy — instead we just keep it pointing at the active entry (or null).
let amplitudeCalibration = null;

(function loadAmplitudeCalibrations() {
  // Migrate any legacy single-cal storage from before the multi-cal change.
  const legacy = localStorage.getItem('amplitudeCalibration');
  if (legacy) {
    try {
      const j = JSON.parse(legacy);
      if (j && Array.isArray(j.factors)) {
        const tStr = Number.isFinite(j.timestamp) ? new Date(j.timestamp).toLocaleString() : '';
        const cal = {
          id: `cal-${j.timestamp || Date.now()}`,
          name: `${j.temperature || '?'} K · ${tStr || 'imported'}`,
          ...j,
        };
        amplitudeCalibrations.push(cal);
        activeAmplitudeCalibrationId = cal.id;
      }
    } catch {}
    localStorage.removeItem('amplitudeCalibration');
  }
  // Load the new-format list (overrides legacy if both somehow exist).
  try {
    const list = JSON.parse(localStorage.getItem('amplitudeCalibrations') || 'null');
    if (Array.isArray(list) && list.length) amplitudeCalibrations = list;
  } catch {}
  amplitudeCalibrations.forEach(c => {
    if (Array.isArray(c.factors)) c.factors = Float64Array.from(c.factors);
  });
  const storedActive = localStorage.getItem('activeAmplitudeCalibrationId');
  if (storedActive && amplitudeCalibrations.some(c => c.id === storedActive)) {
    activeAmplitudeCalibrationId = storedActive;
  }
  amplitudeCalibration = amplitudeCalibrations.find(c => c.id === activeAmplitudeCalibrationId) || null;
})();

function persistAmplitudeCalibrations() {
  // Float64Array round-trips via Array for JSON.
  const serializable = amplitudeCalibrations.map(c => ({
    ...c,
    factors: Array.from(c.factors),
  }));
  localStorage.setItem('amplitudeCalibrations', JSON.stringify(serializable));
  if (activeAmplitudeCalibrationId) localStorage.setItem('activeAmplitudeCalibrationId', activeAmplitudeCalibrationId);
  else localStorage.removeItem('activeAmplitudeCalibrationId');
}

function setActiveAmplitudeCalibration(id) {
  activeAmplitudeCalibrationId = id || null;
  amplitudeCalibration = amplitudeCalibrations.find(c => c.id === id) || null;
  if (activeAmplitudeCalibrationId) localStorage.setItem('activeAmplitudeCalibrationId', activeAmplitudeCalibrationId);
  else localStorage.removeItem('activeAmplitudeCalibrationId');
  updateCalibrationUI();
}

// User-facing bypass toggle. Decoupled from "is a calibration stored / active"
// so the user can A/B-compare without changing the active selection.
let amplitudeEnabled = (() => {
  const v = localStorage.getItem('amplitudeEnabled');
  return v === null ? true : v === '1';
})();
try { calibration = JSON.parse(localStorage.getItem('calibration') || 'null'); } catch {}
let showFluoOverlay = localStorage.getItem('showFluoOverlay') === '1';
let showFraunhofer  = localStorage.getItem('showFraunhofer')  === '1';
let showBlackbody   = localStorage.getItem('showBlackbody')   === '1';
let blackbodyFitMeasured = localStorage.getItem('blackbodyFitMeasured') === '1';
let linearizeSensor = localStorage.getItem('linearizeSensor') === '1';
// Light/dark theme. First visit honours the system preference; after that the
// user's manual choice persists across reloads.
let theme = (() => {
  const v = localStorage.getItem('theme');
  if (v === 'light' || v === 'dark') return v;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
})();
document.documentElement.setAttribute('data-theme', theme);
let blackbodyTemp   = (() => {
  const v = parseFloat(localStorage.getItem('blackbodyTemp'));
  return Number.isFinite(v) && v >= 1000 && v <= 10000 ? v : 2600;
})();
let showRgb         = localStorage.getItem('showRgb')         === '1';
let flipHorizontal = (() => {
  const v = localStorage.getItem('flipHorizontal');
  return v === null ? true : v === '1';
})();
let hideCameraView = localStorage.getItem('hideCameraView') === '1';
let hideCurrentSpectrum = localStorage.getItem('hideCurrentSpectrum') === '1';
let peakNormalize = localStorage.getItem('peakNormalize') === '1';
const PEAK_NORM_TARGET = 240; // y-axis is 0-255; 240 leaves a touch of headroom
// Column crop, stored as percentages of the full sensor width so the values
// stay meaningful across resolution changes. Pixels outside [min%, max%] are
// blanked to NaN before plotting, which renders them as gaps in uPlot.
let colCropMinPct = (() => {
  const v = parseFloat(localStorage.getItem('colCropMinPct'));
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 0;
})();
let colCropMaxPct = (() => {
  const v = parseFloat(localStorage.getItem('colCropMaxPct'));
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 100;
})();
// Persisted snapshots of past measurements. Each entry:
//   { id, name, timestamp, spectrum (array of intensities), calibration|null,
//     sensorWidth, visible (bool) }
// Visible entries render as colored overlay lines on the plot.
let savedMeasurements = (() => {
  try { return JSON.parse(localStorage.getItem('savedMeasurements') || '[]'); }
  catch { return []; }
})();
const SAVED_COLORS = ['#ff7eb6', '#82aaff', '#c3e88d', '#f78c6c', '#c792ea', '#89ddff', '#ffcb6b', '#a3be8c'];
function colorForSaved(idx) { return SAVED_COLORS[idx % SAVED_COLORS.length]; }
// Resolve the displayed color: user-picked override on the entry, falling back
// to the auto-assigned palette slot.
function colorOfSaved(entry, idx) { return entry.color || colorForSaved(idx); }

const els = {
  video:        $('#video'),
  rowMarker:    $('#row-marker'),
  rowSlider:    $('#row-slider'),
  rowValue:     $('#row-value'),
  bandSlider:   $('#band-slider'),
  bandValue:    $('#band-value'),
  autoRow:      $('#auto-row'),
  videoFrame:   $('#video-frame'),
  videoWrap:    document.querySelector('.video-wrap'),
  main:         document.querySelector('main'),
  deviceSelect: $('#device-select'),
  captureStart: $('#capture-start'),
  captureStop:  $('#capture-stop'),
  statusServer: $('#status-server'),
  statusCamera: $('#status-camera'),
  themeToggle:  $('#theme-toggle'),
  banner:       $('#banner'),
  controlsList: $('#controls-list'),
  controlsHint: $('#controls-hint'),
  cameraControlsSection: $('#camera-controls-section'),
  overlayToggles: $('#overlay-toggles'),
  modeManual:   $('#mode-manual'),
  modeAuto:     $('#mode-auto'),
  resetDefaults:$('#reset-defaults'),
  spectrometerPreset: $('#spectrometer-preset'),
  viewSimple:   $('#view-simple'),
  viewAdvanced: $('#view-advanced'),
  simpleView:   $('#simple-view'),
  advancedView: $('#advanced-view'),
  simpleExposureSlot: $('#simple-exposure-slot'),
  controlsPane: document.querySelector('.controls-pane'),
  calibrationStatus:$('#calibration-status'),
  resetCalibration: $('#reset-calibration'),
  showFluoOverlay:  $('#show-fluo-overlay'),
  showFraunhofer:   $('#show-fraunhofer'),
  showBlackbody:    $('#show-blackbody'),
  blackbodyTemp:    $('#blackbody-temp'),
  blackbodyFitMeasured: $('#blackbody-fit-measured'),
  linearizeSensor:  $('#linearize-sensor'),
  frameAvg:         $('#frame-avg'),
  frameAvgValue:    $('#frame-avg-value'),
  showRgb:          $('#show-rgb'),
  flipHorizontal:   $('#flip-horizontal'),
  hideCameraView:   $('#hide-camera-view'),
  hideCurrentSpectrum: $('#hide-current-spectrum'),
  peakNormalize:       $('#peak-normalize'),
  colCropMin:       $('#col-crop-min'),
  colCropMax:       $('#col-crop-max'),
  colCropMinValue:  $('#col-crop-min-value'),
  colCropMaxValue:  $('#col-crop-max-value'),
  saveName:         $('#save-name'),
  saveSpectrum:     $('#save-spectrum'),
  savedList:        $('#saved-list'),
  plotEl:           $('#plot'),
  cursorInfo:       $('#plot-cursor-info'),
  enterCalMode:        $('#enter-cal-mode'),
  enterCalFraunhofer:  $('#enter-cal-fraunhofer'),
  applyCalMode:        $('#apply-cal-mode'),
  cancelCalMode:       $('#cancel-cal-mode'),
  calModeControls:     $('#cal-mode-controls'),
  calModeHint:         $('#cal-mode-hint'),
  calShowPeaks:        $('#cal-show-peaks'),
  calShowPeaksLabel:   $('#cal-show-peaks-label'),
  calAnchorGrid:       $('#cal-anchor-grid'),
  calFluoViewToggle:   $('#cal-fluo-view-toggle'),
  calViewAuto:         $('#cal-view-auto'),
  calViewManual:       $('#cal-view-manual'),
  calAutoPane:         $('#cal-auto-pane'),
  calManualPane:       $('#cal-manual-pane'),
  calAutoRerun:        $('#cal-auto-rerun'),
  calAutoSummary:      $('#cal-auto-summary'),
  enterCalAmplitude:   $('#enter-cal-amplitude'),
  calAmplitudePane:    $('#cal-amplitude-pane'),
  calAmpTemperature:   $('#cal-amp-temperature'),
  calAmpName:          $('#cal-amp-name'),
  amplitudeStatus:     $('#amplitude-status'),
  resetAmplitude:      $('#reset-amplitude'),
  amplitudeEnabled:    $('#amplitude-enabled'),
  amplitudeEnabledRow: $('#amplitude-enabled-row'),
  amplitudeCalSelect:  $('#amplitude-cal-select'),
  amplitudeCalSelectRow: $('#amplitude-cal-select-row'),
};

// Interactive visual calibration mode. null = off, 'fluo' = fluorescent peaks,
// 'fraunhofer' = solar absorption lines. Truthy in either active mode, so the
// existing `if (calibrationMode)` checks still work.
let calibrationMode = null;
// Which peak/line wavelengths the user has enabled as draggable anchors. Seeded
// from the `anchor: true` flag on FLUO_PEAKS / FRAUNHOFER_LINES on every cal
// entry, then mutated as the user toggles checkboxes in the cal panel.
let calAnchorWavelengths = new Set();
// Cal-mode-only overlay visibility, independent of the global show* state so
// turning them off after calibration doesn't affect what you see while next
// calibrating.
let calShowExpectedPeaks = true;
// Linear fit recomputed live from the current anchor marker positions while
// in any cal mode. Drives:
//   - non-anchor marker positioning (they slide onto the fit line)
//   - the blackbody overlay during fraunhofer cal
//   - the expected-fluorescent overlay during fluo cal
let liveCalFit = null;
// Fluorescent calibration sub-view. 'auto' runs peak detection + best-effort
// fit; 'manual' shows draggable anchors. Fraunhofer cal mode ignores this.
let calFluoView = 'auto';
// Result of the last auto-detect: { fit: {slope, intercept, r}, matches: [{pixel, intensity, wavelength, label, element, residual}] } or null.
let calAutoFit = null;

// ── Plot ─────────────────────────────────────────────────────────────────

let plot;
function pixelToWavelength(px) {
  if (!calibration) return px;
  return calibration.slope * px + calibration.intercept;
}

// True effective state: only display in nm when there's a calibration AND
// we're not currently in the visual-calibration UI (which forces pixel axis).
function showingWavelengths() {
  return !!calibration && !calibrationMode;
}

// The fit currently driving the on-screen mapping. In cal mode we project
// pixel ticks through this to render the axis as wavelengths live; the actual
// x-scale stays in pixel-index so cal-marker drag math doesn't have to fight
// a moving fit.
function activeFit() {
  if (calibrationMode === 'fluo' && calFluoView === 'auto') return calAutoFit?.fit ?? null;
  if (calibrationMode && liveCalFit) return liveCalFit;
  if (!calibrationMode && calibration) return calibration;
  return null;
}

function makePlot(width = 1280) {
  const useWavelength = showingWavelengths();
  const xs = new Float64Array(width);
  for (let i = 0; i < width; i++) xs[i] = useWavelength ? pixelToWavelength(i) : i;

  let series, data, pd;
  if (showRgb) {
    const rYs = new Float64Array(width);
    const gYs = new Float64Array(width);
    const bYs = new Float64Array(width);
    series = [
      {},
      { label: 'R', stroke: '#ff5b5b', width: 1.2, points: { show: false } },
      { label: 'G', stroke: '#5bff7a', width: 1.2, points: { show: false } },
      { label: 'B', stroke: '#5b9bff', width: 1.2, points: { show: false } },
    ];
    data = [xs, rYs, gYs, bYs];
    pd = { xs, rYs, gYs, bYs, mode: 'rgb' };
  } else {
    const rawYs = new Float64Array(width);
    const avgYs = new Float64Array(width);
    const cs = getComputedStyle(document.documentElement);
    const strongStroke = cs.getPropertyValue('--plot-line-strong').trim() || '#ffffff';
    series = [
      {},
      { label: 'realtime', stroke: 'rgba(88,166,255,0.35)', width: 1,   points: { show: false }, show: frameAvg > 1 },
      { label: 'averaged', stroke: strongStroke,            width: 1.5, points: { show: false } },
    ];
    data = [xs, rawYs, avgYs];
    pd = { xs, rawYs, avgYs, mode: 'mono' };
  }

  const opts = {
    width: $('#plot').clientWidth,
    height: Math.max(100, $('#plot').clientHeight),
    scales: {
      x: { time: false },
      y: { range: [0, 255] },
    },
    axes: (() => {
      const cs = getComputedStyle(document.documentElement);
      const axisStroke = cs.getPropertyValue('--muted').trim()       || '#8b949e';
      const gridStroke = cs.getPropertyValue('--plot-grid').trim()   || '#222b36';
      const tickStroke = cs.getPropertyValue('--plot-ticks').trim()  || '#30363d';
      return [
        {
          stroke: axisStroke,
          // In cal mode the x-scale is pixel-index but we display tick labels in
          // nm (projected through the live fit), so the axis reads as wavelength
          // already while the user is calibrating.
          label: (useWavelength || calibrationMode) ? 'wavelength (nm)' : 'pixel column',
          labelSize: 24,
          grid: { stroke: gridStroke },
          ticks: { stroke: tickStroke },
          values: (u, ticks) => {
            if (!calibrationMode) return ticks.map(t => t.toString());
            const fit = activeFit();
            if (!fit) return ticks.map(t => Math.round(t).toString());
            return ticks.map(t => Math.round(fit.slope * t + fit.intercept).toString());
          },
        },
        { stroke: axisStroke, label: 'intensity (0–255)', labelSize: 24, grid: { stroke: gridStroke }, ticks: { stroke: tickStroke } },
      ];
    })(),
    series,
    legend: { show: false },
    // Disable drag-to-zoom: the spectrum is sampled live so zooming via the
    // canvas is more confusing than useful. X-axis range is set explicitly via
    // the X min / X max inputs in the Spectrum display section.
    cursor: { show: true, drag: { x: false, y: false, setScale: false } },
    hooks: {
      // drawAxes runs after axes paint and BEFORE series — anything we paint
      // here lands underneath the data line, which is what calibration guides
      // need.
      drawAxes:  [u => drawCalMarkerLines(u)],
      draw:      [u => drawAnnotations(u)],
      setCursor: [u => updateCursorInfo(u)],
      setSize:   [() => positionCalMarkers()],
    },
  };
  plot = new uPlot(opts, data, $('#plot'));
  // applyXAxisRange has to run AFTER the global `plotData` is reassigned to
  // `pd` (the freshly-built xs), so callers do that — see rebuildPlot and
  // startCamera. If we called it here it would read the stale old xs (e.g.
  // nm values) and pin the new pixel-axis plot to wavelength numbers.
  // Keep uPlot pinned to #plot's actual rendered size. ResizeObserver handles
  // window resize, mini toggle, banner show/hide, devtools — anything that
  // reshapes the container — without needing per-event hooks.
  if (!makePlot._observer) {
    makePlot._observer = new ResizeObserver(() => {
      if (!plot) return;
      const el = $('#plot');
      plot.setSize({
        width:  el.clientWidth,
        height: Math.max(100, el.clientHeight),
      });
    });
    makePlot._observer.observe($('#plot'));
  }
  return pd;
}

function rebuildPlot() {
  if (!plot) return;
  // Carry the spectrum buffers across rebuild. Ys are indexed by pixel column
  // and don't depend on the x-axis units, so reusing them is safe — and it
  // matters because auto-cal's peak finder runs immediately after entering
  // cal mode, which wouldn't see anything if avgYs were freshly zeroed.
  const prev = plotData;
  plot.destroy();
  plot = null;
  plotData = makePlot(offscreen.width);
  if (prev && prev.mode === plotData.mode) {
    const copy = (src, dst) => { if (src && dst && src.length === dst.length) dst.set(src); };
    copy(prev.avgYs, plotData.avgYs);
    copy(prev.rawYs, plotData.rawYs);
    copy(prev.rYs,   plotData.rYs);
    copy(prev.gYs,   plotData.gYs);
    copy(prev.bYs,   plotData.bYs);
  }
  applyXAxisRange();
  applyHideCurrentSpectrumState();
}

function drawAnnotations(u) {
  drawOverexposureBands(u);
  drawSavedSpectra(u);
  drawFluoOverlay(u);
  drawCalAutoMatches(u);
  drawFraunhoferOverlay(u);
  drawBlackbodyOverlay(u);
  positionCalMarkers();
}

// Render every visible saved spectrum as a colored line over the plot. Each
// saved entry has its own calibration; we plot using that so a measurement
// taken with a different calibration still lands at the right wavelengths
// when overlaid.
function drawSavedSpectra(u) {
  if (savedMeasurements.length === 0) return;
  const ctx = u.ctx;
  const left  = u.bbox.left;
  const right = left + u.bbox.width;
  ctx.save();
  ctx.lineWidth = 1.2;
  ctx.setLineDash([]);
  savedMeasurements.forEach((entry, idx) => {
    if (!entry.visible) return;
    // Scale each saved spectrum so its own max hits the same target as the
    // live trace. Shapes line up; absolute intensity is meaningless on this
    // device anyway.
    let scale = 1;
    if (peakNormalize) {
      let maxVal = 0;
      for (let i = 0; i < entry.spectrum.length; i++) {
        const v = entry.spectrum[i];
        if (Number.isFinite(v) && v > maxVal) maxVal = v;
      }
      if (maxVal > 1e-9) scale = PEAK_NORM_TARGET / maxVal;
    }
    ctx.strokeStyle = colorOfSaved(entry, idx);
    ctx.beginPath();
    let started = false;
    const w = entry.spectrum.length;
    for (let i = 0; i < w; i++) {
      let xVal;
      if (entry.calibration && Math.abs(entry.calibration.slope) > 1e-9) {
        xVal = entry.calibration.slope * i + entry.calibration.intercept;
      } else if (calibration && entry.sensorWidth === offscreen.width) {
        // Saved was uncalibrated but came from the same sensor — fall back to
        // the current calibration so it lines up under wavelength axis.
        xVal = calibration.slope * i + calibration.intercept;
      } else {
        xVal = i;
      }
      const xPx = u.valToPos(xVal, 'x', true);
      if (xPx < left - 2 || xPx > right + 2) {
        if (started) { ctx.stroke(); ctx.beginPath(); started = false; }
        continue;
      }
      const yPx = u.valToPos(entry.spectrum[i] * scale, 'y', true);
      if (!started) { ctx.moveTo(xPx, yPx); started = true; }
      else ctx.lineTo(xPx, yPx);
    }
    ctx.stroke();
  });
  ctx.restore();
}

function persistSavedMeasurements() {
  try {
    localStorage.setItem('savedMeasurements', JSON.stringify(savedMeasurements));
  } catch (e) {
    alert(`Couldn't save: ${e.message}. Storage may be full — delete some measurements.`);
  }
}

// Capture the current displayed averaged spectrum (works in both mono and
// rgb modes — RGB collapses to mean of the three channels) along with the
// active calibration. Visible by default so the user immediately sees the
// overlay appear.
function saveCurrentSpectrum() {
  if (!plotData) { alert('No spectrum to save yet — wait for the camera.'); return; }
  const w = plotData.xs.length;
  const spectrum = new Array(w);
  if (plotData.mode === 'rgb') {
    for (let i = 0; i < w; i++) {
      spectrum[i] = +(((plotData.rYs[i] + plotData.gYs[i] + plotData.bYs[i]) / 3).toFixed(2));
    }
  } else {
    for (let i = 0; i < w; i++) spectrum[i] = +plotData.avgYs[i].toFixed(2);
  }
  const rawName = (els.saveName.value || '').trim();
  const name = rawName || `Measurement ${new Date().toLocaleString()}`;
  const entry = {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    timestamp: Date.now(),
    spectrum,
    calibration: calibration ? { ...calibration } : null,
    sensorWidth: offscreen.width || w,
    visible: true,
  };
  savedMeasurements.push(entry);
  persistSavedMeasurements();
  els.saveName.value = '';
  renderSavedList();
  if (plot) plot.redraw(false);
}

function deleteSavedMeasurement(id) {
  const entry = savedMeasurements.find(e => e.id === id);
  if (!entry) return;
  if (!confirm(`Delete "${entry.name}"?`)) return;
  savedMeasurements = savedMeasurements.filter(e => e.id !== id);
  persistSavedMeasurements();
  renderSavedList();
  if (plot) plot.redraw(false);
}

function toggleSavedVisible(id) {
  const entry = savedMeasurements.find(e => e.id === id);
  if (!entry) return;
  entry.visible = !entry.visible;
  persistSavedMeasurements();
  renderSavedList();
  if (plot) plot.redraw(false);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderSavedList() {
  if (!els.savedList) return;
  if (savedMeasurements.length === 0) {
    els.savedList.innerHTML = '<p class="empty">No saved measurements yet.</p>';
    return;
  }
  // Newest first.
  const ordered = [...savedMeasurements].sort((a, b) => b.timestamp - a.timestamp);
  els.savedList.innerHTML = '';
  for (const entry of ordered) {
    const idx = savedMeasurements.indexOf(entry);
    const date = new Date(entry.timestamp).toLocaleString();
    const calStr = entry.calibration
      ? ` · cal r=${(entry.calibration.r ?? 0).toFixed(4)}`
      : ' · no cal';
    const row = document.createElement('div');
    row.className = `saved-row${entry.visible ? '' : ' hidden-spectrum'}`;
    row.innerHTML = `
      <input type="color" class="swatch-input" data-id="${entry.id}" value="${colorOfSaved(entry, idx)}" title="Click to change line color" />
      <div class="saved-meta">
        <span class="saved-name">${escapeHtml(entry.name)}</span>
        <span class="saved-time">${date}${calStr}</span>
      </div>
      <div class="saved-actions">
        <button class="toggle" data-id="${entry.id}" title="${entry.visible ? 'Hide' : 'Show'} on plot">${entry.visible ? '👁' : '◌'}</button>
        <button class="delete" data-id="${entry.id}" title="Delete">×</button>
      </div>
    `;
    els.savedList.appendChild(row);
  }
  els.savedList.querySelectorAll('.toggle').forEach(b =>
    b.addEventListener('click', () => toggleSavedVisible(b.dataset.id)));
  els.savedList.querySelectorAll('.delete').forEach(b =>
    b.addEventListener('click', () => deleteSavedMeasurement(b.dataset.id)));
  els.savedList.querySelectorAll('.swatch-input').forEach(input =>
    input.addEventListener('input', () => setSavedColor(input.dataset.id, input.value)));
}

function setSavedColor(id, color) {
  const entry = savedMeasurements.find(e => e.id === id);
  if (!entry) return;
  entry.color = color;
  persistSavedMeasurements();
  if (plot) plot.redraw(false);
}

// Render the cursor info box (intensity / pixel / wavelength) whenever uPlot's
// cursor moves. Hidden when the cursor leaves the plot.
function updateCursorInfo(u) {
  const idx = u.cursor.idx;
  if (idx == null || !plotData) {
    els.cursorInfo.style.display = 'none';
    return;
  }
  const xData = u.data[0][idx];
  let pixel, wavelength;
  if (showingWavelengths()) {
    wavelength = xData;
    pixel = (xData - calibration.intercept) / calibration.slope;
  } else {
    pixel = xData;
    wavelength = calibration ? calibration.slope * xData + calibration.intercept : null;
  }
  let html = '';
  html += `<div><span class="label">pixel</span>${Math.round(pixel)}</div>`;
  if (wavelength != null) html += `<div><span class="label">λ</span>${wavelength.toFixed(2)} nm</div>`;
  if (plotData.mode === 'rgb') {
    const r = plotData.rYs[idx], g = plotData.gYs[idx], b = plotData.bYs[idx];
    html += `<div><span class="label" style="color:#ff5b5b">R</span>${r != null ? r.toFixed(1) : '—'}</div>`;
    html += `<div><span class="label" style="color:#5bff7a">G</span>${g != null ? g.toFixed(1) : '—'}</div>`;
    html += `<div><span class="label" style="color:#5b9bff">B</span>${b != null ? b.toFixed(1) : '—'}</div>`;
  } else {
    const yData = u.data[2][idx];
    html += `<div><span class="label">intensity</span>${yData != null ? yData.toFixed(1) : '—'}</div>`;
  }
  els.cursorInfo.innerHTML = html;
  els.cursorInfo.style.display = 'block';
}

// Translucent red rectangles spanning the full plot height for any contiguous
// pixel range where the averaged spectrum exceeds OVEREXPOSURE_THRESHOLD.
function drawOverexposureBands(u) {
  if (!plotData) return;
  const xs = plotData.xs;
  // In RGB mode, flag overexposure if any channel clips at this column.
  const w = xs.length;
  let avg;
  if (plotData.mode === 'rgb') {
    avg = new Float64Array(w);
    for (let i = 0; i < w; i++) {
      avg[i] = Math.max(plotData.rYs[i], plotData.gYs[i], plotData.bYs[i]);
    }
  } else {
    avg = plotData.avgYs;
  }
  const ctx = u.ctx;
  const top = u.bbox.top;
  const height = u.bbox.height;

  ctx.save();
  ctx.fillStyle = 'rgba(248,81,73,0.22)';

  let i = 0;
  while (i < xs.length) {
    if (avg[i] > OVEREXPOSURE_THRESHOLD) {
      const start = i;
      while (i < xs.length && avg[i] > OVEREXPOSURE_THRESHOLD) i++;
      const end = i - 1;
      // Half-step padding so the band visually extends across the full pixel
      // bin instead of cutting at the sample centres.
      const xLeft  = u.valToPos(xs[Math.max(start - 1, 0)],         'x', true);
      const xRight = u.valToPos(xs[Math.min(end + 1, xs.length-1)], 'x', true);
      const xMid0  = u.valToPos(xs[start], 'x', true);
      const xMid1  = u.valToPos(xs[end],   'x', true);
      const x0 = (xLeft + xMid0) / 2;
      const x1 = (xRight + xMid1) / 2;
      ctx.fillRect(x0, top, Math.max(1, x1 - x0), height);
    } else {
      i++;
    }
  }
  ctx.restore();
}

// Yellow dashed Planck-curve overlay scaled to the measured spectrum's peak.
// Mirrors lgscli's plot_spectrum.py:296–304 (`s = blackbody_power_lt(...);
// normalize_spectrum(); s *= max_y; xyline()`) — the curve is a visual
// reference, not a data series. Useful before applying amplitude correction
// (you can see the shape the device should be reading) and as a sanity check
// after (the corrected spectrum should overlay the curve when pointed at the
// reference lamp).
function drawBlackbodyOverlay(u) {
  if (!showBlackbody || calibrationMode || !calibration) return;
  if (!Number.isFinite(blackbodyTemp) || blackbodyTemp < 1000) return;

  const ctx = u.ctx;
  const { left, top, width, height } = u.bbox;

  // Sample Planck radiance at every measured x position (plot xs[i] is in nm
  // when calibration is set — gated above). Sharing the wavelength grid with
  // the data lets us do the L2 fit point-for-point and reuses the same loop
  // for drawing. uPlot's data array reflects what's actually rendered (peak-
  // normalize, etc. already baked in), so reading from u.data keeps the fit
  // honest about whatever the user sees.
  const xs = u.data?.[0];
  if (!xs?.length) return;
  const W = xs.length;
  const planck = new Float64Array(W);
  let planckMax = 0;
  for (let i = 0; i < W; i++) {
    const lam = xs[i];
    const v = Number.isFinite(lam) && lam > 0 ? planckRadiance(lam, blackbodyTemp) : 0;
    planck[i] = v;
    if (v > planckMax) planckMax = v;
  }
  if (planckMax < 1e-30) return;

  // Two scaling modes:
  //   - free:   peak of Planck pinned at 95% of the y-axis max — independent
  //             vertical scaling, useful as a generic shape reference.
  //   - fitted: closed-form least-squares fit through the origin,
  //                 s = Σ(p_i · y_i) / Σ(p_i²)
  //             over every visible (non-NaN, non-negative) measured pixel
  //             across all displayed series. Distributes residuals across the
  //             whole spectrum instead of pinning one point — more robust
  //             when the measured peak is noisy, saturated, or off a
  //             non-uniform sensor pixel. Strong-signal / strong-Planck
  //             wavelengths dominate the fit naturally because both factors
  //             multiply into the sum, so noise at the dim edges of the
  //             spectrum doesn't pull the scale.
  let scale;
  if (blackbodyFitMeasured) {
    const seriesIndices = plotData?.mode === 'rgb' ? [1, 2, 3] : [2]; // avg trace
    let pyCross = 0, pp = 0;
    for (let i = 0; i < W; i++) {
      const p = planck[i];
      if (!(p > 0)) continue;
      for (const si of seriesIndices) {
        const arr = u.data?.[si];
        if (!arr) continue;
        const y = arr[i];
        if (!Number.isFinite(y) || y <= 0) continue;
        pyCross += p * y;
        pp      += p * p;
      }
    }
    if (pp < 1e-30 || pyCross <= 0) return;
    scale = pyCross / pp;
  } else {
    const yMax = u.scales.y?.max;
    if (!Number.isFinite(yMax) || yMax <= 0) return;
    scale = (yMax * 0.95) / planckMax;
  }

  const cs = getComputedStyle(document.documentElement);
  const bbStroke = cs.getPropertyValue('--overlay-blackbody-stroke').trim() || 'rgba(255,200,60,0.85)';
  const bbFill   = cs.getPropertyValue('--overlay-blackbody-fill').trim()   || 'rgba(255,200,60,1)';
  ctx.save();
  ctx.strokeStyle = bbStroke;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < W; i++) {
    const lam = xs[i];
    if (!Number.isFinite(lam) || lam <= 0) continue;
    const xPx = u.valToPos(lam, 'x', true);
    const yPx = u.valToPos(planck[i] * scale, 'y', true);
    if (!Number.isFinite(xPx) || !Number.isFinite(yPx)) continue;
    if (!started) { ctx.moveTo(xPx, yPx); started = true; }
    else { ctx.lineTo(xPx, yPx); }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Label near the peak (Wien's law λ_max ≈ 2.898e6/T nm). Out-of-range
  // peaks get pinned to the right edge.
  const sMin = u.scales.x.min, sMax = u.scales.x.max;
  const wienPeakNm = 2.898e6 / blackbodyTemp;
  let labelX;
  if (wienPeakNm >= sMin && wienPeakNm <= sMax) {
    labelX = u.valToPos(wienPeakNm, 'x', true);
  } else {
    labelX = left + width - 80;
  }
  ctx.fillStyle = bbFill;
  ctx.font = '14px ui-monospace, monospace';
  ctx.fillText(`${blackbodyTemp} K`, labelX + 4, top + height - 6);
  ctx.restore();
}

function drawFluoOverlay(u) {
  // Single visual style across all three contexts so the user isn't faced
  // with multiple "kinds" of red lines:
  //   - Manual cal: project FLUO_PEAKS through liveCalFit (driven by anchor
  //     drags). Gated by calShowExpectedPeaks so the user can hide them.
  //   - Auto cal: project through calAutoFit.fit. Always on — they're the
  //     primary cue alongside the red detected-peak circles.
  //   - Normal calibrated mode: x-axis is already nm; gated by showFluoOverlay.
  let wlToX = null;
  if (calibrationMode === 'fluo') {
    let fit = null;
    if (calFluoView === 'auto') fit = calAutoFit?.fit ?? null;
    else if (calShowExpectedPeaks) fit = liveCalFit;
    if (fit) wlToX = (wl) => u.valToPos((wl - fit.intercept) / fit.slope, 'x', true);
  } else if (!calibrationMode && showFluoOverlay && calibration) {
    wlToX = (wl) => u.valToPos(wl, 'x', true);
  }
  if (!wlToX) return;

  const ctx = u.ctx;
  ctx.save();
  ctx.strokeStyle = 'rgba(230,40,40,0.9)';
  ctx.fillStyle   = 'rgba(255,80,80,1)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.font = '20px ui-monospace, monospace';

  const top = u.bbox.top;
  const bottom = top + u.bbox.height;
  const left = u.bbox.left;
  const right = left + u.bbox.width;

  for (const peak of FLUO_PEAKS) {
    const x = wlToX(peak.wavelength);
    if (x < left || x > right) continue;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    // Stagger the closely-spaced 542.4 / 546.1 nm pair so the labels don't
    // overlap. Now that the font is 20px, ~24px line-height isn't enough — the
    // 546.1 label drops a full label-row below 542.4.
    const offset = (peak.wavelength === 546.1) ? 48 : 18;
    ctx.fillText(`${peak.label} ${peak.element}`, x + 2, top + offset);
  }
  ctx.restore();
}

// Vertical dashed lines + element labels for the major Fraunhofer absorption
// lines. Cyan to keep them distinct from the red fluorescent overlay and the
// yellow blackbody curve. Visual prominence (line width, opacity, label
// brightness) scales with each line's expected webcam-observed depth.
function drawFraunhoferOverlay(u) {
  const inFraunhoferCal = calibrationMode === 'fraunhofer' && liveCalFit;
  const showInCal  = inFraunhoferCal && calShowExpectedPeaks;
  const showNormal = !calibrationMode && showFraunhofer && showingWavelengths();
  if (!showInCal && !showNormal) return;

  // nm → canvas-x. In cal mode the axis is pixel-index, so route via the live
  // fit's inverse; in normal mode the axis is wavelength.
  const wlToX = inFraunhoferCal
    ? (wl) => u.valToPos((wl - liveCalFit.intercept) / liveCalFit.slope, 'x', true)
    : (wl) => u.valToPos(wl, 'x', true);

  const ctx = u.ctx;
  const cs = getComputedStyle(document.documentElement);
  ctx.save();
  ctx.strokeStyle = cs.getPropertyValue('--overlay-fraunhofer-stroke').trim() || 'rgb(120,220,255)';
  ctx.fillStyle   = cs.getPropertyValue('--overlay-fraunhofer-fill').trim()   || 'rgb(180,235,255)';
  ctx.setLineDash([3, 3]);

  const top = u.bbox.top;
  const bottom = top + u.bbox.height;
  const left = u.bbox.left;
  const right = left + u.bbox.width;

  // Dark cyan-on-black has good contrast already, but the dark-teal-on-white
  // light-mode variant needs both extra width and full opacity to read well.
  const isLight = document.documentElement.dataset.theme === 'light';
  const widthMul = isLight ? 1.8 : 1.0;
  const alphaBase = isLight ? 0.6 : 0.25;
  const alphaSpan = isLight ? 0.4 : 0.75;
  for (const line of FRAUNHOFER_LINES) {
    const x = wlToX(line.wavelength);
    if (x < left || x > right) continue;
    // depth ∈ [0.10, 0.65] sets relative prominence per line.
    ctx.globalAlpha = alphaBase + line.depth * alphaSpan;
    ctx.lineWidth   = Math.max(1, line.depth * 3.5 * widthMul);
    ctx.font        = `${Math.round(15 + line.depth * 8)}px ui-monospace, monospace`;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.fillText(`${line.label} ${line.wavelength} ${line.element}`, x + 2, top + 36);
  }
  ctx.restore();
}

// ── Video & sampling ──────────────────────────────────────────────────────

const offscreen = document.createElement('canvas');
const offCtx = offscreen.getContext('2d', { willReadFrequently: true });
let plotData = null;
let videoReady = false;

// Rolling window of recent per-frame intensity arrays. Length is bounded by
// the Frame averaging slider (1–30). When length === 1 the displayed spectrum
// is just the latest frame (no averaging).
let frameAvg = (() => {
  const v = parseInt(localStorage.getItem('frameAvg'), 10);
  return Number.isFinite(v) && v >= 1 && v <= 30 ? v : 10;
})();
const frameRaws = [];
// Anywhere the averaged spectrum exceeds this 0–255 value, draw a red overlay
// to flag clipping. lgscli's specap.cpp uses 0.998 of full range, ≈ 254/255;
// 245 catches near-clipping a bit earlier so the user gets warning before
// the peaks are flat-topped.
const OVEREXPOSURE_THRESHOLD = 245;

async function listCameras() {
  // First ensure we have permission so device labels are populated
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
    tmp.getTracks().forEach(t => t.stop());
  } catch {}
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter(d => d.kind === 'videoinput');
  els.deviceSelect.innerHTML = '';
  for (const c of cams) {
    const opt = document.createElement('option');
    opt.value = c.deviceId;
    opt.textContent = c.label || `Camera ${c.deviceId.slice(0, 6)}`;
    els.deviceSelect.appendChild(opt);
  }
  // Auto-pick a USB camera if there's one
  const usb = cams.find(c => /usb|sonix/i.test(c.label));
  if (usb) els.deviceSelect.value = usb.deviceId;
}

function stopCamera() {
  if (els.video.srcObject) {
    els.video.srcObject.getTracks().forEach(t => t.stop());
    els.video.srcObject = null;
  }
  videoReady = false;
  els.statusCamera.className = 'badge badge-warn';
  els.statusCamera.textContent = 'stopped';
  if (els.captureStart) els.captureStart.disabled = false;
  if (els.captureStop)  els.captureStop.disabled  = true;
}

async function startCamera(deviceId) {
  if (els.video.srcObject) {
    els.video.srcObject.getTracks().forEach(t => t.stop());
  }
  if (els.captureStart) els.captureStart.disabled = true;
  if (els.captureStop)  els.captureStop.disabled  = false;
  const constraints = {
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width:  { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  };
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    els.video.srcObject = stream;
    await new Promise(res => els.video.addEventListener('loadedmetadata', res, { once: true }));
    offscreen.width = els.video.videoWidth;
    offscreen.height = els.video.videoHeight;
    updateOverlays();
    if (els.colCropMinValue) updateColCropLabels();
    if (!plot || plot._w !== offscreen.width) {
      if (plot) { plot.destroy(); plot = null; }
      plotData = makePlot(offscreen.width);
      plot._w = offscreen.width;
      applyXAxisRange();
      applyHideCurrentSpectrumState();
    }
    videoReady = true;
    els.statusCamera.className = 'badge badge-ok';
    els.statusCamera.textContent = `${offscreen.width}×${offscreen.height}`;
  } catch (e) {
    videoReady = false;
    els.statusCamera.className = 'badge badge-err';
    els.statusCamera.textContent = `camera: ${e.name}`;
    console.error(e);
  }
}

// Column crop helpers. The user-visible crop is in *plot* space (the displayed
// spectrum), so getCamCropRange flips it back to camera columns when needed.
function getPlotCropRange() {
  const w = offscreen.width || 1280;
  const lo = Math.max(0, Math.min(w, Math.floor((colCropMinPct / 100) * w)));
  const hi = Math.max(lo, Math.min(w, Math.ceil ((colCropMaxPct / 100) * w)));
  return { lo, hi };
}
function getCamCropRange() {
  const w = offscreen.width || 1280;
  const { lo, hi } = getPlotCropRange();
  return flipHorizontal ? { lo: w - hi, hi: w - lo } : { lo, hi };
}

// Pin the plot's x-axis to the column-crop range. The crop sliders are the
// single source of truth for both the data crop (NaN-fill outside the kept
// range) and the visible x-range, so adjusting them updates the plot
// instantly. uPlot stores `scale.auto` as a function (it wraps booleans into
// one at construction), so the auto toggle has to be a function, not boolean.
function applyXAxisRange() {
  if (!plot || !plotData?.xs) return;
  const xs = plotData.xs;
  const { lo, hi } = getPlotCropRange();
  if (!xs.length || hi <= lo) return;
  const isFull = lo === 0 && hi === xs.length;
  if (isFull) {
    plot.scales.x.auto = () => true;
    return; // next setData (~60Hz) auto-ranges from xs[0]..xs[w-1]
  }
  const a = xs[Math.min(lo, xs.length - 1)];
  const b = xs[Math.min(Math.max(lo, hi - 1), xs.length - 1)];
  plot.scales.x.auto = () => false;
  plot.setScale('x', { min: Math.min(a, b), max: Math.max(a, b) });
}

function sampleSpectrum() {
  if (!videoReady || els.video.readyState < 2) return;
  const w = offscreen.width, h = offscreen.height;
  const bandH = parseInt(els.bandSlider.value, 10);
  const center = Math.round((parseInt(els.rowSlider.value, 10) / 100) * h);
  const y0 = Math.max(0, center - Math.floor(bandH / 2));
  const y1 = Math.min(h, y0 + bandH);

  // Draw current frame and read just the rows we care about
  offCtx.drawImage(els.video, 0, 0, w, h);
  const img = offCtx.getImageData(0, y0, w, y1 - y0).data;
  const rows = y1 - y0;
  const { lo: cropLo, hi: cropHi } = getPlotCropRange();

  if (plotData.mode === 'rgb') {
    // Per-channel row-mean.
    const rCur = new Float64Array(w);
    const gCur = new Float64Array(w);
    const bCur = new Float64Array(w);
    for (let x = 0; x < w; x++) {
      // When flipped, read from the right edge inward so spectrum index 0
      // corresponds to the rightmost camera column.
      const srcX = flipHorizontal ? (w - 1 - x) : x;
      let r = 0, g = 0, b = 0;
      for (let row = 0; row < rows; row++) {
        const i = (row * w + srcX) * 4;
        r += img[i]; g += img[i + 1]; b += img[i + 2];
      }
      rCur[x] = r / rows;
      gCur[x] = g / rows;
      bCur[x] = b / rows;
    }

    frameRaws.push({ r: rCur, g: gCur, b: bCur });
    while (frameRaws.length > frameAvg) frameRaws.shift();

    const n = frameRaws.length;
    if (n === 1) {
      plotData.rYs.set(rCur);
      plotData.gYs.set(gCur);
      plotData.bYs.set(bCur);
    } else {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0;
        for (let f = 0; f < n; f++) {
          r += frameRaws[f].r[x];
          g += frameRaws[f].g[x];
          b += frameRaws[f].b[x];
        }
        plotData.rYs[x] = r / n;
        plotData.gYs[x] = g / n;
        plotData.bYs[x] = b / n;
      }
    }
    if (linearizeSensor) {
      applySensorLinearization(plotData.rYs, w);
      applySensorLinearization(plotData.gYs, w);
      applySensorLinearization(plotData.bYs, w);
    }
    if (amplitudeCorrectionActive()) {
      applyAmplitudeCorrection(plotData.rYs, w);
      applyAmplitudeCorrection(plotData.gYs, w);
      applyAmplitudeCorrection(plotData.bYs, w);
    }
    for (let x = 0; x < cropLo; x++)      { plotData.rYs[x] = NaN; plotData.gYs[x] = NaN; plotData.bYs[x] = NaN; }
    for (let x = cropHi; x < w; x++)      { plotData.rYs[x] = NaN; plotData.gYs[x] = NaN; plotData.bYs[x] = NaN; }
    let dR = plotData.rYs, dG = plotData.gYs, dB = plotData.bYs;
    if (peakNormalize) {
      let maxVal = 0;
      for (let x = cropLo; x < cropHi; x++) {
        const r = plotData.rYs[x], g = plotData.gYs[x], b = plotData.bYs[x];
        if (Number.isFinite(r) && r > maxVal) maxVal = r;
        if (Number.isFinite(g) && g > maxVal) maxVal = g;
        if (Number.isFinite(b) && b > maxVal) maxVal = b;
      }
      if (maxVal > 1e-9) {
        const k = PEAK_NORM_TARGET / maxVal;
        if (!plotData._sR) { plotData._sR = new Float64Array(w); plotData._sG = new Float64Array(w); plotData._sB = new Float64Array(w); }
        for (let x = 0; x < w; x++) {
          plotData._sR[x] = plotData.rYs[x] * k;
          plotData._sG[x] = plotData.gYs[x] * k;
          plotData._sB[x] = plotData.bYs[x] * k;
        }
        dR = plotData._sR; dG = plotData._sG; dB = plotData._sB;
      }
    }
    plot.setData([plotData.xs, dR, dG, dB]);
    return;
  }

  // Combined-intensity (mono) path.
  const current = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    const srcX = flipHorizontal ? (w - 1 - x) : x;
    let sum = 0;
    for (let row = 0; row < rows; row++) {
      const i = (row * w + srcX) * 4;
      // Average R+G+B as the intensity. Bayer-stripped sensors output near
      // R=G=B for monochromatic light, so this works fine.
      sum += img[i] + img[i + 1] + img[i + 2];
    }
    current[x] = sum / (rows * 3);
  }

  frameRaws.push(current);
  while (frameRaws.length > frameAvg) frameRaws.shift();

  plotData.rawYs.set(current);

  const avg = plotData.avgYs;
  const n = frameRaws.length;
  if (n === 1) {
    avg.set(current);
  } else {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let f = 0; f < n; f++) s += frameRaws[f][x];
      avg[x] = s / n;
    }
  }

  if (linearizeSensor) {
    applySensorLinearization(plotData.rawYs, w);
    applySensorLinearization(plotData.avgYs, w);
  }
  if (amplitudeCorrectionActive()) {
    applyAmplitudeCorrection(plotData.rawYs, w);
    applyAmplitudeCorrection(plotData.avgYs, w);
  }
  for (let x = 0; x < cropLo; x++) { plotData.rawYs[x] = NaN; plotData.avgYs[x] = NaN; }
  for (let x = cropHi; x < w; x++) { plotData.rawYs[x] = NaN; plotData.avgYs[x] = NaN; }
  let dRaw = plotData.rawYs, dAvg = plotData.avgYs;
  if (peakNormalize) {
    // Use the averaged trace's peak in the visible range as the normaliser
    // (the averaged line is what the user looks at; raw is just a faint
    // companion). Keep raw values untouched in plotData so saved spectra
    // are stored at their true intensity regardless of display state.
    let maxVal = 0;
    for (let x = cropLo; x < cropHi; x++) {
      const v = plotData.avgYs[x];
      if (Number.isFinite(v) && v > maxVal) maxVal = v;
    }
    if (maxVal > 1e-9) {
      const k = PEAK_NORM_TARGET / maxVal;
      if (!plotData._sRaw) { plotData._sRaw = new Float64Array(w); plotData._sAvg = new Float64Array(w); }
      for (let x = 0; x < w; x++) {
        plotData._sRaw[x] = plotData.rawYs[x] * k;
        plotData._sAvg[x] = plotData.avgYs[x] * k;
      }
      dRaw = plotData._sRaw; dAvg = plotData._sAvg;
    }
  }
  plot.setData([plotData.xs, dRaw, dAvg]);
}

// Compute the rendered camera-content rectangle inside the .video-wrap.
// Returns null if the video stream isn't running yet. Used by both the white
// frame overlay and the sample-row marker so they share one coordinate system.
function getContentRect() {
  const v = els.video;
  if (!v.videoWidth || !v.videoHeight) return null;
  const wrap = els.videoWrap.getBoundingClientRect();
  const aspect = v.videoWidth / v.videoHeight;
  let contentW, contentH;
  if (wrap.width / wrap.height > aspect) {
    contentH = wrap.height;
    contentW = wrap.height * aspect;
  } else {
    contentW = wrap.width;
    contentH = wrap.width / aspect;
  }
  return {
    left:   (wrap.width  - contentW) / 2,
    top:    (wrap.height - contentH) / 2,
    width:  contentW,
    height: contentH,
    scale:  contentH / v.videoHeight, // display pixels per camera pixel
  };
}

function updateVideoFrame() {
  const r = getContentRect();
  if (!r) { els.videoFrame.style.display = 'none'; return; }
  els.videoFrame.style.display = 'block';
  els.videoFrame.style.left   = `${r.left}px`;
  els.videoFrame.style.top    = `${r.top}px`;
  els.videoFrame.style.width  = `${r.width}px`;
  els.videoFrame.style.height = `${r.height}px`;
}

// Re-runs both overlays whenever any of their inputs change.
function updateOverlays() {
  updateVideoFrame();
  updateRowMarker();
}

// Mirror the displayed video horizontally so it matches the (also-mirrored)
// spectrum data. The overlay div, row marker, and toggle button live on the
// wrap, not the video — so they stay put.
function applyFlipState() {
  els.video.style.transform = flipHorizontal ? 'scaleX(-1)' : '';
}

function updateColCropLabels() {
  const w = offscreen.width || 1280;
  const lo = Math.floor((colCropMinPct / 100) * w);
  const hi = Math.ceil ((colCropMaxPct / 100) * w);
  els.colCropMinValue.textContent = `${lo} px`;
  els.colCropMaxValue.textContent = `${hi} px`;
}

function applyHideCurrentSpectrumState() {
  if (!plot || !plotData) return;
  // Series indexing depends on plot mode. Mono: 1=realtime, 2=averaged.
  // Rgb: 1=R, 2=G, 3=B. Hiding all of them leaves only the saved-spectrum
  // overlays (drawn via the canvas hook) visible.
  const liveSeries = plotData.mode === 'rgb' ? [1, 2, 3] : [1, 2];
  const show = !hideCurrentSpectrum;
  for (const idx of liveSeries) {
    // In mono mode the realtime series is also gated by frameAvg > 1 — preserve
    // that by re-applying the gate when un-hiding.
    const gateOk = !(plotData.mode === 'mono' && idx === 1) || frameAvg > 1;
    plot.setSeries(idx, { show: show && gateOk });
  }
}

function applyHideCameraViewState() {
  // Don't use display:none / visibility:hidden. Both work fine when set at
  // page load (video starts hidden and never enters the optimization), but
  // toggling them at runtime trips a Chromium decode-pipeline suspension —
  // drawImage starts returning the same stale frame and the plot freezes.
  // opacity:0 keeps the element rendered/composited (so decoding continues)
  // and pointer-events:none lets clicks fall through to the plot beneath.
  const pane = document.querySelector('.video-pane');
  pane.style.opacity = hideCameraView ? '0' : '';
  pane.style.pointerEvents = hideCameraView ? 'none' : '';
}

// Native <input type="range"> behaves inconsistently across browsers/OSes
// when you click the track outside the thumb — some jump to the click
// position, others step toward it. Force the jump-to-click behavior
// uniformly. Document-level delegation so this also covers sliders that
// are added later (e.g. the rebuilt simple-mode exposure slider).
function setupRangeClickToJump() {
  document.addEventListener('pointerdown', (e) => {
    const slider = e.target;
    if (!(slider instanceof HTMLInputElement)) return;
    if (slider.type !== 'range' || slider.disabled) return;
    const rect = slider.getBoundingClientRect();
    if (rect.width <= 0) return;
    const min  = parseFloat(slider.min)  || 0;
    const max  = parseFloat(slider.max)  || 100;
    const step = parseFloat(slider.step) || 1;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    let v = min + ratio * (max - min);
    v = Math.round(v / step) * step;
    v = Math.max(min, Math.min(max, v));
    if (Number(slider.value) === v) return;
    slider.value = String(v);
    // Mirror the native input/change pair so existing listeners react. The
    // browser will keep emitting `input` events as the user drags from here.
    slider.dispatchEvent(new Event('input',  { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function setupDraggableVideo() {
  // Grab anywhere on the video viewport to drag it around the plot area.
  const pane = document.querySelector('.video-pane');
  const wrap = document.querySelector('.video-wrap');
  let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

  wrap.addEventListener('pointerdown', (e) => {
    dragging = true;
    wrap.classList.add('dragging');
    wrap.setPointerCapture(e.pointerId);
    const rect = pane.getBoundingClientRect();
    const mainRect = els.main.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    startLeft = rect.left; startTop = rect.top;
    // Pin the pane's current position via inline left/top BEFORE clearing
    // `right`. Otherwise there's a one-frame window where the pane has neither
    // anchor and snaps to left:0 — visible as a jump on the first drag after
    // a page refresh.
    pane.style.left = `${rect.left - mainRect.left}px`;
    pane.style.top  = `${rect.top  - mainRect.top}px`;
    pane.style.right = 'auto';
    e.preventDefault();
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const mainRect = els.main.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    let nx = startLeft + (e.clientX - startX) - mainRect.left;
    let ny = startTop  + (e.clientY - startY) - mainRect.top;
    // Clamp to main bounds (allow ~50% off-screen so user can recover)
    nx = Math.max(-paneRect.width * 0.5,  Math.min(mainRect.width  - paneRect.width  * 0.5, nx));
    ny = Math.max(0, Math.min(mainRect.height - paneRect.height * 0.5, ny));
    pane.style.left = `${nx}px`;
    pane.style.top  = `${ny}px`;
  });
  wrap.addEventListener('pointerup', (e) => {
    dragging = false;
    wrap.classList.remove('dragging');
    try { wrap.releasePointerCapture(e.pointerId); } catch {}
  });
}

function autoDetectRow() {
  if (!videoReady || els.video.readyState < 2) return;
  const w = offscreen.width, h = offscreen.height;
  offCtx.drawImage(els.video, 0, 0, w, h);
  const img = offCtx.getImageData(0, 0, w, h).data;

  // Restrict to the user's column crop (in camera space) so dead pixels
  // outside the diffraction band don't drown the actual peak.
  const { lo: camLo, hi: camHi } = getCamCropRange();
  const cropW = Math.max(1, camHi - camLo);

  // Mean intensity per row (R+G+B/3, averaged across kept columns).
  const rowMean = new Float64Array(h);
  let peakVal = 0, peakY = 0;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    const base = y * w * 4;
    for (let x = camLo; x < camHi; x++) {
      const i = base + x * 4;
      sum += img[i] + img[i + 1] + img[i + 2];
    }
    const mean = sum / (cropW * 3);
    rowMean[y] = mean;
    if (mean > peakVal) { peakVal = mean; peakY = y; }
  }

  // Expand around peak while rows stay ≥ 0.5 × peak. Same heuristic as
  // specap.cpp's row weighting (it uses 0.8 but that's too tight on the
  // browser-decoded YUV→RGB stream where the band edges are softer).
  const threshold = 0.5 * peakVal;
  let bandStart = peakY, bandEnd = peakY;
  while (bandStart > 0     && rowMean[bandStart - 1] >= threshold) bandStart--;
  while (bandEnd   < h - 1 && rowMean[bandEnd   + 1] >= threshold) bandEnd++;

  const center = (bandStart + bandEnd) / 2;
  const bandHeight = bandEnd - bandStart + 1;
  const maxBand = parseInt(els.bandSlider.max, 10);

  els.rowSlider.value  = Math.round((center / h) * 100);
  els.bandSlider.value = Math.min(Math.max(bandHeight, 1), maxBand);
  updateRowMarker();

  // Brief visual confirmation
  els.autoRow.classList.add('flash');
  setTimeout(() => els.autoRow.classList.remove('flash'), 400);
}

function updateRowMarker() {
  const pct = parseInt(els.rowSlider.value, 10);
  const bandCamPx = parseInt(els.bandSlider.value, 10);
  els.rowValue.textContent = `${pct}%`;
  els.bandValue.textContent = `${bandCamPx} px`;

  const r = getContentRect();
  if (!r) {
    // No video yet: fall back to wrap-relative percentage so the marker is
    // still visible at all.
    els.rowMarker.style.left = '0';
    els.rowMarker.style.width = '100%';
    els.rowMarker.style.top = `calc(${pct}% - ${bandCamPx / 2}px)`;
    els.rowMarker.style.height = `${bandCamPx}px`;
    return;
  }
  // band is measured in camera pixel rows — scale it to display pixels.
  const displayBand = Math.max(1, bandCamPx * r.scale);
  const centerY = r.top + (pct / 100) * r.height;
  // Show the marker only over the cropped column range so the user can see
  // exactly which slice of the sensor is feeding the spectrum. Use plot-space
  // crop bounds directly: the <video> is flipped via CSS when flipHorizontal
  // is on, so plot[x] visually lives at display column x regardless of flip.
  // (The cam-space range is still used for auto-row detection, which reads
  // raw image data with no CSS transform.)
  const { lo: cropLo, hi: cropHi } = getPlotCropRange();
  els.rowMarker.style.left = `${r.left + cropLo * r.scale}px`;
  els.rowMarker.style.width = `${(cropHi - cropLo) * r.scale}px`;
  els.rowMarker.style.top = `${centerY - displayBand / 2}px`;
  els.rowMarker.style.height = `${displayBand}px`;
}

// ── Calibration ──────────────────────────────────────────────────────────

// Find local maxima in `ys`, enforcing a minimum pixel spacing between accepted
// peaks. Mirrors scipy.signal.find_peaks(..., distance=N) used in lgscli's
// wavelength_auto_cal.py. Returns peaks sorted by descending intensity.
// Ordinary least squares fit y = slope·x + intercept. Returns {slope,intercept,r}.
function linearFit(xs, ys) {
  const n = xs.length;
  let sX = 0, sY = 0, sXY = 0, sXX = 0;
  for (let i = 0; i < n; i++) { sX += xs[i]; sY += ys[i]; sXY += xs[i] * ys[i]; sXX += xs[i] * xs[i]; }
  const slope = (n * sXY - sX * sY) / (n * sXX - sX * sX);
  const intercept = (sY - slope * sX) / n;
  const mX = sX / n, mY = sY / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mX) * (ys[i] - mY);
    sxx += (xs[i] - mX) ** 2;
    syy += (ys[i] - mY) ** 2;
  }
  return { slope, intercept, r: sxy / Math.sqrt(sxx * syy) };
}

// ── Visual calibration mode ──────────────────────────────────────────────

function currentCalLines() {
  return calibrationMode === 'fraunhofer' ? FRAUNHOFER_LINES : FLUO_PEAKS;
}

function initCalPeakPositions() {
  const w = offscreen.width || 1280;
  const lines = currentCalLines();
  const positions = {};
  if (calibration && Math.abs(calibration.slope) > 1e-9) {
    // Back-project all known wavelengths through the existing calibration.
    for (const line of lines) {
      positions[line.wavelength] = (line.wavelength - calibration.intercept) / calibration.slope;
    }
  } else {
    // No prior calibration — distribute evenly across the sensor so the user
    // has somewhere to start dragging from.
    const margin = w * 0.1;
    for (let i = 0; i < lines.length; i++) {
      positions[lines[i].wavelength] = margin + (w - 2 * margin) * (i / (lines.length - 1));
    }
  }
  return positions;
}

function createCalMarkers() {
  removeCalMarkers();
  if (!plot || !plot.over) return;
  const positions = initCalPeakPositions();
  const lines = currentCalLines();
  for (const line of lines) {
    // Only render markers for wavelengths the user has toggled on as anchors.
    // Non-anchors are hidden — they were sliding onto the live fit line, which
    // duplicated info the expected-spectrum overlay already shows.
    if (!calAnchorWavelengths.has(line.wavelength)) continue;
    const m = document.createElement('div');
    m.className = `cal-marker cal-marker-${calibrationMode} cal-marker-anchor`;
    m.dataset.wavelength = line.wavelength;
    m.dataset.anchor = 'true';
    m.dataset.pixel  = positions[line.wavelength];
    // Label-only HTML element. The accompanying vertical line is painted
    // directly on the uPlot canvas in drawCalMarkerLines (drawAxes hook), so
    // the spectrum's data line draws on top of it (z-order: marker behind
    // data, plot in front).
    m.innerHTML = `${line.label}<br>${line.element}`;
    plot.over.appendChild(m);
    addCalMarkerDrag(m);
  }
  refreshCalAndPositions();
}

function removeCalMarkers() {
  if (!plot || !plot.over) return;
  for (const m of plot.over.querySelectorAll('.cal-marker')) m.remove();
}

function positionCalMarkers() {
  if (!calibrationMode || !plot || !plot.over) return;
  for (const m of plot.over.querySelectorAll('.cal-marker')) {
    const pixel = parseFloat(m.dataset.pixel);
    m.style.left = `${plot.valToPos(pixel, 'x', false)}px`;
  }
}

// Find local maxima in the averaged spectrum. Skips NaN columns (cropped
// out) and clusters peaks within `minSeparation` pixels, keeping the
// brightest in each cluster — same idea as scipy.signal.find_peaks(distance=).
function findFluoPeaks(ys, minSeparation = 15, minHeight = 30) {
  const peaks = [];
  for (let i = 1; i < ys.length - 1; i++) {
    const v = ys[i];
    if (!Number.isFinite(v) || v < minHeight) continue;
    const prev = ys[i - 1], next = ys[i + 1];
    if (!Number.isFinite(prev) || !Number.isFinite(next)) continue;
    if (v >= prev && v >= next && (v > prev || v > next)) {
      peaks.push({ pixel: i, intensity: v });
    }
  }
  peaks.sort((a, b) => b.intensity - a.intensity);
  const accepted = [];
  for (const p of peaks) {
    if (accepted.every(a => Math.abs(a.pixel - p.pixel) >= minSeparation)) {
      accepted.push(p);
    }
  }
  return accepted;
}

// Best-effort auto calibration. Picks the 3 brightest detected peaks, sorts
// them by pixel, and matches them against the 3 known anchor wavelengths
// (435.8 / 546.1 / 611.6 nm) in the same order. Then projects every other
// detected peak through the fit to identify which known line it corresponds
// to (within ~12 nm tolerance). Returns null if fewer than 3 peaks found.
function autoCalibrateFluorescent() {
  if (!plotData?.avgYs) return null;
  const all = findFluoPeaks(plotData.avgYs);
  if (all.length < 3) return { fit: null, matches: [], raw: all, error: `Only ${all.length} peak(s) detected — need at least 3.` };

  const top3 = all.slice(0, 3).sort((a, b) => a.pixel - b.pixel);
  const anchorWls = FLUO_PEAKS.filter(p => p.anchor)
    .map(p => p.wavelength)
    .sort((a, b) => a - b);
  if (anchorWls.length < 3) return null;
  const fit = linearFit(top3.map(p => p.pixel), anchorWls);

  // Identify each detected peak via the fit.
  const matches = [];
  for (const p of all) {
    const wl = fit.slope * p.pixel + fit.intercept;
    let best = null, bestDist = Infinity;
    for (const fp of FLUO_PEAKS) {
      const d = Math.abs(fp.wavelength - wl);
      if (d < bestDist) { bestDist = d; best = fp; }
    }
    if (best && bestDist < 12) {
      matches.push({
        pixel: p.pixel,
        intensity: p.intensity,
        wavelength: best.wavelength,
        label: best.label,
        element: best.element,
        residual: wl - best.wavelength,
      });
    }
  }
  return { fit, matches, raw: all, error: null };
}

function runAutoCalibrationFluo() {
  calAutoFit = autoCalibrateFluorescent();
  renderCalAutoSummary();
  if (plot) plot.redraw(false);
}

function renderCalAutoSummary() {
  if (!els.calAutoSummary) return;
  if (!calAutoFit) {
    els.calAutoSummary.textContent = '';
    return;
  }
  if (calAutoFit.error) {
    els.calAutoSummary.innerHTML = `<p class="cal-auto-error">${calAutoFit.error}</p>`;
    return;
  }
  const { fit, matches } = calAutoFit;
  const rows = matches
    .slice()
    .sort((a, b) => a.pixel - b.pixel)
    .map(m => `<li><span class="auto-px">${Math.round(m.pixel)}px</span><span class="auto-wl">${m.wavelength} nm ${m.element}</span><span class="auto-int">i=${(m.intensity / 255).toFixed(2)}</span></li>`)
    .join('');
  const fitInfo = fit
    ? `<p class="cal-auto-fit">slope ${fit.slope.toFixed(4)} nm/px · intercept ${fit.intercept.toFixed(2)} nm · r ${fit.r.toFixed(5)}</p>`
    : '';
  els.calAutoSummary.innerHTML = `${fitInfo}<ul class="cal-auto-list">${rows}</ul>`;
}

// Red circles drawn on top of the spectrum line at each auto-matched peak.
// Used in the `draw` hook so they render after series (visible above data).
function drawCalAutoMatches(u) {
  if (calibrationMode !== 'fluo' || calFluoView !== 'auto') return;
  if (!calAutoFit || !calAutoFit.matches.length) return;
  const ctx = u.ctx;
  ctx.save();
  ctx.fillStyle = 'rgba(248,81,73,0.85)';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  for (const m of calAutoFit.matches) {
    const x = u.valToPos(m.pixel, 'x', true);
    const y = u.valToPos(m.intensity, 'y', true);
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// Drawn on the uPlot canvas via the drawAxes hook (before series). Only used
// for Fraunhofer cal mode now — fluo cal uses drawFluoOverlay's labeled
// dashed lines for both manual and auto views, so the styles stay consistent.
function drawCalMarkerLines(u) {
  if (calibrationMode !== 'fraunhofer' || !u.over) return;
  const ctx = u.ctx;
  const top = u.bbox.top;
  const bottom = top + u.bbox.height;
  ctx.save();
  for (const m of u.over.querySelectorAll('.cal-marker')) {
    const pixel = parseFloat(m.dataset.pixel);
    if (!Number.isFinite(pixel)) continue;
    const x = u.valToPos(pixel, 'x', true);
    const dragging = m.classList.contains('dragging');
    ctx.strokeStyle = dragging ? '#ffd166' : 'rgba(255,170,60,0.95)';
    ctx.lineWidth = (dragging ? 4 : 3);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }
  ctx.restore();
}

function addCalMarkerDrag(marker) {
  let startX, startPixel;
  let dragging = false;
  marker.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX;
    startPixel = parseFloat(marker.dataset.pixel);
    marker.setPointerCapture(e.pointerId);
    marker.classList.add('dragging');
    e.stopPropagation();
    e.preventDefault();
  });
  marker.addEventListener('pointermove', (e) => {
    if (!dragging || !plot) return;
    const startCssX = plot.valToPos(startPixel, 'x', false);
    let newCssX = startCssX + (e.clientX - startX);
    let newPixel = plot.posToVal(newCssX, 'x');
    const w = offscreen.width || 1280;
    newPixel = Math.max(0, Math.min(w - 1, newPixel));
    marker.dataset.pixel = newPixel;
    marker.style.left = `${plot.valToPos(newPixel, 'x', false)}px`;
    refreshCalAndPositions();
  });
  const end = (e) => {
    dragging = false;
    marker.classList.remove('dragging');
    try { marker.releasePointerCapture(e.pointerId); } catch {}
  };
  marker.addEventListener('pointerup', end);
  marker.addEventListener('pointercancel', end);
  marker.addEventListener('click', e => e.stopPropagation());
}

// One-shot: recompute the live fit from anchor markers, slide every non-anchor
// marker onto the resulting line, and update DOM positions.
function refreshCalAndPositions() {
  recomputeLiveCalFit();
  repositionNonAnchorsFromFit();
  positionCalMarkers();
}

// Slide non-anchor markers onto the line implied by the current fit, so they
// always read as "this is where this line should be based on your anchor
// positions" without the user fiddling with them.
function repositionNonAnchorsFromFit() {
  if (!liveCalFit || !plot || !plot.over) return;
  const { slope, intercept } = liveCalFit;
  if (Math.abs(slope) < 1e-9) return;
  for (const m of plot.over.querySelectorAll('.cal-marker')) {
    if (m.dataset.anchor === 'true') continue;
    const wl = parseFloat(m.dataset.wavelength);
    m.dataset.pixel = (wl - intercept) / slope;
  }
}

// Recompute the live linear fit from anchor markers only. Works in any cal
// mode. Drives the blackbody / fluorescent overlays during dragging so the
// reference curves respond in real time.
function recomputeLiveCalFit() {
  if (!calibrationMode || !plot || !plot.over) {
    liveCalFit = null;
    return;
  }
  const points = [];
  for (const m of plot.over.querySelectorAll('.cal-marker')) {
    if (m.dataset.anchor !== 'true') continue;
    points.push({
      pixel:      parseFloat(m.dataset.pixel),
      wavelength: parseFloat(m.dataset.wavelength),
    });
  }
  if (points.length < 2) { liveCalFit = null; return; }
  points.sort((a, b) => a.pixel - b.pixel);
  liveCalFit = linearFit(points.map(p => p.pixel), points.map(p => p.wavelength));
  if (plot) plot.redraw(false);
}

function setCalFluoView(view) {
  // view: 'auto' | 'manual'. Only meaningful in fluo cal mode.
  calFluoView = view;
  els.calViewAuto.classList.toggle('active',   view === 'auto');
  els.calViewManual.classList.toggle('active', view === 'manual');
  els.calAutoPane.classList.toggle('hidden',   view !== 'auto');
  els.calManualPane.classList.toggle('hidden', view !== 'manual');
  if (view === 'manual') {
    if (!plot.over.querySelectorAll('.cal-marker').length) createCalMarkers();
  } else {
    removeCalMarkers();
    // Drop manual fit state on entering auto. Without this, any consumer that
    // reads liveCalFit (drawFluoOverlay, etc.) would project through the last
    // manual drag and visually conflict with the auto detection.
    liveCalFit = null;
    // rebuildPlot now carries avgYs forward, so the peak finder has data
    // immediately and we can run synchronously instead of waiting for frames.
    runAutoCalibrationFluo();
  }
  if (plot) plot.redraw(false);
}

function setCalMode(mode) {
  // mode: null (off) | 'fluo' | 'fraunhofer' | 'amplitude'
  calibrationMode = mode;
  const active = !!mode;
  const isAmplitude = mode === 'amplitude';
  els.calModeControls.classList.toggle('hidden', !active);
  // Auto/Manual view toggle is fluorescent-only — Fraunhofer cal has no auto
  // path (would need its own peak-finder against absorption dips), and
  // amplitude cal has no anchor-marker workflow at all.
  els.calFluoViewToggle.classList.toggle('hidden', mode !== 'fluo');
  // Anchor-marker UI is for wavelength cal only. Hide everything that lives
  // inside the manual/auto panes when in amplitude mode.
  els.calManualPane.classList.toggle('hidden', isAmplitude);
  if (isAmplitude) els.calAutoPane.classList.add('hidden');
  els.calAmplitudePane.classList.toggle('hidden', !isAmplitude);
  // Reset auto-fit results when leaving cal mode.
  if (!active) calAutoFit = null;
  // Hide every other calibration entry point while the user is in cal mode.
  els.enterCalMode.classList.toggle('hidden', active);
  els.enterCalFraunhofer.classList.toggle('hidden', active);
  els.enterCalAmplitude.classList.toggle('hidden', active);
  if (active && !isAmplitude) {
    // Seed the anchor set from the line definitions' default flags (3 for fluo,
    // 2 for Fraunhofer). The user can then add/remove via the checkbox grid.
    calAnchorWavelengths = new Set(
      currentCalLines().filter(l => l.anchor).map(l => l.wavelength)
    );
    calShowExpectedPeaks = true;
    els.calShowPeaks.checked = true;
    if (mode === 'fraunhofer') {
      els.calModeHint.textContent =
        'Aim at clear sky. Toggle which absorption-line markers should be draggable anchors below; non-anchors slide onto the fit. Drag each enabled anchor onto its dip in the spectrum, then Apply.';
      els.calShowPeaksLabel.textContent = 'Show absorption-line markers';
    } else {
      els.calModeHint.textContent =
        'Aim at a fluorescent lamp. Toggle which peak markers should be draggable anchors below; non-anchors slide onto the fit. Drag each enabled anchor onto its peak in the spectrum, then Apply.';
      els.calShowPeaksLabel.textContent = 'Show expected peak markers';
    }
    buildCalAnchorGrid();
  }
  if (isAmplitude) {
    els.calModeHint.textContent =
      'Aim at a tungsten or halogen bulb (2600 K incandescent · 3000 K halogen). Wavelength calibration must already be set. Keep the column crop wide so the dark floor can be estimated from the deep-UV edge. Wait for the averaged spectrum to settle, then Apply.';
  }
  // Rebuild the plot so the x-axis switches between wavelength and pixel,
  // and so the suspend-during-amplitude-cal toggle takes effect immediately.
  rebuildPlot();
  if (!active) {
    removeCalMarkers();
    liveCalFit = null;
    return;
  }
  if (isAmplitude) {
    // No anchors / overlays needed — the user just frames a lamp.
    removeCalMarkers();
    return;
  }
  // Fluo cal: default to Auto view. Fraunhofer cal: only Manual is available,
  // so show markers immediately.
  if (mode === 'fluo') {
    calFluoView = 'auto';
    setCalFluoView('auto');
  } else {
    els.calAutoPane.classList.add('hidden');
    els.calManualPane.classList.remove('hidden');
    createCalMarkers();
  }
}

function buildCalAnchorGrid() {
  els.calAnchorGrid.innerHTML = '';
  if (!calibrationMode) return;
  const lines = currentCalLines();
  const isFluo = calibrationMode === 'fluo';
  for (const line of lines) {
    const lbl = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = calAnchorWavelengths.has(line.wavelength);
    cb.addEventListener('change', () => {
      if (cb.checked) calAnchorWavelengths.add(line.wavelength);
      else calAnchorWavelengths.delete(line.wavelength);
      // Re-render markers so anchor status (drag handlers + styling) updates.
      // refreshCalAndPositions runs inside createCalMarkers and reslides the
      // non-anchors onto the new fit.
      createCalMarkers();
    });
    lbl.appendChild(cb);
    const txt = document.createElement('span');
    const intensity = isFluo ? line.intensity : line.depth;
    const intensityLabel = isFluo ? 'i' : 'd';
    txt.innerHTML = `${line.label} <span class="nm-info">${line.wavelength} nm · ${intensityLabel}=${intensity.toFixed(2)}</span>`;
    lbl.appendChild(txt);
    els.calAnchorGrid.appendChild(lbl);
  }
}

function applyCalMode() {
  if (calibrationMode === 'amplitude') return applyAmplitudeCalibration();
  let fit, points, method;
  if (calibrationMode === 'fluo' && calFluoView === 'auto') {
    if (!calAutoFit || !calAutoFit.fit) {
      alert('Auto-detect failed — switch to Manual or click Re-detect peaks first.');
      return;
    }
    fit = calAutoFit.fit;
    points = calAutoFit.matches.map(m => ({ pixel: m.pixel, wavelength: m.wavelength, intensity: m.intensity }));
    method = 'auto-fluo';
  } else {
    const markers = plot.over.querySelectorAll('.cal-marker');
    points = [];
    for (const m of markers) {
      // Non-anchor markers are derived from the fit through the anchors, so
      // including them in the final regression is redundant and would only add
      // numerical noise. Anchors are the only user-set positions.
      if (m.dataset.anchor !== 'true') continue;
      points.push({
        pixel: parseFloat(m.dataset.pixel),
        wavelength: parseFloat(m.dataset.wavelength),
        intensity: null,
      });
    }
    if (points.length < 2) {
      alert('Need at least 2 anchors to compute a calibration. Toggle more peaks on in the panel.');
      return;
    }
    points.sort((a, b) => a.pixel - b.pixel);
    fit = linearFit(points.map(p => p.pixel), points.map(p => p.wavelength));
    method = calibrationMode === 'fraunhofer' ? 'visual-drag-fraunhofer' : 'visual-drag-fluo';
  }

  if (Math.abs(fit.r) < 0.999) {
    if (!confirm(`Correlation coefficient r = ${fit.r.toFixed(5)} (target ≥ 0.9999). Apply anyway?`)) return;
  }

  calibration = {
    slope: fit.slope,
    intercept: fit.intercept,
    r: fit.r,
    peaks: points,
    timestamp: Date.now(),
    method,
    sensorWidth: offscreen.width,
  };
  localStorage.setItem('calibration', JSON.stringify(calibration));
  updateCalibrationUI();
  setCalMode(null);
}

function clearCalibration() {
  if (!confirm('Clear current wavelength calibration?')) return;
  calibration = null;
  localStorage.removeItem('calibration');
  updateCalibrationUI();
  rebuildPlot();
}

// Planck's law spectral radiance: W·sr⁻¹·m⁻³ at wavelength λ (in nm), T in K.
// Absolute units don't matter for our use — we normalize to peak=1 anyway.
function planckRadiance(lambdaNm, T) {
  const l = lambdaNm * 1e-9;
  const c = 299792458, h = 6.62607015e-34, k = 1.380649e-23;
  const denom = Math.expm1((h * c) / (l * k * T));
  return (2 * h * c * c) / (l ** 5 * denom);
}

// Inverse of the sRGB EOTF (IEC 61966-2-1:1999), with input/output in
// our [0, 255] range. Lifted from lgscli's specap.cpp:767–787 — Lao Kang
// found empirically that this curve maps the Sonix camera's gamma-encoded
// output back to scene-linear light better than any plain power function.
// Useful when amplitude-correcting (the factor only makes physical sense
// against linear signal) and as a side-benefit makes the dark floor
// near-zero, since the OETF squashes the bottom of the gamma curve hard.
const SRGB_LIN_BREAK = 0.0392857119;
const SRGB_LIN_SLOPE = 0.0773801506;
function srgbInverseEotf01(x) {
  return x >= SRGB_LIN_BREAK
    ? Math.pow((x + 0.055) / 1.055, 2.4)
    : x * SRGB_LIN_SLOPE;
}
function applySensorLinearization(arr, w) {
  for (let i = 0; i < w; i++) {
    const v = arr[i];
    if (Number.isFinite(v)) arr[i] = srgbInverseEotf01(v / 255) * 255;
  }
}

// Subtract the stored dark floor and multiply each pixel by the saved scale
// factor, in place. Width-checked so a stale correction from a different
// camera/resolution is silently ignored rather than corrupting the spectrum.
// Without dark subtraction the camera's sensor offset (~5–15 counts even with
// no light) gets amplified by the per-pixel factor and produces a spurious
// inverse-of-lamp baseline; subtracting the dark floor pins zero-light to
// zero-output where it belongs.
function applyAmplitudeCorrection(arr, w) {
  if (!amplitudeCalibration || amplitudeCalibration.sensorWidth !== w) return;
  const f = amplitudeCalibration.factors;
  const dark = amplitudeCalibration.dark || 0;
  for (let x = 0; x < w; x++) {
    const v = arr[x];
    if (Number.isFinite(v)) {
      const corrected = (v - dark) * f[x];
      arr[x] = corrected > 0 ? corrected : 0;
    }
  }
}

// True when corrections should run during sampling. Suspended during amplitude
// cal mode itself so the lamp reference is captured raw, and gated by the
// user-facing on/off toggle so the calibration can be temporarily bypassed
// without being cleared.
function amplitudeCorrectionActive() {
  return !!amplitudeCalibration && amplitudeEnabled && calibrationMode !== 'amplitude';
}

function applyAmplitudeCalibration() {
  if (!calibration) {
    alert('Wavelength calibration is required first — amplitude correction needs to know what wavelength each pixel sees. Calibrate against fluorescent peaks or Fraunhofer lines, then come back.');
    return;
  }
  const w = offscreen.width;
  if (!w) { alert('Camera not running — start capture first.'); return; }
  if (calibration.sensorWidth && calibration.sensorWidth !== w) {
    alert(`Wavelength calibration is for sensor width ${calibration.sensorWidth}, but current is ${w}. Recalibrate wavelength first.`);
    return;
  }
  const T = parseFloat(els.calAmpTemperature.value);
  if (!Number.isFinite(T) || T < 1000 || T > 10000) {
    alert('Lamp temperature must be between 1000 and 10000 K.');
    return;
  }

  // Average raw frames ourselves rather than reading plotData.avgYs — that
  // array has NaN at cropped pixels, which would hide the true dark floor if
  // the user is calibrating with a column crop active. Skip rgb mode (the
  // frame buffer shape differs and amp correction is meant for mono spectra).
  if (plotData?.mode === 'rgb') {
    alert('Amplitude calibration needs mono mode — uncheck "Show R/G/B channels separately" first.');
    return;
  }
  const n = frameRaws.length;
  if (n === 0) {
    alert('Wait for at least one frame to be captured before applying.');
    return;
  }
  const measured = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let f = 0; f < n; f++) s += frameRaws[f][x];
    measured[x] = s / n;
  }
  // Apply the same linearization the runtime path uses — the factor must be
  // computed against the same domain it'll be applied to, or runtime
  // linearization + a non-linearized factor compose into nonsense.
  if (linearizeSensor) applySensorLinearization(measured, w);

  // Estimate the sensor's dark floor from the minimum of the full uncropped
  // spectrum. Tungsten / halogen output is effectively zero at the deep-UV
  // edge of this sensor's range (≤380 nm), so the minimum sits at the sensor
  // offset rather than at a real signal level. Storing it here lets
  // applyAmplitudeCorrection subtract it at runtime — without that, the
  // residual ~5–15-count dark gets multiplied by the per-pixel factor and
  // produces a spurious inverse-of-lamp baseline whenever the signal is zero.
  let dark = Infinity;
  for (let p = 0; p < w; p++) {
    const v = measured[p];
    if (Number.isFinite(v) && v < dark) dark = v;
  }
  if (!Number.isFinite(dark)) dark = 0;
  dark = Math.max(0, dark);

  // Theoretical Planck radiance at each pixel's calibrated wavelength.
  const planck = new Float64Array(w);
  for (let p = 0; p < w; p++) {
    const lam = calibration.slope * p + calibration.intercept;
    planck[p] = (lam > 0) ? planckRadiance(lam, T) : 0;
  }

  // Subtract dark from the measured spectrum so factors map true signal →
  // blackbody, not (signal + dark) → blackbody. Then normalize both to peak=1.
  const trueSignal = new Float64Array(w);
  let measMax = 0, planMax = 0;
  for (let p = 0; p < w; p++) {
    if (!Number.isFinite(measured[p])) { trueSignal[p] = NaN; continue; }
    const s = Math.max(0, measured[p] - dark);
    trueSignal[p] = s;
    if (s > measMax) measMax = s;
    if (planck[p] > planMax) planMax = planck[p];
  }
  if (measMax < 1e-6 || planMax < 1e-9) {
    alert('Reference signal too faint to compute correction. Increase exposure or aim closer to the lamp.');
    return;
  }

  // Per-pixel correction = normalized blackbody / normalized (signal - dark).
  // Where the dark-subtracted signal is too small, leave it alone (factor 1)
  // so we don't blow up noise. lgscli's correction_cal.py is similarly noisy
  // in the blue end where tungsten output is weakest.
  const factors = new Float64Array(w);
  const NOISE_FLOOR = 0.02; // 2% of peak — below this, signal is mostly noise.
  for (let p = 0; p < w; p++) {
    const m = trueSignal[p] / measMax;
    const b = planck[p] / planMax;
    factors[p] = (Number.isFinite(m) && m >= NOISE_FLOOR) ? (b / m) : 1.0;
  }

  // Pick a default name from the temperature + active wavelength-cal slope so
  // the user can tell two cals apart at a glance even if they don't rename.
  const ts = Date.now();
  const userName = (els.calAmpName?.value || '').trim();
  const defaultName = `${T} K · ${new Date(ts).toLocaleString()}`;
  const newCal = {
    id: `cal-${ts}-${Math.random().toString(36).slice(2, 8)}`,
    name: userName || defaultName,
    temperature: T,
    sensorWidth: w,
    timestamp: ts,
    dark,
    factors,
    linearized: !!linearizeSensor,
  };
  amplitudeCalibrations.push(newCal);
  amplitudeCalibration = newCal;
  activeAmplitudeCalibrationId = newCal.id;
  persistAmplitudeCalibrations();
  localStorage.setItem('amplitudeCalTemp', String(T));
  if (els.calAmpName) els.calAmpName.value = '';
  updateCalibrationUI();
  setCalMode(null);
}

function clearAmplitudeCalibration() {
  // "Clear" now deletes the active calibration from the library entirely.
  // Switching away without deleting is done via the active-cal dropdown.
  if (!amplitudeCalibration) return;
  if (!confirm(`Delete amplitude calibration "${amplitudeCalibration.name}"?`)) return;
  const id = amplitudeCalibration.id;
  amplitudeCalibrations = amplitudeCalibrations.filter(c => c.id !== id);
  amplitudeCalibration = null;
  activeAmplitudeCalibrationId = null;
  persistAmplitudeCalibrations();
  updateCalibrationUI();
}

function updateCalibrationUI() {
  const s = els.calibrationStatus;
  if (calibration) {
    const date = new Date(calibration.timestamp);
    const rOk = Math.abs(calibration.r) >= 0.999;
    s.className = `cal-status ${rOk ? 'ok' : 'warn'}`;
    s.innerHTML = `
      Calibrated · λ = ${calibration.slope.toFixed(4)}·px + ${calibration.intercept.toFixed(2)}<br>
      r = ${calibration.r.toFixed(5)}${rOk ? '' : ' (low!)'} · ${date.toLocaleString()}<br>
      Peaks: ${calibration.peaks.map(p => `${p.wavelength}@${p.pixel}`).join(', ')}
    `;
    els.resetCalibration.hidden = false;
  } else {
    s.className = 'cal-status';
    s.textContent = 'Not calibrated · pixel axis';
    els.resetCalibration.hidden = true;
  }
  // Overlay toggles (peaks / blackbody / Fraunhofer / curve scales) only make
  // sense once the x-axis is in nm. Hide them in pixel-axis mode so the user
  // isn't tempted to flip them on while looking at uncalibrated data.
  if (els.overlayToggles) els.overlayToggles.classList.toggle('hidden', !calibration);

  // Populate the active-cal dropdown. Always shows "None" plus every saved cal.
  if (els.amplitudeCalSelect) {
    const sel = els.amplitudeCalSelect;
    // Rebuild options from scratch — list size is small, simpler than diffing.
    sel.innerHTML = '';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = 'None (no correction)';
    sel.appendChild(noneOpt);
    for (const c of amplitudeCalibrations) {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      sel.appendChild(o);
    }
    sel.value = activeAmplitudeCalibrationId || '';
    // Hide the dropdown row entirely until there's at least one cal to switch to.
    els.amplitudeCalSelectRow.hidden = amplitudeCalibrations.length === 0;
  }

  const a = els.amplitudeStatus;
  if (amplitudeCalibration) {
    const date = new Date(amplitudeCalibration.timestamp);
    const hasDark = Number.isFinite(amplitudeCalibration.dark);
    const calLinearized = !!amplitudeCalibration.linearized;
    const linMismatch = calLinearized !== !!linearizeSensor;
    const darkStr = hasDark
      ? `dark = ${amplitudeCalibration.dark.toFixed(1)}`
      : 'dark not set — re-apply to fix zero baseline';
    const linStr = calLinearized ? 'linearized' : 'raw';
    const enabledStr = amplitudeEnabled ? 'applied' : 'BYPASSED';
    const warn = !hasDark || linMismatch;
    a.className = `cal-status ${!amplitudeEnabled ? 'warn' : warn ? 'warn' : 'ok'}`;
    let html = `<strong>${escapeHtml(amplitudeCalibration.name)}</strong> · ${enabledStr}<br>T = ${amplitudeCalibration.temperature} K · ${linStr} · ${darkStr}<br>${date.toLocaleString()} · ${amplitudeCalibration.sensorWidth} px`;
    if (linMismatch) html += `<br><strong>Mismatch:</strong> cal was ${linStr}, linearization toggle is now ${linearizeSensor ? 'on' : 'off'} — re-apply.`;
    a.innerHTML = html;
    els.resetAmplitude.hidden = false;
    els.amplitudeEnabledRow.hidden = false;
    els.amplitudeEnabled.checked = amplitudeEnabled;
  } else if (amplitudeCalibrations.length > 0) {
    a.className = 'cal-status';
    a.textContent = `No active amplitude correction (${amplitudeCalibrations.length} saved — pick one above)`;
    els.resetAmplitude.hidden = true;
    els.amplitudeEnabledRow.hidden = true;
  } else {
    a.className = 'cal-status';
    a.textContent = 'No amplitude correction';
    els.resetAmplitude.hidden = true;
    els.amplitudeEnabledRow.hidden = true;
  }
}

// ── Camera controls (server-enhanced mode) ───────────────────────────────

function buildControlRow(info) {
  const row = document.createElement('div');
  row.className = `control-row control-${info.kind || 'range'}`;
  const value = info.value ?? info.default ?? info.min ?? 0;

  if (info.kind === 'select' && info.options) {
    const opts = info.options.map(o =>
      `<option value="${o.value}"${o.value === value ? ' selected' : ''}>${o.label}</option>`
    ).join('');
    row.innerHTML = `
      <label>
        <span class="name">${info.label}</span>
      </label>
      <select data-name="${info.name}">${opts}</select>
      ${info.desc ? `<div class="desc">${info.desc}</div>` : ''}
    `;
    const sel = row.querySelector('select');
    sel.addEventListener('change', async () => {
      await api.setControl(info.name, parseInt(sel.value, 10));
      // Some modes affect other controls (e.g. Manual unlocks Exposure) —
      // refresh everyone's current values.
      refreshControlValues();
    });
  } else if (info.kind === 'toggle' && info.options) {
    const checked = value !== 0 ? 'checked' : '';
    row.innerHTML = `
      <label class="toggle-row">
        <span class="name">${info.label}</span>
        <input type="checkbox" data-name="${info.name}" ${checked} />
      </label>
      ${info.desc ? `<div class="desc">${info.desc}</div>` : ''}
    `;
    const cb = row.querySelector('input');
    cb.addEventListener('change', async () => {
      await api.setControl(info.name, cb.checked ? 1 : 0);
      refreshControlValues();
    });
  } else {
    const min = info.min ?? 0;
    const max = info.max ?? 100;
    row.innerHTML = `
      <label>
        <span class="name">${info.label}</span>
        <input type="number" class="value-input" data-name="${info.name}"
               min="${min}" max="${max}" step="1" value="${value}" />
      </label>
      <input type="range" min="${min}" max="${max}" step="1"
             value="${value}" data-name="${info.name}" />
      ${info.desc ? `<div class="desc">${info.desc}</div>` : ''}
    `;
    const slider = row.querySelector('input[type=range]');
    const num    = row.querySelector('input[type=number]');

    const apply = async (rawVal) => {
      let v = parseInt(rawVal, 10);
      if (isNaN(v)) return;
      v = Math.max(min, Math.min(max, v));
      const result = await api.setControl(info.name, v);
      const applied = result?.value ?? v;
      // Sync every widget bound to this control name (simple and advanced
      // views both have an exposure row, etc.) so they don't drift apart.
      syncControl(info.name, applied);
    };

    slider.addEventListener('input',  () => syncControl(info.name, slider.value));
    slider.addEventListener('change', () => apply(slider.value));
    num.addEventListener('input',     () => syncControl(info.name, num.value));
    num.addEventListener('change',    () => apply(num.value));
    // Arrow keys on the number input give ±1 (native behaviour). Holding
    // shift gives ±10, alt+arrow gives ±0.1 (clamped to step=1 → no-op).
  }
  return row;
}

function addExposureStepButtons(row, info) {
  if (info.name !== 'exposure') return;
  const min = info.min ?? 0;
  const max = info.max ?? 100;
  const wrap = document.createElement('div');
  wrap.className = 'exposure-step-buttons';
  wrap.innerHTML = `
    <button type="button" class="exposure-step-btn" data-delta="-256">-256</button>
    <button type="button" class="exposure-step-btn" data-delta="256">+256</button>
  `;
  const desc = row.querySelector('.desc');
  row.insertBefore(wrap, desc ?? null);

  wrap.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const num = row.querySelector('input[type=number]');
      const current = parseInt(num?.value ?? '', 10);
      const base = Number.isFinite(current) ? current : (info.value ?? min);
      const delta = parseInt(btn.dataset.delta, 10);
      const next = Math.max(min, Math.min(max, base + delta));
      syncControl(info.name, next);
      const result = await api.setControl(info.name, next);
      syncControl(info.name, result?.value ?? next);
    });
  });
}

function highNibbleGainSortKey(high4) {
  return (high4 & 0b1000)
    | ((high4 & 0b0001) << 2)
    | (high4 & 0b0010)
    | ((high4 & 0b0100) >> 2);
}

function lowByteToGainRank(lowByte) {
  const high4 = (lowByte >> 4) & 0x0f;
  const low4 = lowByte & 0x0f;
  return (highNibbleGainSortKey(high4) << 4) | low4;
}

function gainRankToLowByte(rank) {
  const high4Key = (rank >> 4) & 0x0f;
  const low4 = rank & 0x0f;
  return (highNibbleGainSortKey(high4Key) << 4) | low4;
}

let simpleExposureControl = null;
let simpleGainControl = null;

function setupSplitExposureRow(row, exposure) {
  const min = exposure.min ?? 0;
  const max = exposure.max ?? 2047;
  const coarseMax = Math.max(0, Math.floor(max / 256) * 256);
  row.innerHTML = `
    <label class="exposure-split-label">
      <span class="name">Exposure</span>
      <span class="exposure-split-value">0</span>
    </label>
    <input type="range" class="exposure-split-slider" min="0" max="${coarseMax}" step="256" value="0" />
    <div class="exposure-step-buttons">
      <button type="button" class="exposure-step-btn" data-delta="-256">-256</button>
      <button type="button" class="exposure-step-btn" data-delta="256">+256</button>
    </div>
    <label class="exposure-gain-label">
      <span class="name">Gain</span>
      <span class="exposure-gain-value">0</span>
    </label>
    <input type="range" class="exposure-gain-slider" min="0" max="255" step="1" value="0" />
    ${exposure.desc ? `<div class="desc">${exposure.desc}</div>` : ''}
  `;

  const exposureSlider = row.querySelector('.exposure-split-slider');
  const exposureValue = row.querySelector('.exposure-split-value');
  const gainSlider = row.querySelector('.exposure-gain-slider');
  const gainValue = row.querySelector('.exposure-gain-value');
  simpleExposureControl = { slider: exposureSlider, value: exposureValue, min, max };
  simpleGainControl = { slider: gainSlider, value: gainValue, min, max };

  const currentExposureValue = () => {
    const inputs = els.controlsPane.querySelectorAll(`input[type=number][data-name="${exposure.name}"]`);
    for (const input of inputs) {
      const parsed = parseInt(input.value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    return exposure.value ?? min;
  };
  const clampExposure = (v) => Math.max(min, Math.min(max, v));

  exposureSlider.addEventListener('input', () => {
    const current = currentExposureValue();
    const next = clampExposure(parseInt(exposureSlider.value, 10) + (current & 0xff));
    syncControl(exposure.name, next);
  });
  exposureSlider.addEventListener('change', async () => {
    const current = currentExposureValue();
    const next = clampExposure(parseInt(exposureSlider.value, 10) + (current & 0xff));
    const result = await api.setControl(exposure.name, next);
    syncControl(exposure.name, result?.value ?? next);
  });
  row.querySelectorAll('.exposure-step-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const current = currentExposureValue();
      const coarse = Math.floor(current / 256) * 256;
      const delta = parseInt(btn.dataset.delta, 10);
      const next = clampExposure(Math.max(0, Math.min(coarseMax, coarse + delta)) + (current & 0xff));
      syncControl(exposure.name, next);
      const result = await api.setControl(exposure.name, next);
      syncControl(exposure.name, result?.value ?? next);
    });
  });

  gainSlider.addEventListener('input', () => {
    const current = currentExposureValue();
    const coarse = Math.floor(current / 256) * 256;
    const next = clampExposure(coarse + gainRankToLowByte(parseInt(gainSlider.value, 10)));
    syncControl(exposure.name, next);
  });
  gainSlider.addEventListener('change', async () => {
    const current = currentExposureValue();
    const coarse = Math.floor(current / 256) * 256;
    const next = clampExposure(coarse + gainRankToLowByte(parseInt(gainSlider.value, 10)));
    const result = await api.setControl(exposure.name, next);
    syncControl(exposure.name, result?.value ?? next);
  });
}

async function loadControls() {
  const ctrls = await api.controls();
  if (!ctrls) return false;

  const ORDER = ['ae_mode', 'exposure', 'ae_priority', 'wb_auto', 'wb_temp',
    'brightness', 'contrast', 'saturation', 'sharpness',
    'gamma', 'backlight', 'hue', 'power_line'];
  ctrls.sort((a, b) => {
    const ia = ORDER.indexOf(a.name), ib = ORDER.indexOf(b.name);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });

  // Advanced view: every control as a slider/select/toggle.
  els.controlsList.innerHTML = '';
  simpleExposureControl = null;
  simpleGainControl = null;
  for (const c of ctrls) {
    const row = buildControlRow(c);
    addExposureStepButtons(row, c);
    els.controlsList.appendChild(row);
  }

  // Simple view: only the exposure slider, shown when AE mode is manual.
  // Same data-name as the advanced one, so refreshControlValues syncs both.
  els.simpleExposureSlot.innerHTML = '';
  const exposure = ctrls.find(c => c.name === 'exposure');
  if (exposure) {
    const row = document.createElement('div');
    row.className = 'control-row control-range';
    els.simpleExposureSlot.appendChild(row);
    setupSplitExposureRow(row, exposure);
  }

  applyControlGating(ctrls);
  return true;
}

async function refreshControlValues() {
  const ctrls = await api.controls();
  if (!ctrls) return;
  for (const c of ctrls) {
    if (c.value == null) continue;
    syncControl(c.name, c.value);
  }
  applyControlGating(ctrls);
}

// Update every DOM widget bound to a control name (both simple and advanced
// views may have the same data-name, e.g. exposure).
function syncControl(name, value) {
  const root = els.controlsPane;
  root.querySelectorAll(`select[data-name="${name}"]`).forEach(s => s.value = String(value));
  root.querySelectorAll(`input[type=checkbox][data-name="${name}"]`).forEach(t => t.checked = value !== 0);
  root.querySelectorAll(`input[type=range][data-name="${name}"]`).forEach(s => s.value = value);
  root.querySelectorAll(`input[type=number][data-name="${name}"]`).forEach(d => d.value = value);
  root.querySelectorAll(`.value[data-name="${name}"]`).forEach(d => d.textContent = value);
  if (name === 'exposure') {
    const v = parseInt(value, 10);
    if (Number.isFinite(v)) {
      if (simpleExposureControl) {
        const coarse = Math.floor(v / 256) * 256;
        simpleExposureControl.slider.value = String(coarse);
        simpleExposureControl.value.textContent = String(coarse);
      }
      if (simpleGainControl) {
        const lowByte = ((v % 256) + 256) % 256;
        const rank = lowByteToGainRank(lowByte);
        simpleGainControl.slider.value = String(rank);
        simpleGainControl.value.textContent = String(lowByte);
        simpleGainControl.value.title = `rank ${rank}`;
      }
    }
  }
}

// Disable controls that the camera will silently ignore in the current state.
// Exposure Time is only honoured when AE mode = Manual(1) or Shutter Priority(4)
// — in Auto(2)/Aperture Priority(8) the camera runs its own AE loop and writes
// to the exposure register get overwritten on every frame.
// Same idea for white balance temperature when WB Auto is on.
function applyControlGating(ctrls) {
  const byName = Object.fromEntries(ctrls.map(c => [c.name, c.value]));
  const aeMode = byName.ae_mode;
  const wbAuto = byName.wb_auto;

  // Advanced view is intentionally unrestricted — every control is freely
  // editable. (Exposure writes are silently ignored when AE Mode = Auto/
  // Aperture Priority, but that's a deliberate trade-off for the "expert"
  // view; the simple view handles the gating cleanly via show/hide.)
  setRowEnabled('wb_temp', wbAuto === 0,
    'Turn off White Balance Auto to set temperature manually.');

  // Simple view: highlight the active mode button and show/hide exposure.
  const isManual = aeMode === 1 || aeMode === 4;
  const isAuto   = aeMode === 2 || aeMode === 8;
  els.modeManual.classList.toggle('active', isManual);
  els.modeAuto.classList.toggle('active', isAuto);
  els.simpleExposureSlot.classList.toggle('hidden', !isManual);
}

function setRowEnabled(name, enabled, hint) {
  const slider = els.controlsList.querySelector(`input[type=range][data-name="${name}"]`);
  if (!slider) return;
  const row = slider.closest('.control-row');
  slider.disabled = !enabled;
  row.classList.toggle('control-disabled', !enabled);
  row.title = enabled ? '' : hint;
}

// ── Initialisation ────────────────────────────────────────────────────────

function setStandaloneMode(reason) {
  els.statusServer.className = 'badge badge-warn';
  els.statusServer.textContent = 'standalone';
  els.statusServer.title = reason;
  els.cameraControlsSection.classList.add('hidden');
  els.banner.classList.add('hidden');
}

function setServerMode() {
  els.statusServer.className = 'badge badge-ok';
  els.statusServer.textContent = 'server connected';
  els.statusServer.removeAttribute('title');
  els.cameraControlsSection.classList.remove('hidden');
  els.banner.classList.add('hidden');
  els.modeManual.disabled = false;
  els.modeAuto.disabled = false;
  els.resetDefaults.disabled = false;
  els.spectrometerPreset.disabled = false;
  els.viewSimple.disabled = false;
  els.viewAdvanced.disabled = false;
  els.controlsHint.textContent = 'Switch to Advanced for raw UVC controls. Reset restores firmware defaults.';
}

// State machine driven by periodic /api/health polls. Tracks server reachability
// and the UVC camera's USB plug state independently so the banner only updates
// on real edges (plug/unplug or server up/down) — not on every poll tick.
function startHealthPolling(initialHealth) {
  let serverUp = !!(initialHealth && initialHealth.ok);
  let cameraUp = !!(initialHealth && initialHealth.camera);

  async function tick() {
    const h = await api.health();
    const nowServerUp = !!(h && h.ok);
    const nowCameraUp = nowServerUp && !!h.camera;

    if (nowServerUp !== serverUp) {
      serverUp = nowServerUp;
      if (nowServerUp) {
        // Server came back — re-fetch controls so values reflect any state
        // change while we were disconnected.
        if (await loadControls()) setServerMode();
      } else {
        els.statusServer.className = 'badge badge-warn';
        els.statusServer.textContent = 'server lost';
        els.banner.classList.remove('hidden');
        els.banner.textContent = 'Lost connection to local server — will reconnect when it returns.';
      }
    }

    if (nowCameraUp !== cameraUp) {
      cameraUp = nowCameraUp;
      if (!serverUp) {
        // Don't touch banner when server is down — the "server lost" message
        // takes precedence.
      } else if (nowCameraUp) {
        els.banner.classList.add('hidden');
        // Camera reattached — refresh controls so live values match the
        // (possibly factory-reset) device state.
        loadControls().catch(() => {});
      } else {
        els.banner.classList.remove('hidden');
        els.banner.textContent = `Camera disconnected${h && h.error ? ` (${h.error})` : ''} — replug the USB cable.`;
      }
    }
  }

  setInterval(tick, 2000);
}

function setView(view) {
  els.viewSimple.classList.toggle('active',   view === 'simple');
  els.viewAdvanced.classList.toggle('active', view === 'advanced');
  els.simpleView.classList.toggle('hidden',   view !== 'simple');
  els.advancedView.classList.toggle('hidden', view !== 'advanced');
}

async function init() {
  // Wire up UI

  // Theme toggle. Button text reads the *opposite* of the current theme — it
  // describes the action, not the state. Clicking it flips the data-theme
  // attribute (CSS picks up new colors instantly), persists, and rebuilds the
  // plot so the canvas-side colors (axis stroke, grid, averaged trace) refresh.
  function syncThemeButton() {
    els.themeToggle.textContent = theme === 'light' ? 'Dark' : 'Light';
  }
  syncThemeButton();
  els.themeToggle.addEventListener('click', () => {
    theme = theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    syncThemeButton();
    if (plot) rebuildPlot();
  });

  setupRangeClickToJump();
  els.rowSlider.addEventListener('input', updateRowMarker);
  els.bandSlider.addEventListener('input', updateRowMarker);
  els.autoRow.addEventListener('click', autoDetectRow);
  setupDraggableVideo();

  // Keep both overlays (white frame + row marker) snapped to the rendered
  // video on every size change (drag-resize of the mini pane, window resize,
  // mini toggle, etc.)
  new ResizeObserver(updateOverlays).observe(els.videoWrap);
  window.addEventListener('resize', updateOverlays);
  els.deviceSelect.addEventListener('change', () => startCamera(els.deviceSelect.value));
  els.captureStart.addEventListener('click', () => startCamera(els.deviceSelect.value));
  els.captureStop.addEventListener('click', stopCamera);
  // Spacebar toggles capture, except while typing in an input/textarea so it
  // doesn't hijack the save-name field or any future text entry.
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' && e.key !== ' ') return;
    const ae = document.activeElement;
    const tag = ae?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae?.isContentEditable) return;
    e.preventDefault();
    if (videoReady) stopCamera();
    else startCamera(els.deviceSelect.value);
  });
  els.modeManual.addEventListener('click', async () => { await api.setMode('manual'); refreshControlValues(); });
  els.modeAuto.addEventListener('click',   async () => { await api.setMode('auto');   refreshControlValues(); });
  els.viewSimple.addEventListener('click',   () => setView('simple'));
  els.viewAdvanced.addEventListener('click', () => setView('advanced'));
  els.resetDefaults.addEventListener('click', async () => {
    els.resetDefaults.disabled = true;
    try { await api.reset(); await refreshControlValues(); }
    finally { els.resetDefaults.disabled = false; }
  });
  els.spectrometerPreset.addEventListener('click', async () => {
    // Defaults from lgscli's specap.cpp (the C++ CLI for the same hardware):
    // manual AE + WB off so exposure is reproducible, contrast 20 (vs 32
    // factory) for headroom on bright peaks, sharpness 1 to suppress edge
    // enhancement that would smear sharp emission lines. Exposure 200 (20 ms)
    // is lgscli's reference for fluorescent lamps; the camera quantises to
    // the nearest 32-tick block.
    els.spectrometerPreset.disabled = true;
    try {
      await api.setMode('manual');
      await api.setControl('wb_auto', 0);
      await api.setControl('contrast', 20);
      await api.setControl('sharpness', 1);
      await api.setControl('exposure', 200);
      await refreshControlValues();
    } finally { els.spectrometerPreset.disabled = false; }
  });
  els.resetCalibration.addEventListener('click', clearCalibration);
  els.resetAmplitude.addEventListener('click', clearAmplitudeCalibration);
  els.amplitudeEnabled.addEventListener('change', () => {
    amplitudeEnabled = els.amplitudeEnabled.checked;
    localStorage.setItem('amplitudeEnabled', amplitudeEnabled ? '1' : '0');
    updateCalibrationUI();
  });
  els.amplitudeCalSelect.addEventListener('change', () => {
    setActiveAmplitudeCalibration(els.amplitudeCalSelect.value || null);
  });
  els.enterCalMode.addEventListener('click',       () => setCalMode('fluo'));
  els.enterCalFraunhofer.addEventListener('click', () => setCalMode('fraunhofer'));
  els.enterCalAmplitude.addEventListener('click',  () => setCalMode('amplitude'));
  // Restore last-used temperature so the user doesn't have to retype it.
  const savedAmpT = parseFloat(localStorage.getItem('amplitudeCalTemp'));
  if (Number.isFinite(savedAmpT) && savedAmpT >= 1000 && savedAmpT <= 10000) {
    els.calAmpTemperature.value = String(savedAmpT);
  }
  els.calAmpTemperature.addEventListener('change', () => {
    const v = parseFloat(els.calAmpTemperature.value);
    if (Number.isFinite(v) && v >= 1000 && v <= 10000) {
      localStorage.setItem('amplitudeCalTemp', String(v));
    }
  });
  els.applyCalMode.addEventListener('click',       applyCalMode);
  els.cancelCalMode.addEventListener('click',      () => setCalMode(null));
  els.calViewAuto.addEventListener('click',        () => setCalFluoView('auto'));
  els.calViewManual.addEventListener('click',      () => setCalFluoView('manual'));
  els.calAutoRerun.addEventListener('click',       runAutoCalibrationFluo);
  els.calShowPeaks.addEventListener('change', () => {
    calShowExpectedPeaks = els.calShowPeaks.checked;
    if (plot) plot.redraw(false);
  });
  els.showFluoOverlay.checked = showFluoOverlay;
  els.showFluoOverlay.addEventListener('change', () => {
    showFluoOverlay = els.showFluoOverlay.checked;
    localStorage.setItem('showFluoOverlay', showFluoOverlay ? '1' : '0');
    if (plot) plot.redraw(false);
  });
  els.showFraunhofer.checked = showFraunhofer;
  els.showFraunhofer.addEventListener('change', () => {
    showFraunhofer = els.showFraunhofer.checked;
    localStorage.setItem('showFraunhofer', showFraunhofer ? '1' : '0');
    if (plot) plot.redraw(false);
  });
  els.showBlackbody.checked = showBlackbody;
  els.blackbodyTemp.value   = String(blackbodyTemp);
  els.showBlackbody.addEventListener('change', () => {
    showBlackbody = els.showBlackbody.checked;
    localStorage.setItem('showBlackbody', showBlackbody ? '1' : '0');
    if (plot) plot.redraw(false);
  });
  els.blackbodyTemp.addEventListener('input', () => {
    const v = parseFloat(els.blackbodyTemp.value);
    if (!Number.isFinite(v) || v < 1000 || v > 10000) return;
    blackbodyTemp = v;
    localStorage.setItem('blackbodyTemp', String(v));
    syncBlackbodyPresets();
    if (showBlackbody && plot) plot.redraw(false);
  });
  // Highlight whichever preset matches the current temperature, so the user
  // can tell at a glance which one is active. No-op if the value doesn't
  // exactly match any preset (e.g. user typed a custom number).
  function syncBlackbodyPresets() {
    document.querySelectorAll('.bb-preset-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.temp, 10) === blackbodyTemp);
    });
  }
  // One delegated handler covers all three preset buttons.
  document.querySelector('.blackbody-presets')?.addEventListener('click', e => {
    const btn = e.target.closest('.bb-preset-btn');
    if (!btn) return;
    const t = parseInt(btn.dataset.temp, 10);
    if (!Number.isFinite(t)) return;
    blackbodyTemp = t;
    els.blackbodyTemp.value = String(t);
    localStorage.setItem('blackbodyTemp', String(t));
    // Clicking a preset implies "show me this curve" — auto-enable the
    // overlay so the click has a visible effect even from the off state.
    if (!showBlackbody) {
      showBlackbody = true;
      els.showBlackbody.checked = true;
      localStorage.setItem('showBlackbody', '1');
    }
    syncBlackbodyPresets();
    if (plot) plot.redraw(false);
  });
  syncBlackbodyPresets();
  els.blackbodyFitMeasured.checked = blackbodyFitMeasured;
  els.blackbodyFitMeasured.addEventListener('change', () => {
    blackbodyFitMeasured = els.blackbodyFitMeasured.checked;
    localStorage.setItem('blackbodyFitMeasured', blackbodyFitMeasured ? '1' : '0');
    if (showBlackbody && plot) plot.redraw(false);
  });
  els.saveSpectrum.addEventListener('click', saveCurrentSpectrum);
  els.saveName.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveCurrentSpectrum(); }
  });
  renderSavedList();
  // Restore persisted slider position before the input event fires for it.
  els.frameAvg.value = frameAvg;
  els.frameAvgValue.textContent = frameAvg;
  els.frameAvg.addEventListener('input', () => {
    frameAvg = parseInt(els.frameAvg.value, 10);
    els.frameAvgValue.textContent = frameAvg;
    localStorage.setItem('frameAvg', String(frameAvg));
    while (frameRaws.length > frameAvg) frameRaws.shift();
    if (plot && plotData?.mode === 'mono') plot.setSeries(1, { show: frameAvg > 1 });
  });
  els.linearizeSensor.checked = linearizeSensor;
  els.linearizeSensor.addEventListener('change', () => {
    linearizeSensor = els.linearizeSensor.checked;
    localStorage.setItem('linearizeSensor', linearizeSensor ? '1' : '0');
    // Status row needs to refresh because the cal/linearize-mode mismatch
    // warning depends on this toggle's current value.
    updateCalibrationUI();
  });
  els.showRgb.checked = showRgb;
  els.showRgb.addEventListener('change', () => {
    showRgb = els.showRgb.checked;
    localStorage.setItem('showRgb', showRgb ? '1' : '0');
    // Buffer entries are shaped per-mode (Float64Array vs {r,g,b}); reset.
    frameRaws.length = 0;
    rebuildPlot();
    if (calibrationMode) createCalMarkers();
  });
  els.flipHorizontal.checked = flipHorizontal;
  applyFlipState();
  els.hideCameraView.checked = hideCameraView;
  applyHideCameraViewState();
  els.hideCameraView.addEventListener('change', () => {
    hideCameraView = els.hideCameraView.checked;
    localStorage.setItem('hideCameraView', hideCameraView ? '1' : '0');
    applyHideCameraViewState();
  });
  els.hideCurrentSpectrum.checked = hideCurrentSpectrum;
  els.hideCurrentSpectrum.addEventListener('change', () => {
    hideCurrentSpectrum = els.hideCurrentSpectrum.checked;
    localStorage.setItem('hideCurrentSpectrum', hideCurrentSpectrum ? '1' : '0');
    applyHideCurrentSpectrumState();
  });
  els.peakNormalize.checked = peakNormalize;
  els.peakNormalize.addEventListener('change', () => {
    peakNormalize = els.peakNormalize.checked;
    localStorage.setItem('peakNormalize', peakNormalize ? '1' : '0');
    // Live trace re-scales on the next sampling frame; saved spectra need an
    // explicit redraw because their draw is hook-driven.
    if (plot) plot.redraw(false);
  });
  els.colCropMin.value = colCropMinPct;
  els.colCropMax.value = colCropMaxPct;
  updateColCropLabels();
  const onCropChange = () => {
    localStorage.setItem('colCropMinPct', String(colCropMinPct));
    localStorage.setItem('colCropMaxPct', String(colCropMaxPct));
    updateColCropLabels();
    updateRowMarker();
    applyXAxisRange();
  };
  els.colCropMin.addEventListener('input', () => {
    colCropMinPct = parseFloat(els.colCropMin.value);
    if (colCropMinPct > colCropMaxPct) {
      colCropMaxPct = colCropMinPct;
      els.colCropMax.value = colCropMaxPct;
    }
    onCropChange();
  });
  els.colCropMax.addEventListener('input', () => {
    colCropMaxPct = parseFloat(els.colCropMax.value);
    if (colCropMaxPct < colCropMinPct) {
      colCropMinPct = colCropMaxPct;
      els.colCropMin.value = colCropMinPct;
    }
    onCropChange();
  });
  els.flipHorizontal.addEventListener('change', () => {
    flipHorizontal = els.flipHorizontal.checked;
    localStorage.setItem('flipHorizontal', flipHorizontal ? '1' : '0');
    // The flipped data lives at different pixel indices, so any existing
    // calibration becomes invalid — drop it and let the user recalibrate in
    // the new orientation. Without this, the plot in wavelength mode would
    // look identical (because every wavelength would just remap onto the
    // mirrored pixel index), defeating the whole point of the toggle.
    if (calibration) {
      calibration = null;
      localStorage.removeItem('calibration');
      updateCalibrationUI();
    }
    applyFlipState();
    frameRaws.length = 0;
    rebuildPlot();
    if (calibrationMode) createCalMarkers();
  });
  updateCalibrationUI();
  updateRowMarker();

  // Detect server
  const health = await api.health();
  if (health && health.ok) {
    if (await loadControls()) {
      setServerMode();
      if (!health.camera && health.error) {
        els.banner.classList.remove('hidden');
        els.banner.textContent = `Server up but camera not reachable: ${health.error}`;
      }
    } else {
      setStandaloneMode('Server reachable but controls failed to load.');
    }
  } else {
    setStandaloneMode(`No local server detected. Run \`node server.mjs\` in the project folder for fine-grained UVC controls. Showing camera output in auto-exposure mode.`);
  }

  // Continuously poll /api/health so the banner reflects the *current* camera
  // state — when the user unplugs/replugs the USB cable we want the UI to flip
  // without requiring a page reload. Also recovers gracefully if the server
  // process is restarted while the page is open.
  startHealthPolling(health);

  // Camera
  await listCameras();
  await startCamera(els.deviceSelect.value);

  // Sampling loop. Use rAF unconditionally — rVFC stops firing when the video
  // element isn't composited (display:none, fully clipped, or off-screen),
  // which would silently freeze the spectrum the moment the user hides the
  // camera preview. rAF keeps ticking, and drawImage pulls fresh frames from
  // the MediaStream track regardless of element visibility.
  function loop() {
    sampleSpectrum();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

init().catch(e => {
  console.error(e);
  els.banner.classList.remove('hidden');
  els.banner.textContent = `Init error: ${e.message}`;
});
