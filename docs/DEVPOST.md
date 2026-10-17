# ShadeWalk — Devpost submission text

**Tagline (max 200 chars):** Find the shadiest walking route and the best time to leave, using real building and tree shadows computed in your browser from OpenStreetMap and the sun's position.

**Track:** Coding · **Theme:** Community Issues (also fits Environmental Science)

---

## Inspiration

In Korea, summer heat is dangerous, and it is dangerous in the afternoon.

In 2025, Korea's emergency-department heat-illness surveillance counted **4,460 heat-illness cases**. **79.2%** of them happened outdoors, and **522 on the roadside**. Most happened **between 2 and 5 pm**, which is exactly when students walk home from school.

Around the world, heat-related deaths have risen **23% since the 1990s**, to about **546,000 a year** (Lancet Countdown 2025, via WHO).

Then I read a study that changed how I thought about the problem. In Tempe, Arizona, building shade cut **mean radiant temperature** by **22.8–30.9 °C**. That is the heat your body actually absorbs. Yet the air temperature in the same shade changed by **less than 1.3 °C** (Middel et al., 2021).

So the weather forecast says almost nothing about how hot *your walk* will be. Two things matter much more: which side of the street you are on, and when you leave. Every map app optimises for distance or time. None of them asks: *how much sun will this route put on me?*

## What it does

- **Moving shadows.** ShadeWalk draws 3D buildings and mapped trees, and their shadows move as you drag the time slider.
- **Two routes compared.**
  - It finds the **shortest route** and a **ShadeWalk route** that trades a little distance for a lot less sun.
  - For each one you see walking time, minutes in direct sun, and the percentage of the walk in shade.
- **When to leave.** It recomputes both routes for departures every 10 minutes across two hours, and points to the departure time with the least sun.
  - In Midtown on 2 July 2026, leaving at 15:00 instead of 14:00 cuts the ShadeWalk route's sun time from 7.0 to 3.5 minutes.
- **Your trade-off.** A slider sets how much you want to avoid sun. "1 m of sun = 3 m of shade" means the route will walk up to 3 m further to save 1 m of sun. This is the sun-avoidance parameter α from the CoolWalks research model.
- **Honest data.** OpenStreetMap does not have a height for every building.
  - ShadeWalk shows what share of heights comes from real tags.
  - It can colour buildings by data quality: green for a height tag, yellow for floors × 3 m, red for an estimate from the building type.
- **Weather context.** It shows feels-like temperature and direct solar radiation for that hour, from Open-Meteo. On cloudy hours it tells you that shade matters less.
- **Works almost anywhere.** Two demo areas are pre-loaded: Jongno in Seoul and Midtown in New York. "Load this view" fetches any other area where OpenStreetMap has buildings.

## How we built it

- **Stack.** TypeScript, React and Vite for the app. MapLibre GL JS draws the 3D map from the downloaded OpenStreetMap features, so no third-party tiles are needed. SunCalc gives the sun position, Flatbush provides the spatial index, and Vitest runs the tests.
- **The key idea: a ray test instead of shadow polygons.** On flat ground, a point P is in a building's shadow exactly when the ray from P toward the sun passes through the building.
  - The ray stays under the roof for the first **L = h / tan(sun altitude)** metres, where h is the building height.
  - So P is shaded if and only if the 2-D segment from P toward the sun, of length L, touches the building footprint.
  - This is exact even for L-shaped buildings. It needs only point-in-polygon and segment-crossing tests, with no polygon unions.
  - Trees are modelled as canopy discs between a base height and a top height.
- **Routing.** Every street segment is sampled every 4 m to get its fraction in sun.
  - Dijkstra then minimises **metres in shade + α × metres in sun**.
  - Tunnels, arcades and indoor corridors count as shaded.
  - Shadows are evaluated at the middle of the walk.
- **Speed.** Everything runs in a **Web Worker**. For Jongno (2,912 buildings, 578 trees, 127 km of walkways), one time step plus both routes took **0.2–0.4 s** in our tests.
- **Tests.** The engine has unit tests for:
  - sun position (Seoul at noon, morning and afternoon);
  - exact shadow reach for a box and an L-shaped building;
  - tree shade;
  - night;
  - a synthetic street pair where the shaded detour must win.

## Results

| Walk | Shortest route | ShadeWalk route |
|---|---|---|
| Jongno, Seoul: Gwanghwamun Square → Jongno 2-ga, 5 Aug 2026, 15:30 | 13.3 min walk, 11.4 min in direct sun | 17.0 min walk, 4.8 min in direct sun (−58%) |
| Midtown, New York: Penn Station → Rockefeller Center, 2 Jul 2026, 14:00 | 23.4 min walk, 17.1 min in direct sun | 23.8 min walk, 7.0 min in direct sun (−59%) |

Both dates were the hottest day of summer 2026 for that area in Open-Meteo's reanalysis, with a feels-like maximum of about 44 °C.

In grid cities, several routes can share the shortest length. Part of the saving can therefore come from picking the shadier of two equally short routes, which is still a real choice a walker can make.

## Challenges we ran into

- **The azimuth convention.** SunCalc 1.x measures azimuth from south. A wrong convention would mirror every shadow. A unit test now checks that the sun is in the south at noon in Seoul, in the east in the morning and in the west in the afternoon.
- **Shadows of oddly shaped buildings.** Merging thousands of shadow polygons every time the slider moved was too slow. Reframing the problem as one ray test per point made it exact and fast.
- **Missing building heights.**
  - In our Jongno area only 13% of buildings (366 of 2,912) have a height or floor count in OpenStreetMap. In Midtown Manhattan it is 90% (2,071 of 2,296).
  - Instead of hiding this, we made data quality visible in the app.
- **Respecting free services.** The Overpass API is volunteer-run. The demo areas are pre-cached as static files. Live loading is one user-confirmed request at a time, with a cooldown.

## Accomplishments that we're proud of

- A shade router that works in **any city with OpenStreetMap buildings**, fully **in the browser**, with no server or API key.
- The **"when to leave"** feature. The prior work we found does shaded routing for a fixed departure time, but none of it suggests *when* to go.
  - Cool Walks covers Barcelona with LiDAR.
  - HeiGIT covers German cities.
  - The CoolWalks model is research code.
- An exact and simple shadow test, backed by unit tests.

## What we learned

- Radiant heat, not air temperature, is what makes a sunny street dangerous.
- Small reframings, such as "is the ray to the sun blocked?" instead of "what shape is the shadow?", can turn a slow geometry problem into a fast one.
- Open data is powerful but uneven. Showing users where it is weak builds more trust than pretending it is perfect.

## What's next

- **Fill in Korean building heights from Korea's official building register**, which records floor counts. This would close the Seoul data gap.
- **Time-dependent routing**, where shadows move during the walk itself.
- **School-commute mode.** A teacher or parent sets the school and a few home areas, and ShadeWalk suggests the safest departure times for heatwave days.
- **Offline PWA, and terrain**, for hilly cities.

## Built with

typescript · react · vite · maplibre-gl · suncalc · flatbush · vitest · openstreetmap · overpass-api · open-meteo · web-workers · github-pages

## AI use

I used Claude (Anthropic) as a coding assistant to help write and test the code and the documentation. The idea, design choices and final review are mine. The demo video's narration is AI text-to-speech (Kokoro-82M, an open-weight model) reading a script drafted with Claude's help; the video says so in its closing credits.

## References

1. WHO news release on the 2025 Lancet Countdown report, 29 Oct 2025. https://www.who.int/news/item/29-10-2025-climate-inaction-is-claiming-millions-of-lives-every-year--warns-new-lancet-countdown-report
2. Newsis, 14 May 2026, reporting KDCA heat-illness surveillance for 2025. https://www.newsis.com/view/NISX20260514_0003629135
3. Middel, A. et al. (2021). 50 Grades of Shade. *Bulletin of the American Meteorological Society* 102(9). https://journals.ametsoc.org/view/journals/bams/102/9/BAMS-D-20-0193.1.xml
4. Wolf, Vierø, Szell. CoolWalks, arXiv:2405.01225. https://arxiv.org/abs/2405.01225
5. Cool Walks app (Barcelona Regional), Freethink, 17 Jul 2021. https://www.freethink.com/energy/cool-walks
6. HeiGIT, heat-avoiding routing, 2026. https://heigit.org/introducing-the-technology-behind-heat-avoiding-routing-how-a-heidelberg-research-initiative-became-a-nationally-scalable-open-source-tool/
7. OpenStreetMap Wiki, Key:building:levels (3 m per floor). https://wiki.openstreetmap.org/wiki/Key:building:levels
