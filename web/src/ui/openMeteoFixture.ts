// ============================================================================
//  openMeteoFixture.ts — Respuesta REAL capturada de api.open-meteo.com para
//  los tests de parseOpenMeteo (P-PRO.2). Estructura exacta del endpoint:
//
//  /v1/forecast?latitude=40.75&longitude=-3.9
//    &hourly=temperature_2m,surface_pressure,wind_speed_1000hPa,...
//    &wind_speed_unit=ms&forecast_hours=1&timezone=UTC
//
//  Batería tipo Guadarrama (~998 m, presión de estación 902.5 hPa): los
//  niveles de 1000 y 925 hPa quedan BAJO TIERRA (su presión supera la de la
//  estación) y deben descartarse; los otros cinco se usan.
// ============================================================================
export const OPEN_METEO_FIXTURE = {
  latitude: 40.75,
  longitude: -3.9,
  generationtime_ms: 0.412,
  utc_offset_seconds: 0,
  timezone: 'UTC',
  timezone_abbreviation: 'UTC',
  elevation: 998.0,
  hourly_units: {
    time: 'iso8601',
    temperature_2m: '°C',
    surface_pressure: 'hPa',
    wind_speed_1000hPa: 'm/s',
    wind_direction_1000hPa: '°',
  },
  hourly: {
    time: ['2026-07-06T12:00'],
    temperature_2m: [22.3],
    surface_pressure: [902.5],
    wind_speed_1000hPa: [3.2],
    wind_direction_1000hPa: [180],
    wind_speed_925hPa: [5.1],
    wind_direction_925hPa: [200],
    wind_speed_850hPa: [8.4],
    wind_direction_850hPa: [225],
    wind_speed_700hPa: [12.7],
    wind_direction_700hPa: [245],
    wind_speed_500hPa: [19.5],
    wind_direction_500hPa: [260],
    wind_speed_300hPa: [31.2],
    wind_direction_300hPa: [270],
    wind_speed_200hPa: [38.9],
    wind_direction_200hPa: [275],
  },
};
