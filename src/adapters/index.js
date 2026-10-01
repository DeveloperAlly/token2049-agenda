import webflowFinsweet from './webflow-finsweet/index.js';

const ADAPTERS = { [webflowFinsweet.name]: webflowFinsweet };

/** Resolve an event's adapter, applying optional per-event selector overrides. */
export function getAdapter(event) {
  const base = ADAPTERS[event.adapter];
  if (!base) throw new Error(`Unknown adapter "${event.adapter}" for event ${event.id}`);
  const o = event.adapterOverrides || {};
  return {
    ...base,
    ...o,
    fields: { ...base.fields, ...(o.fields || {}) },
    groups: { ...base.groups, ...(o.groups || {}) },
  };
}

export { ADAPTERS };
