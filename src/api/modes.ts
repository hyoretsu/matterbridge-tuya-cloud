export const COLOR_MODES = ["color", "colour"] as const;
export type ColorModes = (typeof COLOR_MODES)[number] | "white";
export const CLIMATE_MODES = ["cold", "hot", "wind", "auto"] as const;
export type ClimateMode = (typeof CLIMATE_MODES)[number];
