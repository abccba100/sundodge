# ShadeWalk

**Walk in the shade. Leave at the right time.**

ShadeWalk finds the walking route with the least direct sun and suggests when to leave. It works out building and tree shadows from OpenStreetMap data and the sun's position, for any minute of any day. Everything runs in your browser: there is no server, no account and no API key.

**Live demo:** _(GitHub Pages link goes here)_ · **Demo video:** _(YouTube link goes here)_

![ShadeWalk in Jongno, Seoul: the ShadeWalk route (teal) follows building shadows; the dashed line is the shortest route](docs/screenshot-seoul.png)

**Example results** (computed by the app):

| Walk | Shortest route | ShadeWalk route |
|---|---|---|
| Jongno, Seoul: Gwanghwamun Square → Jongno 2-ga, 5 Aug 2026, 15:30 | 13.3 min, **11.4 min in direct sun** | 17.0 min, **4.8 min in direct sun** (−58%) |
| Midtown, New York: Penn Station → Rockefeller Center, 2 Jul 2026, 14:00 | 23.4 min, **17.1 min in direct sun** | 23.8 min, **7.0 min in direct sun** (−59%) |

In Midtown, leaving at 15:00 instead of 14:00 cuts the ShadeWalk route's sun time to 3.5 minutes. That is the kind of advice the "When to leave" chart gives.

## Why

- **Heat kills people.** WHO reports the 2025 Lancet Countdown figure: heat-related deaths have risen 23% since the 1990s, to about 546,000 a year [1].
- **In Korea it happens outdoors in the afternoon.** In 2025, Korea's emergency-department heat-illness surveillance counted 4,460 cases.
  - 79.2% happened outdoors, and 522 (11.7%) happened on the roadside.
  - Cases peaked between 2 and 5 pm, which is when students walk home [2].
- **Shade matters more than the forecast.** Shade from buildings lowers mean radiant temperature by 22.8–30.9 °C during the day. That is the heat load your body actually absorbs. Air temperature under the same shade changes by less than 1.3 °C on average [3].
  - So a forecast high says little about how hot your walk will be. Which side of the street you walk on, and when you leave, matter much more.
- **Maps don't account for this.** Navigation apps optimise for distance or time, never for sun.

## What it does

- **Live shadows.** 3D buildings and mapped trees cast shadows that move as you drag the time slider. The sun position comes from SunCalc [7].
- **Two routes, side by side.**
  - The shortest route (dashed).
  - The ShadeWalk route, coloured teal where it is shaded and orange where it is in sun.
  - For each you see walking time, minutes in direct sun, and the share of the walk in shade.
- **"When to leave".** ShadeWalk recomputes both routes for departures every 10 minutes across a two-hour window. It shows how many minutes of sun each departure means. Tap a bar to jump to that time.
- **Your own trade-off.** A slider sets how much you want to avoid sun. "1 m of sun = 3 m of shade" means the route accepts up to 3 m of extra walking to save 1 m of sun. This is the sun-avoidance parameter α from the CoolWalks model [4].
- **Honest about its data.**
  - Not every building in OpenStreetMap has a height. ShadeWalk tells you how many heights come from real tags and how many are estimated.
  - It can colour buildings by data quality: green for a height tag, yellow for floors × 3 m [8], red for a type-based estimate.
- **Weather context.** It shows feels-like temperature, UV and direct radiation for that hour from Open-Meteo. On cloudy hours it tells you that shade matters less.
- **Anywhere OpenStreetMap has buildings.** Two demo areas are pre-cached: Jongno in Seoul and Midtown in New York. "Load this view" fetches any other area, up to 2.5 km², from the Overpass API.

## How it works

1. **Data.** One Overpass query fetches buildings, walkable ways, trees, parks and water for the area. Building height comes from the first of these that is present:
   - `height`
   - `building:levels` × 3 m
   - a default for the building type
2. **Shadows without polygon unions.** On flat ground, a point P is in a building's shadow exactly when the ray from P toward the sun passes through the building.
   - For a building of height h, that ray stays under the roof for L = h / tan(sun altitude) metres. So P is shaded if and only if the 2-D segment from P toward the sun, of length L, touches the footprint.
   - That test is exact even for L-shaped footprints, and it needs only a point-in-polygon check and a segment-crossing check.
   - A Flatbush R-tree, rebuilt for each time step, narrows each test to a few nearby buildings.
   - Tree canopies are modelled as discs between a base height and a top height. A ground point is under a tree's shadow if its sun ray passes within the crown radius while it is between those two heights.
3. **Routing.** Every street segment is sampled every 4 m, which gives the fraction of it in sun.
   - Dijkstra then minimises (metres in shade) + α × (metres in sun).
   - Tunnels, arcades and indoor corridors count as shaded.
   - Shadows are evaluated at the middle of the walk rather than at the door. That keeps the search simple and the error small for a 10–30 minute walk.
4. **Performance.** All of this runs in a Web Worker. In Jongno (2,912 buildings, 578 trees, 127 km of walkways), one time step and both routes took 0.2–0.4 s in our tests, even in a software-rendered headless browser.

The engine (`src/engine/`) has no UI dependencies and is covered by unit tests (`npm test`). The tests check:
- the sun position in Seoul at noon, morning and evening;
- exact shadow reach for a box and an L-shaped building;
- tree shade;
- night;
- route choice, on a synthetic street pair where the shaded detour must win.

## How it compares

| | Cool Walks app (Barcelona Regional) [5] | CoolWalks model (Wolf, Vierø, Szell) [4] | ShadeMap [6] | HeiGIT shaded routing [9] | **ShadeWalk** |
|---|---|---|---|---|---|
| Shaded routing | yes | model, no app | no (shadow SDK) | yes | **yes** |
| Where | Barcelona only | 3 city subsections | bring your own data | German cities | **anywhere OSM has buildings** |
| Trees | yes (LiDAR) | no | – | yes (surface model) | **OSM trees where mapped** |
| When-to-leave suggestion | – | – | – | – | **yes** |
| Runs fully in the browser, open source | – | research code | commercial | web app | **yes (MIT)** |

ShadeWalk is not more accurate than LiDAR-based tools. It trades accuracy for reach: it works in any city on day one, and it is honest about where its data is thin.

## Limitations

- **Ground and canopies are simplified.** The ground is treated as flat, buildings as straight prisms (no roof shapes or overhangs) and trees as discs. Hills are not modelled.
- **Building heights.**
  - Building heights are only as good as OpenStreetMap.
  - In Midtown Manhattan 90% have a height tag or floor count (2,071 of 2,296).
  - In the Jongno demo area only 13% do (366 of 2,912), so most Seoul shadows use estimated heights. The data-quality view shows this.
  - Korea's official building register records floor counts and could close this gap.
- **Street trees.** Many cities map only some of their street trees, so tree shade is undercounted.
- **Ties in grid cities.** In a grid, several routes can share the shortest length. The "shortest route" shown is the one plain Dijkstra happens to find, so part of the saving can come from picking the shadier of two equally short routes. That is still a real choice a walker can make.
- **Sun, not air.** "Minutes in direct sun" is a radiation-exposure measure, not a medical risk score.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine unit tests
npm run build      # static site in dist/
```

To add a pre-cached area:

```bash
node scripts/fetch-area.mjs my-area <west> <south> <east> <north>
```

## Data and services

- **Map data.** © OpenStreetMap contributors, ODbL.
  - Pre-cached areas were fetched once through the Overpass API and stored as static files, following its usage policy [10].
  - Live loading is one user-confirmed request at a time, with a 60-second cooldown.
- **Weather.** Open-Meteo, CC BY 4.0, free for non-commercial use [11].
- **No base-map tiles.** The map is drawn from the downloaded OSM features.

## Built with

TypeScript, React, Vite, MapLibre GL JS, SunCalc, Flatbush and Vitest.

**AI assistance:** I used Claude (Anthropic) as a coding assistant to help write and test the code and this README. Ideas, design decisions and the final review are mine. The narration in the demo video is AI text-to-speech (Kokoro-82M, an open-weight model) reading a script drafted with Claude's help.

## References

1. WHO news release on the 2025 Lancet Countdown report, 29 Oct 2025. https://www.who.int/news/item/29-10-2025-climate-inaction-is-claiming-millions-of-lives-every-year--warns-new-lancet-countdown-report
2. Newsis, 14 May 2026, reporting KDCA heat-illness surveillance for 2025. https://www.newsis.com/view/NISX20260514_0003629135
3. Middel, A. et al. (2021). 50 Grades of Shade. *Bulletin of the American Meteorological Society* 102(9). https://journals.ametsoc.org/view/journals/bams/102/9/BAMS-D-20-0193.1.xml
4. Wolf, Vierø, Szell. CoolWalks (route choice model with a sun-avoidance parameter α). arXiv:2405.01225. https://arxiv.org/abs/2405.01225
5. Freethink, "Cool Walks", 17 Jul 2021. https://www.freethink.com/energy/cool-walks
6. ShadeMap. https://shademap.app/about
7. SunCalc (BSD-2-Clause), based on J. Meeus, *Astronomical Algorithms*. https://github.com/mourner/suncalc
8. OpenStreetMap Wiki, Key:building:levels. https://wiki.openstreetmap.org/wiki/Key:building:levels
9. HeiGIT, heat-avoiding routing, 11 Jun 2026. https://heigit.org/introducing-the-technology-behind-heat-avoiding-routing-how-a-heidelberg-research-initiative-became-a-nationally-scalable-open-source-tool/
10. Overpass API usage policy. https://wiki.openstreetmap.org/wiki/Overpass_API
11. Open-Meteo terms. https://open-meteo.com/en/terms

## License

MIT. Map data © OpenStreetMap contributors (ODbL).
