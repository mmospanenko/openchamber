export const OPENCHAMBER_VIEW_TYPE = 'openchamber-ui';

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export type JsonObject = { [key: string]: JsonValue };

export interface OpenChamberSettings {
  openchamberPath: string;
  port: number;
  autoStart: boolean;
  externalUrl: string;
}

export const DEFAULT_SETTINGS: OpenChamberSettings = {
  openchamberPath: '',
  port: 3000,
  autoStart: true,
  externalUrl: '',
};
