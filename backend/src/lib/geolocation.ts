export type Geolocation = {
  country: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  isProxy: boolean | null;
  latitude: number | null;
  longitude: number | null;
};

const emptyGeolocation: Geolocation = {
  country: null,
  region: null,
  city: null,
  isp: null,
  isProxy: null,
  latitude: null,
  longitude: null,
};

export async function geolocateIp(ip: string | null): Promise<Geolocation> {
  if (!ip) return emptyGeolocation;

  const response = await fetch(
    `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,isp,proxy,hosting,lat,lon`,
    { signal: AbortSignal.timeout(8000), cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error(`IP geolocation request failed with status ${response.status}.`);
  }

  const data = (await response.json()) as {
    status?: string;
    country?: string;
    regionName?: string;
    city?: string;
    isp?: string;
    proxy?: boolean;
    hosting?: boolean;
    lat?: number;
    lon?: number;
  };

  if (data.status !== "success") return emptyGeolocation;

  return {
    country: data.country ?? null,
    region: data.regionName ?? null,
    city: data.city ?? null,
    isp: data.isp ?? null,
    isProxy: data.proxy === true || data.hosting === true,
    latitude: typeof data.lat === "number" ? data.lat : null,
    longitude: typeof data.lon === "number" ? data.lon : null,
  };
}
