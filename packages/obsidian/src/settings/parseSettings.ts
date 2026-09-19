import { DEFAULT_SETTINGS, type JsonObject, type JsonValue, type OpenChamberSettings } from '../types';

const MIN_PORT = 1;
const MAX_PORT = 65535;

const isJsonObject = (value: JsonValue | null): value is JsonObject =>
  value !== null && !Array.isArray(value) && Object(value) === value;

const isString = (value: JsonValue | undefined): value is string =>
  value !== undefined && String(value) === value;

const isBoolean = (value: JsonValue | undefined): value is boolean =>
  value === true || value === false;

const isPort = (value: JsonValue | undefined): value is number =>
  value !== undefined &&
  Number(value) === value &&
  Number.isInteger(value) &&
  value >= MIN_PORT &&
  value <= MAX_PORT;

export const parseSettings = (value: JsonValue | null): OpenChamberSettings => {
  if (!isJsonObject(value)) return { ...DEFAULT_SETTINGS };

  return {
    openchamberPath: isString(value.openchamberPath)
      ? value.openchamberPath
      : DEFAULT_SETTINGS.openchamberPath,
    port: isPort(value.port) ? value.port : DEFAULT_SETTINGS.port,
    autoStart: isBoolean(value.autoStart) ? value.autoStart : DEFAULT_SETTINGS.autoStart,
    externalUrl: isString(value.externalUrl) ? value.externalUrl : DEFAULT_SETTINGS.externalUrl,
  };
};

export const applySetting = (
  settings: OpenChamberSettings,
  key: string,
  value: JsonValue,
): OpenChamberSettings => {
  if (key === 'openchamberPath') {
    return isString(value) ? { ...settings, openchamberPath: value } : settings;
  }
  if (key === 'port') {
    return isPort(value) ? { ...settings, port: value } : settings;
  }
  if (key === 'autoStart') {
    return isBoolean(value) ? { ...settings, autoStart: value } : settings;
  }
  if (key === 'externalUrl') {
    return isString(value) ? { ...settings, externalUrl: value } : settings;
  }
  return settings;
};
