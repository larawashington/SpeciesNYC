# SpeciesNYC

A [generous interface](https://doi.org/10.63744/4pg836gkjaeb) for exploring species occurrence data in New York City via iNaturalist's API, inspired by [ALA Lens](https://www.ala.org.au/lens/) and [*Designing for biodiversity data in place*](https://doi.org/10.1002/pan3.70384).

**Live:** https://larawashington.github.io/SpeciesNYC/

Click anywhere in New York or New Jersey and set the search radius (500 m – 5 km) to see what lives there.

## How it works

- **Most Observed:** species with the most research-grade observations inside the circle.
- **Most Distinctive:** species far more common inside the circle than across the state (New York or New Jersey):

  ```
  (species count / local total) ÷ (state-wide species count / state total)
  ```

  Only species with at least 10 observations inside the circle are scored.
- **Labels:** native, introduced and at-risk labels are based on iNaturalist's listings by state.

## Built with

[JavaScript](https://shields.io), [HTML5](https://shields.io), and
[CSS3](https://shields.io) using the [iNaturalist API](https://api.inaturalist.org/v1/docs/), and basemap tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors © [CARTO](https://carto.com/attributions).

## Credits

Species data from [iNaturalist](https://www.inaturalist.org) (research-grade observations); photos © their observers.

- Whitelaw, M. (2015). Generous interfaces for digital cultural collections. *Digital Humanities Quarterly*, 9(1). [doi.org/10.63744/4pg836gkjaeb](https://doi.org/10.63744/4pg836gkjaeb)
- Whitelaw, M., & Mackenzie, A. *ALA Lens*. Atlas of Living Australia. [ala.org.au/lens](https://www.ala.org.au/lens/)
- Whitelaw, M., et al. (2026). Designing for biodiversity data in place. *People and Nature*. [doi.org/10.1002/pan3.70384](https://doi.org/10.1002/pan3.70384)

Created by Lara Washington.
