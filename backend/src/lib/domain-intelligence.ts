import { DomainCacheModel } from "../models/domain-cache.js";

export type DomainIntelligence = {
  available: boolean;
  registrationDate: string | null;
  ageDays: number | null;
  registrar: string | null;
  source: "rdap" | "cache" | "unavailable";
};

type RdapResponse = {
  events?: Array<{ eventAction?: string; eventDate?: string }>;
  entities?: Array<{ roles?: string[]; vcardArray?: [string, Array<[string, string, unknown, string]>] }>;
};

function unavailable(): DomainIntelligence {
  return {
    available: false,
    registrationDate: null,
    ageDays: null,
    registrar: null,
    source: "unavailable",
  };
}

function fromWhoisData(data: Record<string, unknown>, source: "rdap" | "cache"): DomainIntelligence {
  const registrationDate = typeof data.registrationDate === "string" ? data.registrationDate : null;
  const ageDays = registrationDate
    ? Math.max(0, Math.floor((Date.now() - new Date(registrationDate).getTime()) / 86_400_000))
    : null;

  return {
    available: true,
    registrationDate,
    ageDays,
    registrar: typeof data.registrar === "string" ? data.registrar : null,
    source,
  };
}

export async function getDomainIntelligence(domain: string): Promise<DomainIntelligence> {
  const normalizedDomain = domain.trim().toLowerCase();
  if (!normalizedDomain || normalizedDomain.endsWith(".invalid")) return unavailable();

  const cached = (await DomainCacheModel.findOne({ domain: normalizedDomain }).lean()) as {
    whoisData?: Record<string, unknown>;
  } | null;
  if (cached && cached.whoisData && typeof cached.whoisData === "object") {
    return fromWhoisData(cached.whoisData, "cache");
  }

  const tld = normalizedDomain.split(".").pop() ?? "";
  const endpoints = [
    `https://rdap.org/domain/${encodeURIComponent(normalizedDomain)}`,
    ...(tld === "com" || tld === "net"
      ? [`https://rdap.verisign.com/${tld}/v1/domain/${encodeURIComponent(normalizedDomain)}`]
      : []),
  ];
  let data: RdapResponse | null = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (response.ok) {
        data = await response.json() as RdapResponse;
        break;
      }
    } catch {
      // Try the next RDAP provider.
    }
  }
  if (!data) return unavailable();

  const registrationDate = data.events?.find((event) => event.eventAction === "registration")?.eventDate ?? null;
  const registrarEntity = data.entities?.find((entity) => entity.roles?.includes("registrar"));
  const registrar = registrarEntity?.vcardArray?.[1]?.find((entry) => entry[0] === "fn")?.[3] ?? null;
  const whoisData = { registrationDate, registrar };

  await DomainCacheModel.findOneAndUpdate(
    { domain: normalizedDomain },
    { domain: normalizedDomain, whoisData, createdAt: new Date() },
    { upsert: true, setDefaultsOnInsert: true },
  );

  return fromWhoisData(whoisData, "rdap");
}
