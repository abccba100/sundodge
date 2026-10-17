# Security notes

SunDodge is a static site with no backend, accounts or stored user data. It sends requests only to:

- the Overpass API, for map data, and only when you press "Load this view";
- Open-Meteo, for hourly weather.

## Known advisory: maplibre-gl ≤ 6.4 (`DOM.sanitize` XSS bypass)

`npm audit` reports this advisory for the pinned maplibre-gl 5.x. As far as we can tell, SunDodge does not reach the affected code path:

- it never passes untrusted HTML to MapLibre popups or controls;
- it renders no OSM names or tags as HTML;
- its only HTML string is the static attribution text.

The upgrade to maplibre-gl 6 is planned for after the hackathon, because it includes breaking changes that need testing.

Please report a problem by opening an issue in this repository.
