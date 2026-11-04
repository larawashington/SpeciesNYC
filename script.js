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
const status_msg = document.getElementById("status");
//iNaturalist api consts
// https://api.inaturalist.org/v1/observations/species_counts?place_id=48&quality_grade=research&lat=40.78&lng=-73.96&radius=0.5
const base_url = "https://api.inaturalist.org/v1/observations";
// const nyc_id = "place_id=674";
const nystate_id = "place_id=48";
const quality_grade = "quality_grade=research";
const id_chunk_size = 200; //max taxon ids per request (keeps urls short)

//observations - state vs local
const state_total_promise = fetchTotal();
const min_obs = 10;

//in-flight search, cancelled when a new one starts
let search_controller;

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
    //cancel the previous search so stale results never overwrite new ones
    if (search_controller) search_controller.abort();
    search_controller = new AbortController();
    const signal = search_controller.signal;

    const search_radius_km = search_radius_m / 1000;
    const local_params = `lat=${lat}&lng=${lng}&radius=${search_radius_km}`;
    showStatus("");
    showLoading("common_list");
    showLoading("distinctive_list");

    try {
        //species list + local total + state total, all at once
        const [results, local_total, state_total] = await Promise.all([
            fetchSpecies(local_params, signal),
            fetchTotal(local_params, signal),
            state_total_promise
        ]);
        if (signal.aborted) return;

        //most observed: render right away (labels fill in later)
        const species = results.slice(0, 5);
        renderSpecies(species, "common_list");

        //filtering + mapping + adding local distinctiveness score
        const keep_species = results.filter(d => d.count >= min_obs);
        const ids = keep_species.map(d => d.taxon.id);
        const state_lookup = await fetchStateCounts(ids, signal);
        if (signal.aborted) return;
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
        renderSpecies(dist_species, "distinctive_list");

        //labels: native|introduced|unknown|at-risk (one round for both lists)
        const combined_ids = [...species, ...dist_species].map(d => d.taxon.id);
        const [native_set, introed_set, atrisk_set] = await Promise.all([
            fetchIDSet(combined_ids, "native=true", signal),
            fetchIDSet(combined_ids, "introduced=true", signal),
            fetchIDSet(combined_ids, "threatened=true", signal),
        ]);
        if (signal.aborted) return;
        applyLabels(native_set, introed_set, atrisk_set);
    } catch (err) {
        if (err.name === "AbortError") return; //superseded by a newer search
        console.log(err);
        clearList("common_list");
        clearList("distinctive_list");
        showStatus("Couldn't reach iNaturalist. Check your connection and try again.");
    }
}

//fetch helpers
//cache of finished responses, keyed by url (repeat searches are instant)
const response_cache = new Map();

async function getJSON(url, signal) {
    if (response_cache.has(url)) return response_cache.get(url);
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    const data = await response.json();
    response_cache.set(url, data);
    return data;
}

function chunk(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
}

async function fetchSpecies(local_params, signal) {
    const url = `${base_url}/species_counts?${nystate_id}&${quality_grade}&per_page=500&${local_params}`;
    const data = await getJSON(url, signal);
    // console.log(data.total_results);
    // console.log(data.results[0].taxon.preferred_common_name, data.results[0].count);
    return data.results;
}

async function fetchTotal(extra_params = "", signal) {
    const url = `${base_url}?${nystate_id}&${quality_grade}&per_page=0&${extra_params}`;
    const data = await getJSON(url, signal);
    return data.total_results;
}

//species_counts for a list of taxon ids, split into url-safe chunks
async function fetchByIDs(ids, extra_params, signal) {
    const pages = await Promise.all(chunk(ids, id_chunk_size).map(ids_part => {
        const url = `${base_url}/species_counts?${nystate_id}&${quality_grade}&taxon_id=${ids_part.join(",")}&per_page=500${extra_params}`;
        return getJSON(url, signal);
    }));
    return pages.flatMap(data => data.results);
}

async function fetchStateCounts(ids, signal) {
    const species_lookup = new Map();
    for (const d of await fetchByIDs(ids, "", signal)) {
        species_lookup.set(d.taxon.id, d.count);
    }
    return species_lookup;
}

async function fetchIDSet(ids, filter, signal) {
    const id_set = new Set([]);
    for (const d of await fetchByIDs(ids, `&${filter}`, signal)) {
        id_set.add(d.taxon.id);
    }
    return id_set;
}

//rendering
function showStatus(message) {
    status_msg.textContent = message;
    status_msg.hidden = message === "";
}

function showLoading(list_id) {
    document.getElementById(list_id).innerHTML = `<p class="loading">Loading…</p>`;
}

function clearList(list_id) {
    document.getElementById(list_id).innerHTML = "";
}

function renderSpecies(species, list_id) {
    const cards = [];
    for (const d of species) {
        const common_name = d.taxon.preferred_common_name ?? d.taxon.name;
        const scientific_name = d.taxon.name;
        const count = d.count;
        // const photo_sm = d.taxon.default_photo?.square_url;
        const photo_med = d.taxon.default_photo?.medium_url ?? "";
        const photo_cred = d.taxon.default_photo?.attribution ?? "";
        cards.push(`
        <div class="species_card" data-taxon="${d.taxon.id}">
            <img src="${photo_med}" alt="${common_name}" title="${photo_cred}" loading="lazy">
            <h3>${common_name}</h3>
            <p class="sci_name">${scientific_name}</p>
            <div class="tags"><span class="tag pending">…</span></div>
            <p>${count} observations</p>
        </div>`);
    }
    document.getElementById(list_id).innerHTML = cards.join("");
}

//fill in tags on cards already on screen
function applyLabels(native_set, introed_set, atrisk_set) {
    for (const card of document.querySelectorAll(".species_card")) {
        const id = Number(card.dataset.taxon);
        const status = native_set.has(id) ? "native"
            : introed_set.has(id) ? "introduced"
                : "unknown";
        const at_risk = atrisk_set.has(id) ? `<span class="tag at_risk">at risk</span>` : "";
        card.querySelector(".tags").innerHTML = `<span class="tag ${status}">${status}</span>${at_risk}`;
    }
}
