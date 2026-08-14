// The one place that defines where uploaded product images are published. The backend
// serves them here, the inventory DTO builds its imageUrl from here, and Nginx proxies
// this exact prefix to the API process — so there is a single image URL contract.
export const UPLOAD_PUBLIC_PREFIX = '/uploads/inventory/';

// The version token is derived from the row's own last-modified time. It keeps the URL
// stable while the image is unchanged, and gives a fresh one the moment it changes — so
// a CDN or browser can cache aggressively without ever pinning a stale response.
export const publicImageUrl = (imagePath: string | null | undefined, version?: Date | string | null) => {
  if (!imagePath) return undefined;
  const stamp = version instanceof Date ? version.getTime() : version ? Date.parse(String(version)) : Number.NaN;
  return Number.isFinite(stamp) ? `${UPLOAD_PUBLIC_PREFIX}${imagePath}?v=${stamp}` : `${UPLOAD_PUBLIC_PREFIX}${imagePath}`;
};
