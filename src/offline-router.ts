/**
 * offline-router — offline map data and on-device routing, as one module.
 *
 * The work is split into five layers, each a separate file, so a reader follows
 * the data flow instead of a 1500-line file:
 *
 *   types        — the shared shapes and error classes
 *   download     — road data over the public Overpass mirrors (tile + retry)
 *   destinations — the searchable address/place index for a saved area
 *   search       — corridor bounds, network merge, and name/address search
 *   graph        — the packed routing graph and its A* route search
 *
 * Every export below is re-exported unchanged, so callers keep importing from
 * `./offline-router` exactly as before.
 */
export * from './offline-router/types';
export * from './offline-router/download';
export * from './offline-router/destinations';
export * from './offline-router/search';
export * from './offline-router/graph';
