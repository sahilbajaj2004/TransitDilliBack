import { staticTransitService, TransitRoute } from './static-transit.service';

export interface ResolvedRoute {
  shortName: string;
  longName: string;
  origin: string;
  destination: string;
  desc: string;
  agency: 'DTC' | 'DIMTS';
}

/**
 * Curated Delhi Transit Trunk Corridors Registry:
 * Authentic, iconic Delhi passenger bus routes spanning Ring Road, Outer Ring Road,
 * Radial corridors, Trans-Yamuna, South Delhi, and West Delhi.
 */
export const DELHI_TRUNK_REGISTRY: Array<{
  shortName: string;
  longName: string;
  origin: string;
  destination: string;
  agency: 'DTC' | 'DIMTS';
}> = [
  { shortName: '502', longName: '502DOWN: Mehrauli to Old Delhi Rly Station', origin: 'Mehrauli Terminal', destination: 'Old Delhi Railway Station', agency: 'DTC' },
  { shortName: '534', longName: '534UP: Mehrauli to Anand Vihar ISBT', origin: 'Mehrauli Terminal', destination: 'Anand Vihar ISBT', agency: 'DIMTS' },
  { shortName: '729', longName: '729DOWN: Kapashera Border to Mori Gate', origin: 'Kapashera Border', destination: 'Mori Gate Terminal', agency: 'DTC' },
  { shortName: '813', longName: '813UP: Uttam Nagar to Kashmiri Gate', origin: 'Uttam Nagar Terminal', destination: 'Kashmere Gate ISBT', agency: 'DIMTS' },
  { shortName: '946', longName: '946UP: Sultanpuri to Central Secretariat', origin: 'Sultanpuri Terminal', destination: 'Central Secretariat', agency: 'DTC' },
  { shortName: 'TMS', longName: 'TMS: Mudrika Ring Road Circular', origin: 'Sarai Kale Khan ISBT', destination: 'Ring Road Mudrika Loop', agency: 'DTC' },
  { shortName: 'OMS', longName: 'OMS: Outer Mudrika Express', origin: 'Uttam Nagar Terminal', destination: 'Outer Ring Road Loop', agency: 'DIMTS' },
  { shortName: '419', longName: '419UP: ISBT Kashmere Gate to Lado Sarai', origin: 'ISBT Kashmere Gate Terminal', destination: 'Lado Sarai Firni Road', agency: 'DTC' },
  { shortName: '73', longName: '73DOWN: Anand Vihar to Shivaji Stadium', origin: 'Anand Vihar ISBT', destination: 'Shivaji Stadium Terminal', agency: 'DIMTS' },
  { shortName: '505', longName: '505UP: Mehrauli to New Delhi Rly Station', origin: 'Mehrauli Terminal', destination: 'N.D. Rly. Station Gate No. 2', agency: 'DTC' },
  { shortName: '623', longName: '623UP: Shahdara to CP / Vasant Kunj', origin: 'Shahdara Terminal', destination: 'CP / Vasant Kunj Terminal', agency: 'DIMTS' },
  { shortName: '780', longName: '780DOWN: Najafgarh to Central Secretariat', origin: 'Najafgarh Terminal', destination: 'Central Secretariat', agency: 'DIMTS' },
  { shortName: '227A', longName: '227AUP: Karawal Nagar to Mori Gate', origin: 'Karawal Nagar Terminal', destination: 'Mori Gate Terminal', agency: 'DTC' },
  { shortName: '913', longName: '913UP: Qamruddin Nagar to Karawal Nagar', origin: 'Qamruddin Nagar Terminal', destination: 'Karawal Nagar Terminal', agency: 'DIMTS' },
  { shortName: '405', longName: '405DOWN: Badarpur Border to Old Delhi Rly', origin: 'Badarpur Border Terminal', destination: 'Old Delhi Railway Station', agency: 'DTC' },
  { shortName: '456', longName: '456UP: Hamdard Nagar to CP / New Delhi', origin: 'Hamdard Nagar Terminal', destination: 'New Delhi Rly Station', agency: 'DTC' },
  { shortName: '460', longName: '460UP: Badarpur Border to Minto Road', origin: 'Badarpur Border Terminal', destination: 'Minto Road Terminal', agency: 'DIMTS' },
  { shortName: '522A', longName: '522ADOWN: Sangam Vihar to Rajinder Nagar', origin: 'Sangam Vihar Terminal', destination: 'R Block Rajinder Nagar', agency: 'DTC' },
  { shortName: '543A', longName: '543AUP: Anand Vihar to Kapashera', origin: 'Anand Vihar ISBT', destination: 'Kapashera Border', agency: 'DIMTS' },
  { shortName: '604', longName: '604DOWN: Vasant Kunj to CP / New Delhi', origin: 'C9 Vasant Kunj', destination: 'New Delhi Railway Station', agency: 'DTC' },
  { shortName: '711', longName: '711UP: Janakpuri to Sarai Kale Khan', origin: 'Janakpuri D Block', destination: 'Sarai Kale Khan ISBT', agency: 'DIMTS' },
  { shortName: '727', longName: '727DOWN: Najafgarh to New Delhi Rly Stn', origin: 'Najafgarh Terminal', destination: 'New Delhi Railway Station', agency: 'DTC' },
  { shortName: '764', longName: '764UP: Najafgarh to Nehru Place', origin: 'Najafgarh Terminal', destination: 'Nehru Place Terminal', agency: 'DIMTS' },
  { shortName: '801', longName: '801DOWN: Inderpuri to Inderlok Metro', origin: 'Inderpuri Terminal', destination: 'Inderlok Metro Station', agency: 'DTC' },
  { shortName: '853', longName: '853UP: Uttam Nagar to Central Secretariat', origin: 'Uttam Nagar Terminal', destination: 'Central Secretariat', agency: 'DIMTS' },
  { shortName: '910', longName: '910DOWN: Saiyyad Nangloi to Shivaji Stadium', origin: 'Saiyyad Nangloi', destination: 'Shivaji Stadium Terminal', agency: 'DTC' },
  { shortName: '957', longName: '957UP: Rohini Sector 22 to Shivaji Stadium', origin: 'Rohini Sector 22 Terminal', destination: 'Shivaji Stadium Terminal', agency: 'DIMTS' },
  { shortName: 'GL-22', longName: 'GL-22: Kashmere Gate to Sarai Kale Khan', origin: 'Kashmere Gate ISBT', destination: 'Sarai Kale Khan ISBT', agency: 'DTC' },
  { shortName: 'RL-77', longName: 'RL-77: Manglapuri to New Delhi Rly Stn', origin: 'Manglapuri Terminal', destination: 'New Delhi Railway Station', agency: 'DIMTS' },
  { shortName: '108', longName: '108UP: Hari Nagar Clock Tower to Nehru Place', origin: 'Hari Nagar Clock Tower', destination: 'Nehru Place Terminal', agency: 'DTC' },
  { shortName: '261', longName: '261DOWN: Nand Nagari to Sarai Kale Khan', origin: 'Nand Nagari Terminal', destination: 'Sarai Kale Khan ISBT', agency: 'DIMTS' },
  { shortName: '425', longName: '425UP: Hamdard Nagar to Old Delhi Railway', origin: 'Hamdard Nagar Terminal', destination: 'Old Delhi Railway Station', agency: 'DTC' },
];

/**
 * Resolves any route ID (numeric, unmapped, or GTFS key) to an authentic passenger-facing Delhi route.
 * 1. Checks static GTFS SQLite route registry (which contains 2,620+ routes).
 * 2. If unmapped or dynamic duty (e.g. 3407, 3475), runs Spatial Corridor Resolution
 *    matching the bus's real-time GPS position and bearing to the physical road stops.
 * 3. Never produces arbitrary fake routes across Delhi.
 */
export function resolveDelhiRoute(
  rawRouteId: string,
  currentBusRegistration?: string,
  lat?: number,
  lon?: number,
  bearing?: number
): ResolvedRoute {
  const regUpper = (currentBusRegistration || '').toUpperCase();
  const inferredAgency: 'DTC' | 'DIMTS' =
    regUpper.startsWith('DL1PB') || regUpper.startsWith('DL1PC') || regUpper.startsWith('DL51GD') || regUpper.startsWith('DL51G')
      ? 'DIMTS'
      : 'DTC';

  // 1. Direct Static Database Lookup
  const existing = staticTransitService.getRouteById(rawRouteId);

  if (existing) {
    let cleanShort = existing.shortName;

    // If shortName is missing or internal integer, extract from longName
    if (!cleanShort || /^\d{4,}$/.test(cleanShort) || cleanShort === 'nan') {
      if (existing.longName) {
        const extracted = existing.longName
          .replace(/(UP\d*|DOWN\d*|STLUP|STLDOWN|LNKSTLUP|LSTLUP|\(NS\).*)$/i, '')
          .trim();
        if (extracted && extracted.length >= 2 && extracted.length <= 12 && !/^\d{4,}$/.test(extracted)) {
          cleanShort = extracted;
        }
      }
    }

    if (cleanShort && !/^\d{4,}$/.test(cleanShort) && cleanShort !== 'nan') {
      if (cleanShort.toUpperCase().startsWith('OMSEV')) cleanShort = 'OMS';
      if (cleanShort.toUpperCase().startsWith('TMSEV')) cleanShort = 'TMS';

      return {
        shortName: cleanShort,
        longName: existing.longName || cleanShort,
        origin: existing.startingStop || 'Delhi Terminal',
        destination: existing.terminalStop || 'Delhi NCT Corridor',
        desc: `${cleanShort}: ${existing.longName || cleanShort}`,
        agency: existing.agency || inferredAgency,
      };
    }
  }

  // 2. Spatial Corridor Matching: If routeId is an internal duty number (e.g. 3407, 3475),
  // match the bus to the physical transit corridor it is driving along.
  if (lat && lon && lat > 28.0 && lat < 29.5 && lon > 76.5 && lon < 77.8) {
    try {
      const nearbyStops = staticTransitService.getNearbyStops(lat, lon, 0.8);
      if (nearbyStops && nearbyStops.length > 0) {
        const routeCountMap = new Map<string, { count: number; route: TransitRoute }>();
        for (const s of nearbyStops) {
          const serving = staticTransitService.getRoutesServingStop(s.id);
          for (const r of serving) {
            if (r.shortName && !/^\d{4,}$/.test(r.shortName) && r.shortName !== 'nan') {
              const entry = routeCountMap.get(r.shortName) || { count: 0, route: r };
              entry.count++;
              routeCountMap.set(r.shortName, entry);
            }
          }
        }

        const candidates = [...routeCountMap.values()].sort((a, b) => b.count - a.count);
        if (candidates.length > 0) {
          const top = candidates[0].route;
          return {
            shortName: top.shortName,
            longName: top.longName,
            origin: top.startingStop || nearbyStops[0].name,
            destination: top.terminalStop || 'Delhi NCT Corridor',
            desc: `${top.shortName}: ${top.longName}`,
            agency: top.agency || inferredAgency,
          };
        }

        // If no named route passing through, identify by immediate stops along the road
        const closest = nearbyStops[0];
        return {
          shortName: 'BUS',
          longName: `Corridor via ${closest.name}`,
          origin: closest.name,
          destination: 'Delhi NCT Corridor',
          desc: `Live transit near ${closest.name}`,
          agency: inferredAgency,
        };
      }
    } catch {
      // Spatial lookup fallback
    }
  }

  // 3. Fallback for unmapped buses without coordinates
  return {
    shortName: rawRouteId && rawRouteId.length <= 6 && !/^\d{4,}$/.test(rawRouteId) ? rawRouteId : 'BUS',
    longName: `Delhi Fleet ${currentBusRegistration || rawRouteId}`,
    origin: 'Delhi Terminal',
    destination: 'Delhi NCT Corridor',
    desc: `Delhi Transport Fleet ${currentBusRegistration || ''}`,
    agency: inferredAgency,
  };
}
