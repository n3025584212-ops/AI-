import { MODEL_FEATURES, modelInputFeatures } from './modelInputs.js';

// Reference checks cover canonical25 only; S4 force remains a display value.
export const RANGE_CHECK_FIELDS = Object.freeze([
  ...MODEL_FEATURES.map(feature => Object.freeze({ ...feature, isModelInput: true })),
]);
export const RANGE_CHECK_FIELD_COUNT = RANGE_CHECK_FIELDS.length;
export const MODEL_RANGE_CHECK_FIELD_COUNT = MODEL_FEATURES.length;
export const EXTRA_PROCESS_FIELD_COUNT = RANGE_CHECK_FIELD_COUNT - MODEL_RANGE_CHECK_FIELD_COUNT;
export function rangeCheckValues(input) {
  return modelInputFeatures(input);
}
