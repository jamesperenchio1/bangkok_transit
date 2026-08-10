import { z } from "zod";

export const OperatorSchema = z.object({
  id: z.string(),
  nameEn: z.string(),
  nameTh: z.string(),
  shortName: z.string(),
  website: z.string().url().optional(),
  color: z.string(),
  textColor: z.string().default("#ffffff"),
});

export const LineStatusSchema = z.enum([
  "operational",
  "under_construction",
  "testing",
  "closed",
  "delayed",
]);

export const TransitModeSchema = z.enum([
  "bts",
  "mrt",
  "arl",
  "srt",
  "brt",
  "boat",
  "bus",
  "ferry",
]);

export const LineSchema = z.object({
  id: z.string(),
  operatorId: z.string(),
  nameEn: z.string(),
  nameTh: z.string(),
  shortName: z.string(),
  color: z.string(),
  textColor: z.string().default("#ffffff"),
  mode: TransitModeSchema,
  status: LineStatusSchema.default("operational"),
  openingDate: z.string().optional(),
  stationIds: z.array(z.string()).default([]),
});

export const StationSchema = z.object({
  id: z.string(),
  nameEn: z.string(),
  nameTh: z.string(),
  codes: z.array(z.string()),
  lineIds: z.array(z.string()),
  lat: z.number(),
  lng: z.number(),
  isInterchange: z.boolean().default(false),
  adjacentStationIds: z.array(z.string()).default([]),
});

export const ExitSchema = z.object({
  stationId: z.string(),
  exits: z.array(
    z.object({
      number: z.string(),
      landmarksEn: z.array(z.string()).default([]),
      landmarksTh: z.array(z.string()).default([]),
      busRoutes: z.array(z.string()).default([]),
      photoUrl: z.string().optional(),
      hasElevator: z.boolean().default(false),
      hasEscalator: z.boolean().default(false),
    })
  ),
});

export const FacilitySchema = z.object({
  stationId: z.string(),
  elevators: z.number().int().min(0).default(0),
  escalators: z.number().int().min(0).default(0),
  toilets: z.boolean().default(false),
  disabledAccess: z.boolean().default(false),
  babyChanging: z.boolean().default(false),
  atms: z.number().int().min(0).default(0),
  convenienceStores: z.boolean().default(false),
  food: z.boolean().default(false),
  chargingPoints: z.boolean().default(false),
  bikeParking: z.boolean().default(false),
  carParking: z.boolean().default(false),
  motorcycleParking: z.boolean().default(false),
  taxiStand: z.boolean().default(false),
  motorcycleTaxi: z.boolean().default(false),
  busStop: z.boolean().default(false),
  boatPier: z.boolean().default(false),
  lostAndFound: z.boolean().default(false),
  customerService: z.boolean().default(false),
  evCharging: z.boolean().default(false),
});

export const TimeRangeSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  frequencyMinutes: z.number().positive(),
});

export const TimetableSchema = z.object({
  lineId: z.string(),
  direction: z.string(),
  firstTrain: z.array(
    z.object({
      stationId: z.string(),
      time: z.string().regex(/^\d{2}:\d{2}$/),
    })
  ),
  lastTrain: z.array(
    z.object({
      stationId: z.string(),
      time: z.string().regex(/^\d{2}:\d{2}$/),
    })
  ),
  peakHours: z.array(TimeRangeSchema).default([]),
  offPeakHours: z.array(TimeRangeSchema).default([]),
});

export const FareSchema = z.object({
  originStationId: z.string(),
  destinationStationId: z.string(),
  price: z.number().nonnegative(),
  currency: z.string().default("THB"),
  ticketType: z.enum([
    "single",
    "rabbit",
    "emv",
    "mrt_card",
    "tourist_pass",
    "day_pass",
    "student",
    "elderly",
  ]),
});

export const ParkingSchema = z.object({
  stationId: z.string(),
  available: z.boolean(),
  motorcycle: z.boolean().default(false),
  bicycle: z.boolean().default(false),
  overnightAllowed: z.boolean().default(false),
  costPerHour: z.number().nonnegative().optional(),
  costPerDay: z.number().nonnegative().optional(),
  openingHours: z.string().optional(),
  capacity: z.number().int().nonnegative().optional(),
  notesEn: z.string().optional(),
  notesTh: z.string().optional(),
});

export const PlaceCategorySchema = z.enum([
  "shopping",
  "food",
  "hospital",
  "university",
  "tourist_attraction",
  "hotel",
  "office",
  "park",
  "transit",
]);

export const PlaceSchema = z.object({
  id: z.string(),
  nameEn: z.string(),
  nameTh: z.string(),
  category: PlaceCategorySchema,
  lat: z.number(),
  lng: z.number(),
  nearbyStationIds: z.array(z.string()),
  walkingMinutes: z.number().nonnegative().optional(),
  photoUrl: z.string().optional(),
});

export const AlertSeveritySchema = z.enum(["info", "warning", "critical"]);

export const AlertSchema = z.object({
  id: z.string(),
  lineIds: z.array(z.string()).default([]),
  stationIds: z.array(z.string()).default([]),
  titleEn: z.string(),
  titleTh: z.string(),
  descriptionEn: z.string(),
  descriptionTh: z.string(),
  severity: AlertSeveritySchema,
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  sourceUrl: z.string().url().optional(),
  updatedAt: z.string().datetime(),
});

export const BoatRouteSchema = z.object({
  id: z.string(),
  nameEn: z.string(),
  nameTh: z.string(),
  operator: z.string(),
  color: z.string(),
  piers: z.array(
    z.object({
      id: z.string(),
      nameEn: z.string(),
      nameTh: z.string(),
      lat: z.number(),
      lng: z.number(),
      connectedStationIds: z.array(z.string()).default([]),
    })
  ),
});

export const BusRouteSchema = z.object({
  id: z.string(),
  number: z.string(),
  operator: z.string(),
  color: z.string().optional(),
  originEn: z.string(),
  originTh: z.string(),
  destinationEn: z.string(),
  destinationTh: z.string(),
  stops: z.array(
    z.object({
      id: z.string(),
      nameEn: z.string(),
      nameTh: z.string(),
      lat: z.number(),
      lng: z.number(),
      connectedStationIds: z.array(z.string()).default([]),
    })
  ),
});

// Real track path per line ID, e.g. { "bts-sukhumvit": [[lat, lng], ...] }.
// Scraped from OSM way geometry — see scripts/scrape-osm-transit.ts.
export const LineGeometrySchema = z.record(
  z.string(),
  z.array(z.tuple([z.number(), z.number()]))
);

export type Operator = z.infer<typeof OperatorSchema>;
export type Line = z.infer<typeof LineSchema>;
export type Station = z.infer<typeof StationSchema>;
export type Exit = z.infer<typeof ExitSchema>;
export type Facility = z.infer<typeof FacilitySchema>;
export type Timetable = z.infer<typeof TimetableSchema>;
export type Fare = z.infer<typeof FareSchema>;
export type Parking = z.infer<typeof ParkingSchema>;
export type Place = z.infer<typeof PlaceSchema>;
export type Alert = z.infer<typeof AlertSchema>;
export type BoatRoute = z.infer<typeof BoatRouteSchema>;
export type BusRoute = z.infer<typeof BusRouteSchema>;
export type LineGeometry = z.infer<typeof LineGeometrySchema>;
