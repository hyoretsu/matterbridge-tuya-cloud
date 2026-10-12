export * from "./AuthenticationError.js";
export * from "./RateLimitError.js";
export * from "./UnsupportedOperationError.js";

export type ErrorCallback = (error: Error) => void;
