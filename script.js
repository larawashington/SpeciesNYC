//map: zoom out as far as full NY + NJ, half-step scroll zoom
const ny_nj_bounds = L.latLngBounds([[38.75, -79.8], [45.05, -71.75]]);
const nyc_map = L.map("nyc_map", {
    maxBounds: ny_nj_bounds.pad(0.1),
    zoomSnap: 0.5,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 120
}).setView([40.726997, -73.984291], 12);

//min zoom = the zoom where both states just fit the screen (recomputed on resize)
function updateMinZoom() {
    nyc_map.setMinZoom(nyc_map.getBoundsZoom(ny_nj_bounds));
}
updateMinZoom();
nyc_map.on("resize", updateMinZoom);

//search radius (slider controlled)
let search_zone;
let last_click;
let search_radius_m = 500;
const radius_slider = document.getElementById("radius_slider");
const radius_value = document.getElementById("radius_value");
//iNaturalist api consts
// https://api.inaturalist.org/v1/observations/species_counts?place_id=48&quality_grade=research&lat=40.78&lng=-73.96&radius=0.5
const base_url = "https://api.inaturalist.org/v1/observations";
// const nyc_id = "place_id=674"; 
const nystate_id = "place_id=48";
const quality_grade = "quality_grade=research";

//observations - state vs local 
const state_total_promise = fetchTotal();
const min_obs = 10;

L.tileLayer(`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`, {
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
}).addTo(nyc_map);

function formatRadius(m) {
    return m < 1000 ? `${m} m` : `${m / 1000} km`;
}

//slider: resize circle live while dragging, re-search once on release
radius_slider.addEventListener("input", function () {
    search_radius_m = Number(radius_slider.value);
    radius_value.textContent = formatRadius(search_radius_m);
    if (search_zone) search_zone.setRadius(search_radius_m);
});
radius_slider.addEventListener("change", function () {
    if (last_click) runSearch(last_click.lat, last_click.lng);
});

//map clicks
nyc_map.on("click", function (e) {
    // console.log(e.latlng); //click coords
    last_click = e.latlng;
    if (!search_zone) {
        search_zone = L.circle([e.latlng.lat, e.latlng.lng], { radius: search_radius_m })
            .addTo(nyc_map);
    } else {
        search_zone.setLatLng([e.latlng.lat, e.latlng.lng]);
    }
    runSearch(e.latlng.lat, e.latlng.lng);
});

async function runSearch(lat, lng) {
    const search_radius_km = search_radius_m / 1000;
    const results = await fetchSpecies(lat, lng, search_radius_km);
    const species = results.slice(0, 5);
    //total observations
    const state_total = await state_total_promise;
    const local_total = await fetchTotal(`lat=${lat}&lng=${lng}&radius=${search_radius_km}`);
    // console.log(state_total, local_total);
    const keep_species = results.filter(d => d.count >= min_obs);
    const ids = keep_species.map(d => d.taxon.id);
    //filtering + mapping + adding local distinctiveness score
    const ids_str = ids.join(",");
    const state_lookup = await fetchStateCounts(ids_str);
    const scored_species = [];
    for (const d of keep_species) {
        if (!state_lookup.has(d.taxon.id)) continue;
        const ld_score = (d.count / local_total) / (state_lookup.get(d.taxon.id) / state_total);
        const scored = { ...d, score: ld_score };
        scored_species.push(scored);
    }
    //console.table(scored_species);
    //sort by score
    scored_species.sort((a, b) => b.score - a.score);
    const dist_species = scored_species.slice(0, 5);
    //labels: native|introduced|unknown|at-risk 
    const combined_species = [...species, ...dist_species];
    const combined_ids = combined_species.map(d => d.taxon.id);
    const combined_ids_str = combined_ids.join(",");
    const [native_set, introed_set, atrisk_set] = await Promise.all([
        fetchIDSet(combined_ids_str, "native=true"),
        fetchIDSet(combined_ids_str, "introduced=true"),
        fetchIDSet(combined_ids_str, "threatened=true"),
    ]);
    const tagged_species = [];
    for (const d of combined_species) {
        const status = native_set.has(d.taxon.id) ? "native"
            : introed_set.has(d.taxon.id) ? "introduced"
                : "unknown";
        const at_risk = atrisk_set.has(d.taxon.id);
        const tagged = { ...d, status: status, at_risk: at_risk };
        tagged_species.push(tagged);
    }
    //console.log(tagged_species);
    //render
    renderSpecies(tagged_species.slice(0, species.length), "common_list");
    renderSpecies(tagged_species.slice(species.length), "distinctive_list");
}

async function fetchSpecies(lat, lng, radius_km) {
    const url = `${base_url}/species_counts?${nystate_id}&${quality_grade}&lat=${lat}&lng=${lng}&radius=${radius_km}`;
    const response = await fetch(url);
    if (!response.ok) {
        console.log("Request failed:", response.status);
        return [];
    }
    const data = await response.json();
    console.log(data);
    // console.log(data.total_results);
    // console.log(data.results[0].taxon.preferred_common_name, data.results[0].count);
    return data.results;
}

function renderSpecies(species, list_id) {
    const container = document.getElementById(list_id);
    container.innerHTML = "";
    for (const d of species) {
        const common_name = d.taxon.preferred_common_name ?? d.taxon.name;
        const scientific_name = d.taxon.name;
        const count = d.count;
        // const photo_sm = d.taxon.default_photo?.square_url;
        const photo_med = d.taxon.default_photo?.medium_url;
        const photo_cred = d.taxon.default_photo?.attribution;
        const at_risk = d.at_risk === true ? `<span class="tag at_risk">at risk</span>` : "";
        const status = d.status;
        container.innerHTML += `
        <div class="species_card">
            <img src="${photo_med}" alt="${common_name}" title="${photo_cred}">
            <h3>${common_name}</h3>
            <p class="sci_name">${scientific_name}</p>
            <div class="tags">
                <span class="tag ${status}">${status}</span>
                ${at_risk}
            </div>
            <p>${count} observations</p>
        </div>`;
    }
}

async function fetchTotal(extra_params = "") {
    const url = `${base_url}?${nystate_id}&${quality_grade}&per_page=0&${extra_params}`;
    const response = await fetch(url);
    if (!response.ok) {
        console.log("Request failed:", response.status);
        return 0;
    }
    const data = await response.json();
    return data.total_results;
}

async function fetchStateCounts(ids) {
    const url = `${base_url}/species_counts?${nystate_id}&${quality_grade}&taxon_id=${ids}&per_page=500`;
    const response = await fetch(url);
    const species_lookup = new Map();
    if (!response.ok) {
        console.log("Request failed:", response.status);
        return species_lookup;
    }
    const data = await response.json();
    for (const d of data.results) {
        species_lookup.set(d.taxon.id, d.count)
    }
    return species_lookup;
}

async function fetchIDSet(ids, filter) {
    const url = `${base_url}/species_counts?${nystate_id}&${quality_grade}&taxon_id=${ids}&per_page=500&${filter}`;
    const response = await fetch(url);
    const id_set = new Set([]);
    if (!response.ok) {
        console.log("Request failed:", response.status);
        return id_set;
    }
    const data = await response.json();
    for (const d of data.results) {
        id_set.add(d.taxon.id);
    }
    return id_set;
}