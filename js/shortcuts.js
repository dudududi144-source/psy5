/* ============ KEYBOARD SHORTCUT REGISTRY (v0.5.0) ============
   Single source of truth: the device's keydown dispatcher AND the help
   overlay both render from this table — adding a shortcut here is enough.
   The registry is pure data + a collision finder, unit-tested so no two
   bindings can ever claim the same key.

   Audit history (v0.5.0): before this registry the ONLY global handler
   lived in js/ui/header.js with Space (play/stop), r, z/Z and 1-8
   (select track). The taskbook moves 1-8 to pad triggers; track selection
   moves to Shift+1-8. Arrows (scene prev/next), f, v, b and ? are new. */
export const SHORTCUTS = [
  { key: 'Space', label: 'Play / Stop', group: 'Transport' },
  { key: 'r', label: 'Record arm', group: 'Transport' },
  { key: 't', label: 'Tap tempo (2+ taps)', group: 'Transport' },
  { key: '[', label: 'BPM −1 (live tempo ride)', group: 'Transport' },
  { key: ']', label: 'BPM +1 (live tempo ride)', group: 'Transport' },
  { key: 'x', label: 'PANIC — kill all voices', group: 'Transport' },
  { key: 'c', label: 'Chain mode on/off', group: 'Transport' },
  { key: 'ArrowLeft', label: 'Previous scene (quantized)', group: 'Transport' },
  { key: 'ArrowRight', label: 'Next scene (quantized)', group: 'Transport' },
  { key: '1', label: 'Pad 1 (drum trigger)', group: 'Performance' },
  { key: '2', label: 'Pad 2 (drum trigger)', group: 'Performance' },
  { key: '3', label: 'Pad 3 (drum trigger)', group: 'Performance' },
  { key: '4', label: 'Pad 4 (drum trigger)', group: 'Performance' },
  { key: '5', label: 'Pad 5 (drum trigger)', group: 'Performance' },
  { key: '6', label: 'Pad 6 (drum trigger)', group: 'Performance' },
  { key: '7', label: 'Pad 7 (drum trigger)', group: 'Performance' },
  { key: '8', label: 'Pad 8 (drum trigger)', group: 'Performance' },
  { key: 'Shift+1', label: 'Select track 1', group: 'Performance' },
  { key: 'Shift+2', label: 'Select track 2', group: 'Performance' },
  { key: 'Shift+3', label: 'Select track 3', group: 'Performance' },
  { key: 'Shift+4', label: 'Select track 4', group: 'Performance' },
  { key: 'Shift+5', label: 'Select track 5', group: 'Performance' },
  { key: 'Shift+6', label: 'Select track 6', group: 'Performance' },
  { key: 'Shift+7', label: 'Select track 7', group: 'Performance' },
  { key: 'Shift+8', label: 'Select track 8', group: 'Performance' },
  { key: 'f', label: 'Fill (drums — click again cycles CLASSIC/ROLL/TOMLINE)', group: 'Performance' },
  { key: 'v', label: 'Variation', group: 'Performance' },
  { key: 'q', label: 'DJ tool — RISER now', group: 'Performance' },
  { key: 'w', label: 'DJ tool — reverse-cymbal swell', group: 'Performance' },
  { key: 'e', label: 'DJ tool — impact hit', group: 'Performance' },
  { key: 'Alt+1', label: 'Instant-launch scene 1', group: 'Performance' },
  { key: 'Alt+2', label: 'Instant-launch scene 2', group: 'Performance' },
  { key: 'Alt+3', label: 'Instant-launch scene 3', group: 'Performance' },
  { key: 'Alt+4', label: 'Instant-launch scene 4', group: 'Performance' },
  { key: 'Alt+5', label: 'Instant-launch scene 5', group: 'Performance' },
  { key: 'Alt+6', label: 'Instant-launch scene 6', group: 'Performance' },
  { key: 'Alt+7', label: 'Instant-launch scene 7', group: 'Performance' },
  { key: 'Alt+8', label: 'Instant-launch scene 8', group: 'Performance' },
  { key: 'b', label: 'Bounce (offline WAV)', group: 'Workflow' },
  { key: 's', label: 'Save project', group: 'Workflow' },
  { key: 'z', label: 'Undo', group: 'Workflow' },
  { key: 'Z', label: 'Redo', group: 'Workflow' },
  { key: '?', label: 'Keyboard help', group: 'Help' },
  { key: 'Escape', label: 'Close overlay', group: 'Help' },
];

/* normalized key identity: the registry stores exact e.key values, so 'z'
   (undo) and 'Z' (redo, shift) are DISTINCT bindings — case is preserved.
   Shift+N digit entries are dispatched via e.code and stay distinct too. */
function normKey(key) { return key }

/* returns an array of colliding key groups ([] = clean registry) */
export function findCollisions() {
  const seen = new Map();
  for (const sc of SHORTCUTS) {
    const k = normKey(sc.key);
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(sc.key);
  }
  const out = [];
  for (const [k, keys] of seen) if (keys.length > 1) out.push({ key: k, bindings: keys });
  return out;
}

/* grouped rows for the help overlay */
export function helpRows() {
  const groups = [];
  const byGroup = new Map();
  for (const sc of SHORTCUTS) {
    if (!byGroup.has(sc.group)) { byGroup.set(sc.group, []); groups.push(sc.group) }
    byGroup.get(sc.group).push(sc);
  }
  return groups.map(g => ({ group: g, items: byGroup.get(g) }));
}
