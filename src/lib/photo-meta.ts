import exifr from "exifr";

export type PhotoMeta = {
  takenAt: Date | null;
  gps: { lat: number; lon: number } | null;
};

/**
 * Read EXIF from the ORIGINAL file, before any compression re-encodes it.
 * Fails quietly: returns nulls if there is no metadata.
 */
export async function readPhotoMeta(file: File): Promise<PhotoMeta> {
  try {
    const data = await exifr.parse(file, {
      pick: ["DateTimeOriginal", "CreateDate", "GPSLatitude", "GPSLongitude", "latitude", "longitude"],
    });
    if (!data) return { takenAt: null, gps: null };

    const rawDate = data.DateTimeOriginal ?? data.CreateDate ?? null;
    const takenAt =
      rawDate instanceof Date
        ? rawDate
        : rawDate
          ? new Date(rawDate)
          : null;

    const lat = typeof data.latitude === "number" ? data.latitude : null;
    const lon = typeof data.longitude === "number" ? data.longitude : null;

    return {
      takenAt: takenAt && !isNaN(takenAt.getTime()) ? takenAt : null,
      gps: lat != null && lon != null ? { lat, lon } : null,
    };
  } catch {
    return { takenAt: null, gps: null };
  }
}

/**
 * Reverse-geocode using OpenStreetMap Nominatim. Free, no API key.
 * Per their usage policy: identify with a UA and don't hammer it. We call once per upload.
 * Returns a short place name or null on any failure.
 */
export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1`;
    const res = await fetch(url, {
      headers: { "Accept-Language": "en" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      name?: string;
      address?: Record<string, string>;
      display_name?: string;
    };
    const a = json.address ?? {};
    // Prefer a venue name, then neighbourhood + city, then a short display fragment.
    const venue = json.name || a.amenity || a.building || a.shop || a.restaurant;
    const locality = a.suburb || a.neighbourhood || a.village || a.town || a.city;
    if (venue && locality) return `${venue}, ${locality}`;
    if (venue) return venue;
    if (locality) return locality;
    if (json.display_name) return json.display_name.split(",").slice(0, 2).join(",").trim();
    return null;
  } catch {
    return null;
  }
}

/**
 * City and country from GPS, for price comparability. Same Nominatim call as
 * reverseGeocode but returns the administrative fields rather than a label.
 */
export async function reverseGeocodeCity(
  lat: number,
  lon: number,
): Promise<{ city: string | null; country: string | null }> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=12&addressdetails=1`;
    const res = await fetch(url, { headers: { "Accept-Language": "en" } });
    if (!res.ok) return { city: null, country: null };
    const json = (await res.json()) as { address?: Record<string, string> };
    const a = json.address ?? {};
    return {
      city: a.city || a.town || a.village || a.municipality || a.county || null,
      country: a.country || null,
    };
  } catch {
    return { city: null, country: null };
  }
}
