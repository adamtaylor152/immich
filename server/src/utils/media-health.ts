import { MediaHealthStatus } from 'src/enum';

const rawUnsupportedMessages = [
  'Input file has corrupt header',
  'Input buffer contains unsupported image format',
  'Unsupported file format or not RAW file',
  'unsupported image format',
  'no decode delegate',
];

const corruptMessages = ['corrupt', 'invalid', 'premature end', 'truncated', 'damaged'];

export const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const isUnsupportedRawDecodeError = (error: unknown) => {
  const message = getErrorMessage(error);
  return rawUnsupportedMessages.some((item) => message.includes(item));
};

export const classifyImageDecodeFailure = (
  error: unknown,
  options: { isRaw: boolean; enhancedRawAttempted?: boolean },
): MediaHealthStatus => {
  const message = getErrorMessage(error).toLowerCase();

  if (options.isRaw && isUnsupportedRawDecodeError(error) && !options.enhancedRawAttempted) {
    return MediaHealthStatus.UnsupportedRaw;
  }

  if (corruptMessages.some((item) => message.includes(item))) {
    return options.isRaw ? MediaHealthStatus.CorruptSuspect : MediaHealthStatus.CorruptConfirmed;
  }

  return options.isRaw ? MediaHealthStatus.CorruptSuspect : MediaHealthStatus.CorruptSuspect;
};
