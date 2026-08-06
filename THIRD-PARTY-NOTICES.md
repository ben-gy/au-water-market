# Third-party notices

This list is derived from the `sources` recorded in the production sourcemaps
(`dist/**/*.js.map`) — that is, from what is actually shipped to a browser, not
from the full dependency tree. Build-time tools (Vite, TypeScript, Vitest) do not
appear here because none of their code reaches the reader.

Fonts are **not** vendored. The site uses a system font stack only, so no font
files are redistributed and no font licence applies.

---

## Leaflet 1.9.4

Interactive map rendering. Loaded from npm and bundled — never from a CDN.

<https://leafletjs.com/> · <https://github.com/Leaflet/Leaflet>

```
BSD 2-Clause License

Copyright (c) 2010-2023, Volodymyr Agafonkin
Copyright (c) 2010-2011, CloudMade
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## Data and map tiles

These are **not** code dependencies and are not covered by this project's licence.
They carry their own terms, and their attribution requirements are honoured in the
site footer, the About panel, the map attribution control and the JSON-LD
metadata. See [ADDITIONAL-TERMS.md](./ADDITIONAL-TERMS.md).

| Source | Licence |
|---|---|
| Bureau of Meteorology water market data — © Commonwealth of Australia | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Australian Bureau of Statistics ASGS boundaries — © Commonwealth of Australia | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| OpenStreetMap contributors (basemap data) | [ODbL 1.0](https://www.openstreetmap.org/copyright) |
| CARTO (basemap tile rendering) | [CARTO attribution terms](https://carto.com/attributions) |
