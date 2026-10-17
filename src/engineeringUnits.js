/** Original field engineering units shared by canonical values, scaler and UI.
 * Explicit legacy imports are converted once at the transport boundary. */
export const ENGINEERING_UNIT_SYSTEM = 'canonical-engineering-v2';
export const LEGACY_ENGINEERING_UNIT_SYSTEM = 'engineering-v1';
export const RAW_UNIT_SYSTEM = 'raw-v1';
// Explicit legacy MN imports only; never used for default display conversion.
export const FORCE_TF_TO_MN = 0.00980665;
export const SOURCE_UNITS = Object.freeze({ force: 't', tension: 't', frontTension: 't', bendingForce: 'kN', speed: 'm/min', width: 'mm', entrySetThickness: 'mm', entryThickness: 'mm', exitThickness: 'mm', temperature: '°C' });
export const ENGINEERING_UNITS = SOURCE_UNITS;
const forceAliases = new Set(['target', 'observed', 'prediction', 'predicted', 'predictedValue', 'actual', 'value', 'error', 'delta', 'mae', 'rmse', 'absolute_error_p95', 'contribution']);
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function engineeringField(field) {
  if (forceAliases.has(field) || /rolling forces$/.test(field)) return 'force';
  if (/bending force$/.test(field)) return 'bendingForce';
  if (/rolling speed$/.test(field)) return 'speed';
  if (/back tension$/.test(field)) return 'tension';
  if (/front tension$/.test(field)) return 'frontTension';
  if (field === 'Entry set thickness') return 'entrySetThickness';
  if (field === 'Entry actual thickness') return 'entryThickness';
  return field;
}

const forceInNewtons = Object.freeze({ N: 1, kN: 1000, MN: 1000000, t: 9806.65, tf: 9806.65, kgf: 9.80665 });
const speedInMetresPerSecond = Object.freeze({ 'm/s': 1, 'm/min': 1 / 60 });
// Remove only a machine-precision tail caused by scale multiplication. This is
// not display rounding: values farther than two ulps from 15-digit decimals stay.
function cleanConversion(value) {
  const rounded = Number(value.toPrecision(15));
  return Math.abs(rounded - value) <= Number.EPSILON * Math.abs(value) * 2 ? rounded : value;
}
/** Explicit conversion supports imported profiles; unsupported units are never guessed. */
export function convertUnit(value, sourceUnit, targetUnit) {
  if (!finite(value)) return null;
  if (!sourceUnit || !targetUnit) return null;
  if (sourceUnit === targetUnit) return value;
  for (const family of [forceInNewtons, speedInMetresPerSecond]) {
    if (Object.hasOwn(family, sourceUnit) && Object.hasOwn(family, targetUnit)) return cleanConversion(value * (family[sourceUnit] / family[targetUnit]));
  }
  return null;
}
export function unitFor(field) { return ENGINEERING_UNITS[engineeringField(field)] || ''; }
export function supportedUnitProfile(profile) {
  return [ENGINEERING_UNIT_SYSTEM, RAW_UNIT_SYSTEM, LEGACY_ENGINEERING_UNIT_SYSTEM].includes(profile);
}
export function decodeUnitProfile(field, value, profile) {
  if (!supportedUnitProfile(profile) || !finite(value)) return null;
  // Legacy exports converted rolling force only; their tension numbers stayed raw.
  return profile === LEGACY_ENGINEERING_UNIT_SYSTEM && engineeringField(field) === 'force'
    ? convertUnit(value, 'MN', 't') : value;
}
export function encodeUnitProfile(field, value, profile = ENGINEERING_UNIT_SYSTEM) {
  if (!supportedUnitProfile(profile) || !finite(value)) return null;
  return profile === LEGACY_ENGINEERING_UNIT_SYSTEM && engineeringField(field) === 'force'
    ? convertUnit(value, 't', 'MN') : value;
}
export function sourceUnitFor(field, sourceUnits = SOURCE_UNITS) { return sourceUnits[engineeringField(field)] || ''; }
export function toDisplay(field, raw, sourceUnits = SOURCE_UNITS) {
  const name = engineeringField(field);
  return convertUnit(raw, sourceUnits[name], ENGINEERING_UNITS[name]);
}
export function fromDisplay(field, value, sourceUnits = SOURCE_UNITS) {
  const name = engineeringField(field);
  return convertUnit(value, ENGINEERING_UNITS[name], sourceUnits[name]);
}
export function formatEngineering(field, raw, digits = 2) {
  const value = toDisplay(field, raw);
  return value === null ? '—' : `${value.toFixed(digits)}${unitFor(field) ? ` ${unitFor(field)}` : ''}`;
}
export const formatEngineeringValue = formatEngineering;
export function unitMetadata() {
  return Object.fromEntries(Object.keys(ENGINEERING_UNITS).map(field => [field, {
    unit: ENGINEERING_UNITS[field], displayUnit: ENGINEERING_UNITS[field], sourceUnit: SOURCE_UNITS[field],
    status: 'confirmed', factor: 1, unitSystem: ENGINEERING_UNIT_SYSTEM, source: '现场原始工程单位；用户确认，并核验冻结原表与模型 scaler 尺度',
  }]));
}
