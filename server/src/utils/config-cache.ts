let clearCache = () => {};

export const registerConfigCacheClear = (callback: () => void): void => {
  clearCache = callback;
};

export const clearRegisteredConfigCache = (): void => clearCache();
