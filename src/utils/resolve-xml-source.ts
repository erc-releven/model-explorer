export function resolveXmlSourceForFetch(source: string): string {
  const trimmedSource = source.trim();

  if (trimmedSource.length === 0) {
    return trimmedSource;
  }

  // Absolute URLs and special schemes should be fetched as-is.
  try {
    const absoluteUrl = new URL(trimmedSource);
    return absoluteUrl.toString();
  } catch {
    // Continue for app-relative paths.
  }

  const basePath = import.meta.env.BASE_URL;
  const normalizedBasePath = basePath.endsWith("/") ? basePath : `${basePath}/`;
  const normalizedSource = trimmedSource.replace(/^\/+/, "");

  return `${normalizedBasePath}${normalizedSource}`;
}
