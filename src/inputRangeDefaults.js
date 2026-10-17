import { RANGE_CHECK_FIELDS } from './inputRangeFields.js';
import { defaultEffectiveInputRange, INPUT_REFERENCE_RANGE_DEFINITION } from './formalInputRanges.js';
import { FROZEN_DEMO_RANGE_STATS } from './frozenDemoRangeStats.js';
import { sourceUnitFor } from './engineeringUnits.js';
import { sanitizeCustomLimits } from './historicalRangeCheck.js';

// Fixed reference defaults; frozen Demo statistics remain evidence only.
export const DEFAULT_INPUT_RANGE_TABLE = Object.freeze({
  datasetId: INPUT_REFERENCE_RANGE_DEFINITION.type,
  datasetVersion: INPUT_REFERENCE_RANGE_DEFINITION.revision,
  rowCount: null,
  sourceSha256: null,
  fields: Object.freeze(Object.fromEntries(RANGE_CHECK_FIELDS.map(feature => [feature.key,
    Object.freeze({ ...FROZEN_DEMO_RANGE_STATS.fields[feature.key], ...defaultEffectiveInputRange(feature), unit: sourceUnitFor(feature.field) })]))),
});
export function currentModelReferenceRanges(customLimits = {}) {
  const custom = sanitizeCustomLimits(customLimits);
  return Object.fromEntries(RANGE_CHECK_FIELDS.filter(field=>field.isModelInput).flatMap(field=>{
    const range = custom[field.key] || DEFAULT_INPUT_RANGE_TABLE.fields[field.key];
    return Number.isFinite(range?.min)&&Number.isFinite(range?.max)&&range.min<=range.max ? [[field.key,[range.min,range.max]]] : [];
  }));
}
