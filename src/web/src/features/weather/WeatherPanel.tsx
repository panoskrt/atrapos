import { Icon } from '../../components/Icon';
import { useRouteWeather, type RouteWeatherDay, type RouteWeatherHour } from './api';
import styles from './WeatherPanel.module.css';

export function WeatherPanel({ routeId, isDraft }: { routeId: string; isDraft: boolean }) {
  if (isDraft)
    return (
      <p className={styles.message}>Save the route to see the forecast. Weather is based on the saved route geometry.</p>
    );

  return <SavedRouteWeather routeId={routeId} />;
}

function SavedRouteWeather({ routeId }: { routeId: string }) {
  const weather = useRouteWeather(routeId);

  if (weather.isPending)
    return (
      <p className={styles.message} role="status">
        <span className={styles.spinner} aria-hidden="true" />
        Loading the 7-day forecast…
      </p>
    );

  if (weather.isError)
    return (
      <div className={styles.message} role="alert">
        <p>Weather forecast is temporarily unavailable: {weather.error.message}</p>
        <button type="button" className="btn" onClick={() => void weather.refetch()}>
          Try again
        </button>
      </div>
    );

  if (!weather.data.available)
    return <p className={styles.message}>{weather.data.reason ?? 'A forecast is not available for this route.'}</p>;

  return (
    <section className={styles.panel} aria-label="7-day route weather">
      <p className={styles.description}>Forecast range across the start, middle, and end of the saved route.</p>
      <p className={styles.timezone}>
        Times shown in route local time ({weather.data.timeZoneId ?? 'local time'}).
      </p>
      <div className={styles.days}>
        {weather.data.forecast.map((day, index) => (
          <WeatherDayRow
            key={day.date}
            day={day}
            timeZoneId={weather.data.timeZoneId ?? 'UTC'}
            initiallyOpen={index === 0}
          />
        ))}
      </div>
      <p className={styles.attribution}>
        Weather data by{' '}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Open-Meteo
        </a>{' '}
        (
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
          CC BY 4.0
        </a>
        ).
      </p>
      <p className={styles.disclaimer}>Forecasts are estimates and may change.</p>
    </section>
  );
}

function WeatherDayRow({ day, timeZoneId, initiallyOpen }: {
  day: RouteWeatherDay;
  timeZoneId: string;
  initiallyOpen: boolean;
}) {
  const condition = weatherCondition(day.weatherCode);
  const date = new Date(`${day.date}T12:00:00Z`);
  return (
    <details className={styles.day} open={initiallyOpen}>
      <summary className={styles.daySummary}>
        <span className={styles.dayHead}>
        <time dateTime={day.date} className={styles.date}>
          {date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}
        </time>
        <span className={styles.condition}>
          <span aria-hidden="true">{condition.icon}</span>
          {condition.label}
        </span>
        </span>
        <span className={styles.dayMetrics}>
          <span className={styles.temperature} aria-label={`Low ${Math.round(day.minTemperatureC)} degrees, high ${Math.round(day.maxTemperatureC)} degrees Celsius`}>
            {Math.round(day.minTemperatureC)}° – {Math.round(day.maxTemperatureC)}°
          </span>
          <span className={styles.details}>
            <span title="Maximum precipitation probability">
              <Icon name="umbrella" size={14} />
              {Math.round(day.precipitationProbabilityPercent)}%
            </span>
            <span title="Maximum wind speed">
              <Icon name="wind" size={14} />
              {Math.round(day.windSpeedKmh)} km/h
            </span>
          </span>
        </span>
      </summary>
      <div className={styles.hourly} aria-label="Three-hour forecast">
        {day.hours.map((hour) => <WeatherHourRow key={hour.time} hour={hour} timeZoneId={timeZoneId} />)}
      </div>
    </details>
  );
}

function WeatherHourRow({ hour, timeZoneId }: { hour: RouteWeatherHour; timeZoneId: string }) {
  const condition = weatherCondition(hour.weatherCode);
  const time = new Date(hour.time);
  return (
    <div className={styles.hour}>
      <time dateTime={hour.time} className={styles.hourTime}>
        {time.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
          timeZone: timeZoneId,
        })}
      </time>
      <span className={styles.hourCondition} title={condition.label} aria-label={condition.label}>{condition.icon}</span>
      <strong aria-label={`${Math.round(hour.minTemperatureC)} to ${Math.round(hour.maxTemperatureC)} degrees Celsius`}>
        {Math.round(hour.minTemperatureC)}°{hour.minTemperatureC === hour.maxTemperatureC ? '' : `–${Math.round(hour.maxTemperatureC)}°`}
      </strong>
      <span title="Precipitation probability">
        <Icon name="umbrella" size={13} />
        {Math.round(hour.precipitationProbabilityPercent)}%
      </span>
      <span title="Wind speed">
        <Icon name="wind" size={13} />
        {Math.round(hour.windSpeedKmh)}
      </span>
    </div>
  );
}

function weatherCondition(code: number): { label: string; icon: string } {
  if (code === 0) return { label: 'Clear', icon: '☀' };
  if (code === 1) return { label: 'Mostly clear', icon: '🌤' };
  if (code === 2) return { label: 'Partly cloudy', icon: '⛅' };
  if (code === 3) return { label: 'Overcast', icon: '☁' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: '🌫' };
  if ([51, 53, 55, 56, 57].includes(code)) return { label: 'Drizzle', icon: '🌦' };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: 'Rain', icon: '🌧' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: 'Snow', icon: '❄' };
  if ([95, 96, 99].includes(code)) return { label: 'Thunderstorm', icon: '⛈' };
  return { label: 'Variable', icon: '🌡' };
}
